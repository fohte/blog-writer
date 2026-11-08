import { isolateHistory } from '@codemirror/commands'
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
  blockWidgetExclusionProviders,
  refreshBlockWidgetExclusions,
} from '#editor/markdown-block-widget-exclusions'
import {
  indentListOrMoveToNextSuggestion,
  moveToAdjacentSuggestion,
  moveToNextSuggestion,
  type SuggestionDirection,
  suggestionStops,
} from '#editor/suggestion-layer-navigation'
import {
  focusForSelection,
  hasOverlappingRange,
  type InFlightSuggestion,
  isRangeValid,
  mapRange,
  rangesOverlap,
  type SuggestionDecision,
  type SuggestionLayerError,
  type SuggestionLayerState,
  type SuggestionPosition,
  type SuggestionReplacementMark,
  type TextSuggestion,
  type TrackedSuggestionRange,
  validateSuggestions,
} from '#editor/suggestion-layer-range'
import {
  type GetSuggestionLayerSnapshot,
  registerSuggestionLayer,
  suggestionLayerSnapshots,
} from '#editor/suggestion-layer-registry'
import { SuggestionRangeTracker } from '#editor/suggestion-layer-tracking'
import {
  createSuggestionDecorations,
  suggestionActionsPresentation,
  type SuggestionDisplay,
  suggestionLayerTheme,
} from '#editor/suggestion-layer-view'

export type {
  InFlightSuggestion,
  SuggestionDecision,
  SuggestionLayerError,
  SuggestionLayerState,
  SuggestionPosition,
  SuggestionReplacementMark,
  TextSuggestion,
  TrackedSuggestionRange,
} from '#editor/suggestion-layer-range'

type ScopedEffect<Value> = { scope: symbol; value: Value }

const replaceInFlight =
  StateEffect.define<ScopedEffect<InFlightSuggestion | null>>()
const removeSuggestion = StateEffect.define<ScopedEffect<string>>()

export interface SuggestionLayerOptions<Metadata = unknown> {
  initialSuggestions?: readonly TextSuggestion<Metadata>[]
  initialInFlight?: InFlightSuggestion
  display?: SuggestionDisplay
  trackAcceptedRanges?: boolean
  onResolve?: (
    suggestion: TextSuggestion<Metadata>,
    decision: SuggestionDecision,
    acceptedRange?: TrackedSuggestionRange,
  ) => void
  onCancelInFlight?: () => void
  onInFlightRangeEdited?: () => void
}

export class SuggestionLayerController<Metadata = unknown> {
  readonly extension: Extension
  private readonly effectScope = Symbol()
  private readonly replaceSuggestions =
    StateEffect.define<ScopedEffect<readonly TextSuggestion<Metadata>[]>>()
  private view: EditorView | null = null
  private readonly stateField: StateField<SuggestionLayerState<Metadata>>
  private nextGeneratedId = 0
  private readonly trackedRanges = new SuggestionRangeTracker()
  private readonly getSuggestionLayerSnapshot: GetSuggestionLayerSnapshot =
    () => {
      const state = this.view?.state.field(this.stateField, false)
      return {
        suggestions: state?.suggestions ?? [],
        inFlight: state?.inFlight ?? null,
      }
    }

  constructor(private readonly options: SuggestionLayerOptions<Metadata> = {}) {
    this.stateField = StateField.define<SuggestionLayerState<Metadata>>({
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
            effect.is(this.replaceSuggestions) &&
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
            const range = mapRange(inFlight, transaction.changes, changedRanges)
            inFlight = range ? { ...inFlight, ...range } : null
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
        return [
          EditorView.decorations.compute(
            [field, suggestionActionsPresentation, suggestionStops],
            (state) =>
              createSuggestionDecorations(
                state.field(field),
                state,
                this,
                options.display ?? 'marker',
              ),
          ),
          blockWidgetExclusionProviders.from(
            field,
            (value) => () =>
              value.inFlight
                ? [
                    ...value.suggestions.map(({ from, to }) => ({ from, to })),
                    value.inFlight,
                  ]
                : value.suggestions.map(({ from, to }) => ({ from, to })),
          ),
        ]
      },
    })

    this.extension = [
      this.stateField,
      suggestionStops.compute(
        [this.stateField],
        (state) => state.field(this.stateField).suggestions,
      ),
      ViewPlugin.define((view) => {
        this.view = view
        const unregister = registerSuggestionLayer(
          view,
          this.getSuggestionLayerSnapshot,
        )
        return {
          destroy: () => {
            unregister()
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
          { key: 'Tab', run: indentListOrMoveToNextSuggestion },
          { key: 'Escape', run: () => this.rejectFocusedSuggestion() },
          { key: 'Alt-]', run: moveToNextSuggestion },
          // macOS reports the character Option+] types, and CodeMirror does not fall back to the key's base name there.
          { key: 'Alt-‘', run: moveToNextSuggestion },
        ]),
      ),
      suggestionLayerTheme,
    ]
  }

