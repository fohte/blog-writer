import { indentMore, isolateHistory } from '@codemirror/commands'
import {
  type Extension,
  Prec,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state'
import { EditorView, keymap, ViewPlugin } from '@codemirror/view'
import { err, ok, type Result } from 'neverthrow'

import {
  focusForSelection,
  hasOverlappingRange,
  isRangeValid,
  mapRange,
  rangesOverlap,
  type SuggestionDecision,
  type SuggestionLayerError,
  type SuggestionLayerState,
  type SuggestionPosition,
  type TextSuggestion,
  type TrackedSuggestionRange,
  validateSuggestions,
} from '#editor/suggestion-layer-range'
import { SuggestionRangeTracker } from '#editor/suggestion-layer-tracking'
import { createSuggestionDecorations } from '#editor/suggestion-layer-view'

export type {
  SuggestionDecision,
  SuggestionLayerError,
  SuggestionLayerState,
  SuggestionPosition,
  TextSuggestion,
  TrackedSuggestionRange,
} from '#editor/suggestion-layer-range'

type ScopedEffect<Value> = { scope: symbol; value: Value }

const mountedSuggestionLayers = new WeakMap<
  EditorView,
  Set<SuggestionLayerController>
>()

const replaceSuggestions =
  StateEffect.define<ScopedEffect<readonly TextSuggestion[]>>()
const replaceInFlight =
  StateEffect.define<ScopedEffect<SuggestionPosition | null>>()
const removeSuggestion = StateEffect.define<ScopedEffect<string>>()

export interface SuggestionLayerOptions {
  initialSuggestions?: readonly TextSuggestion[]
  initialInFlight?: SuggestionPosition
  trackAcceptedRanges?: boolean
  onResolve?: (
    suggestion: TextSuggestion,
    decision: SuggestionDecision,
    acceptedRange?: TrackedSuggestionRange,
  ) => void
  onCancelInFlight?: () => void
  onInFlightRangeEdited?: () => void
}

export class SuggestionLayerController {
  readonly extension: Extension
  private readonly effectScope = Symbol()
  private view: EditorView | null = null
  private readonly stateField: StateField<SuggestionLayerState>
  private nextGeneratedId = 0
  private readonly trackedRanges = new SuggestionRangeTracker()

  constructor(private readonly options: SuggestionLayerOptions = {}) {
    this.stateField = StateField.define<SuggestionLayerState>({
      create: (state) => {
        const suggestions = validateSuggestions(
          options.initialSuggestions ?? [],
          state.doc.length,
        ).match(
          (validSuggestions) => validSuggestions,
          () => [],
        )
        const initialInFlight = options.initialInFlight ?? null
        return {
          suggestions,
          inFlight:
            initialInFlight !== null &&
            isRangeValid(
              initialInFlight.from,
              initialInFlight.to,
              state.doc.length,
            ) &&
            !suggestions.some((suggestion) =>
              rangesOverlap(suggestion, initialInFlight),
            )
              ? initialInFlight
              : null,
          focusedId: focusForSelection(suggestions, state.selection.main.head),
        }
      },
      update: (value, transaction) => {
        let suggestions = value.suggestions
        let inFlight = value.inFlight
        let hasEffects = false

        for (const effect of transaction.effects) {
          if (
            effect.is(replaceSuggestions) &&
            effect.value.scope === this.effectScope
          ) {
            suggestions = effect.value.value
            hasEffects = true
          }
          if (
            effect.is(replaceInFlight) &&
            effect.value.scope === this.effectScope
          ) {
            inFlight = effect.value.value
            hasEffects = true
          }
          if (
            effect.is(removeSuggestion) &&
            effect.value.scope === this.effectScope
          ) {
            suggestions = suggestions.filter(
              ({ id }) => id !== effect.value.value,
            )
            hasEffects = true
          }
        }

        if (transaction.docChanged) {
          const changedRanges: Array<[number, number]> = []
          transaction.changes.iterChangedRanges((fromA, toA) => {
            changedRanges.push([fromA, toA])
          })
          suggestions = suggestions.flatMap((suggestion) => {
            const range = mapRange(
              suggestion,
              transaction.changes,
              changedRanges,
            )
            return range ? [{ ...suggestion, ...range }] : []
          })

          if (inFlight) {
            inFlight = mapRange(inFlight, transaction.changes, changedRanges)
          }
        }

        const focusedId = focusForSelection(
          suggestions,
          transaction.newSelection.main.head,
        )
        if (
          !hasEffects &&
          focusedId === value.focusedId &&
          (!transaction.docChanged ||
            (value.suggestions.length === 0 && value.inFlight === null))
        ) {
          return value
        }

        return {
          suggestions,
          inFlight,
          focusedId,
        }
      },
      provide: (field) => {
        return EditorView.decorations.compute([field], (state) =>
          createSuggestionDecorations(state.field(field), state, this),
        )
      },
    })

    this.extension = [
      this.stateField,
      ViewPlugin.define((view) => {
        this.view = view
        const viewLayers = mountedSuggestionLayers.get(view)
        if (viewLayers) {
          viewLayers.add(this)
        } else {
          mountedSuggestionLayers.set(view, new Set([this]))
        }
        return {
          destroy: () => {
            const viewLayers = mountedSuggestionLayers.get(view)
            viewLayers?.delete(this)
            if (viewLayers?.size === 0) mountedSuggestionLayers.delete(view)
            if (this.view === view) {
              this.view = null
              this.trackedRanges.clear()
            }
          },
        }
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          this.trackedRanges.map(update.changes)
        }
        const previousInFlight = update.startState.field(
          this.stateField,
          false,
        )?.inFlight
        const nextInFlight = update.state.field(
          this.stateField,
          false,
        )?.inFlight
        if (
          update.docChanged &&
          previousInFlight != null &&
          nextInFlight === null
        ) {
          this.options.onInFlightRangeEdited?.()
        }
      }),
      Prec.highest(
        keymap.of([
          { key: 'Tab', run: () => this.acceptFocusedSuggestion() },
          { key: 'Escape', run: () => this.cancelInFlight() },
        ]),
      ),
      Prec.high(
        keymap.of([
          { key: 'Tab', run: (view) => this.navigateSuggestions(view) },
          { key: 'Escape', run: () => this.rejectFocusedSuggestion() },
        ]),
      ),
      EditorView.baseTheme({
        '.cm-suggestion-widget': {
          whiteSpace: 'normal',
        },
      }),
    ]
  }

  setSuggestions(
    suggestions: readonly TextSuggestion[],
  ): Result<void, SuggestionLayerError> {
    const view = this.view
    if (!view) return err({ type: 'not-mounted' })
    const validation = validateSuggestions(suggestions, view.state.doc.length)
    if (validation.isErr()) return err(validation.error)
    const inFlight = view.state.field(this.stateField, false)?.inFlight
    if (hasOverlappingRange(validation.value, inFlight)) {
      return err({ type: 'overlapping-ranges' })
    }

    view.dispatch({
      effects: replaceSuggestions.of({
        scope: this.effectScope,
        value: validation.value,
      }),
    })
    return ok(undefined)
  }

  resolveInFlight(
    replacement: string | ((position: SuggestionPosition) => string),
  ): Result<void, SuggestionLayerError> {
    const view = this.view
    const state = view?.state.field(this.stateField, false)
    if (!view || !state?.inFlight) return ok(undefined)

    const id = this.createSuggestionId(state.suggestions)
    const replacementText =
      typeof replacement === 'string'
        ? replacement
        : replacement(state.inFlight)
    // The pending range is itself the replacement, so it is not a conflict.
    const validation = validateSuggestions(
      [
        ...state.suggestions,
        { ...state.inFlight, id, replacement: replacementText },
      ],
      view.state.doc.length,
    )
    if (validation.isErr()) return err(validation.error)
    view.dispatch({
      effects: [
        replaceSuggestions.of({
          scope: this.effectScope,
          value: validation.value,
        }),
        replaceInFlight.of({ scope: this.effectScope, value: null }),
      ],
    })
    return ok(undefined)
  }

  setInFlight(
    position: SuggestionPosition | null,
  ): Result<void, SuggestionLayerError> {
    const view = this.view
    if (!view) return err({ type: 'not-mounted' })
    if (
      position &&
      !isRangeValid(position.from, position.to, view.state.doc.length)
    ) {
      return err({ type: 'invalid-range', id: 'in-flight' })
    }
    const suggestions =
      view.state.field(this.stateField, false)?.suggestions ?? []
    if (hasOverlappingRange(suggestions, position)) {
      return err({ type: 'overlapping-ranges' })
    }
    view.dispatch({
      effects: replaceInFlight.of({ scope: this.effectScope, value: position }),
    })
    return ok(undefined)
  }

  overlapsOtherLayer(position: SuggestionPosition): boolean {
    const view = this.view
    if (!view) return false

    for (const layer of mountedSuggestionLayers.get(view) ?? []) {
      if (layer === this) continue
      const state = view.state.field(layer.stateField, false)
      if (!state) continue
      if (
        state.suggestions.some((suggestion) =>
          rangesOverlap(suggestion, position),
        ) ||
        (state.inFlight !== null && rangesOverlap(state.inFlight, position))
      ) {
        return true
      }
    }

    return false
  }

  accept(id: string): void {
    const view = this.view
    const suggestion = this.findSuggestion(id)
    if (!view || !suggestion) return

    view.dispatch({
      changes: {
        from: suggestion.from,
        to: suggestion.to,
        insert: suggestion.replacement,
      },
      effects: removeSuggestion.of({ scope: this.effectScope, value: id }),
      annotations: [
        Transaction.userEvent.of('input.type'),
        isolateHistory.of('full'),
      ],
    })
    view.focus()
    const acceptedRange =
      this.options.trackAcceptedRanges === true
        ? this.trackedRanges.track({
            from: suggestion.from,
            to: suggestion.from + suggestion.replacement.length,
          })
        : undefined
    this.options.onResolve?.(suggestion, 'accept', acceptedRange)
  }

  reject(id: string): void {
    const view = this.view
    const suggestion = this.findSuggestion(id)
    if (!view || !suggestion) return
    view.dispatch({
      effects: removeSuggestion.of({ scope: this.effectScope, value: id }),
    })
    view.focus()
    this.options.onResolve?.(suggestion, 'reject')
  }

  focus(id: string): void {
    const suggestion = this.findSuggestion(id)
    if (!suggestion || !this.view) return
    this.view.dispatch({
      selection: { anchor: suggestion.from },
      scrollIntoView: true,
    })
    this.view.focus()
  }

  private acceptFocusedSuggestion(): boolean {
    const focused = this.focusedSuggestion()
    if (!focused) return false
    this.accept(focused.id)
    return true
  }

  private navigateSuggestions(view: EditorView): boolean {
    const line = view.state.doc.lineAt(view.state.selection.main.head)
    if (/^\s*(?:[-*+]|\d+[.)])\s/.test(line.text) && indentMore(view)) {
      return true
    }

    const state = view.state.field(this.stateField, false)
    const suggestions = state?.suggestions ?? []
    if (suggestions.length === 0) return false
    const head = view.state.selection.main.head
    const next = suggestions.find(({ from }) => from > head) ?? suggestions[0]
    if (!next) return false
    view.dispatch({
      selection: { anchor: next.from },
      scrollIntoView: true,
    })
    return true
  }

  private cancelInFlight(): boolean {
    const view = this.view
    const state = view?.state.field(this.stateField, false)
    if (!state?.inFlight) return false
    this.setInFlight(null).match(
      () => undefined,
      () => undefined,
    )
    this.options.onCancelInFlight?.()
    return true
  }

  private rejectFocusedSuggestion(): boolean {
    const focused = this.focusedSuggestion()
    if (!focused) return false
    this.reject(focused.id)
    return true
  }

  private findSuggestion(id: string): TextSuggestion | undefined {
    return this.view?.state
      .field(this.stateField, false)
      ?.suggestions.find((suggestion) => suggestion.id === id)
  }

  private focusedSuggestion(): TextSuggestion | undefined {
    const state = this.view?.state.field(this.stateField, false)
    return state?.suggestions.find(({ id }) => id === state.focusedId)
  }

  private createSuggestionId(suggestions: readonly TextSuggestion[]): string {
    let id = `in-flight-${String(this.nextGeneratedId)}`
    while (suggestions.some((suggestion) => suggestion.id === id)) {
      this.nextGeneratedId += 1
      id = `in-flight-${String(this.nextGeneratedId)}`
    }
    this.nextGeneratedId += 1
    return id
  }
}

export function createSuggestionLayer(
  options?: SuggestionLayerOptions,
): SuggestionLayerController {
  return new SuggestionLayerController(options)
}