  setSuggestions(
    suggestions: readonly TextSuggestion<Metadata>[],
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
      effects: [
        this.replaceSuggestions.of({
          scope: this.effectScope,
          value: validation.value,
        }),
        refreshBlockWidgetExclusions.of(null),
      ],
    })
    return ok(undefined)
  }

  addSuggestion(
    suggestion: TextSuggestion<Metadata>,
  ): Result<void, SuggestionLayerError> {
    const suggestions =
      this.view?.state.field(this.stateField, false)?.suggestions ?? []
    return this.setSuggestions([...suggestions, suggestion])
  }

  resolveInFlight(
    replacement: string | ((position: SuggestionPosition) => string),
    details?: {
      metadata?: Metadata
      replacementMarks?: readonly SuggestionReplacementMark[]
    },
  ): Result<void, SuggestionLayerError> {
    const view = this.view
    const state = view?.state.field(this.stateField, false)
    if (!view || !state?.inFlight) return ok(undefined)

    const { label, ...position } = state.inFlight
    const id = this.createSuggestionId(state.suggestions)
    const replacementText =
      typeof replacement === 'string' ? replacement : replacement(position)
    // The pending range is itself the replacement, so it is not a conflict.
    const validation = validateSuggestions(
      [
        ...state.suggestions,
        {
          ...position,
          id,
          replacement: replacementText,
          ...(label === undefined ? {} : { label }),
          ...(details?.metadata === undefined
            ? {}
            : { metadata: details.metadata }),
          ...(details?.replacementMarks === undefined
            ? {}
            : { replacementMarks: details.replacementMarks }),
        },
      ],
      view.state.doc.length,
    )
    if (validation.isErr()) return err(validation.error)
    view.dispatch({
      effects: [
        this.replaceSuggestions.of({
          scope: this.effectScope,
          value: validation.value,
        }),
        replaceInFlight.of({ scope: this.effectScope, value: null }),
        refreshBlockWidgetExclusions.of(null),
      ],
    })
    return ok(undefined)
  }

  setInFlight(
    position: InFlightSuggestion | null,
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
      effects: [
        replaceInFlight.of({ scope: this.effectScope, value: position }),
        refreshBlockWidgetExclusions.of(null),
      ],
    })
    return ok(undefined)
  }

  getInFlight(): InFlightSuggestion | null {
    const view = this.view
    return view?.state.field(this.stateField, false)?.inFlight ?? null
  }

  overlapsOtherLayer(position: SuggestionPosition): boolean {
    const view = this.view
    if (!view) return false

    for (const getRanges of suggestionLayerSnapshots(view)) {
      if (getRanges === this.getSuggestionLayerSnapshot) continue
      const { inFlight, suggestions } = getRanges()
      if (
        [...suggestions, ...(inFlight ? [inFlight] : [])].some((range) =>
          rangesOverlap(range, position),
        )
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
      effects: [
        removeSuggestion.of({ scope: this.effectScope, value: id }),
        refreshBlockWidgetExclusions.of(null),
      ],
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
      effects: [
        removeSuggestion.of({ scope: this.effectScope, value: id }),
        refreshBlockWidgetExclusions.of(null),
      ],
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

  moveFocus(direction: SuggestionDirection): void {
    if (this.view) moveToAdjacentSuggestion(this.view, direction)
  }

  // Without a handler, cancelling only hides the marker while the work keeps running.
  get inFlightCancellable(): boolean {
    return this.options.onCancelInFlight !== undefined
  }

  cancelInFlight(): boolean {
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

  private findSuggestion(id: string): TextSuggestion<Metadata> | undefined {
    return this.view?.state
      .field(this.stateField, false)
      ?.suggestions.find((suggestion) => suggestion.id === id)
  }

  private focusedSuggestion(): TextSuggestion<Metadata> | undefined {
    const state = this.view?.state.field(this.stateField, false)
    return state?.suggestions.find(({ id }) => id === state.focusedId)
  }

  private createSuggestionId(
    suggestions: readonly TextSuggestion<Metadata>[],
  ): string {
    let id = `in-flight-${String(this.nextGeneratedId)}`
    while (suggestions.some((suggestion) => suggestion.id === id)) {
      this.nextGeneratedId += 1
      id = `in-flight-${String(this.nextGeneratedId)}`
    }
    this.nextGeneratedId += 1
    return id
  }
}

export function createSuggestionLayer<Metadata = unknown>(
  options?: SuggestionLayerOptions<Metadata>,
): SuggestionLayerController<Metadata> {
  return new SuggestionLayerController(options)
}
