import { indentMore, isolateHistory } from '@codemirror/commands'
import {
  type ChangeSet,
  type Extension,
  Prec,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state'
import { EditorView, keymap, ViewPlugin } from '@codemirror/view'
import { err, ok, type Result } from 'neverthrow'

import { createSuggestionDecorations } from '#editor/suggestion-layer-view'

export interface TextSuggestion {
  id: string
  from: number
  to: number
  replacement: string
}

export interface SuggestionPosition {
  from: number
  to: number
}

export type SuggestionDecision = 'accept' | 'reject'

export type SuggestionLayerError =
  | { type: 'invalid-range'; id: string }
  | { type: 'overlapping-ranges' }
  | { type: 'not-mounted' }

export interface SuggestionLayerState {
  suggestions: readonly TextSuggestion[]
  inFlight: SuggestionPosition | null
  focusedId: string | null
}

const replaceSuggestions = StateEffect.define<readonly TextSuggestion[]>()
const replaceInFlight = StateEffect.define<SuggestionPosition | null>()
const removeSuggestion = StateEffect.define<string>()

function changedRangeTouchesSuggestion(
  from: number,
  to: number,
  changedFrom: number,
  changedTo: number,
): boolean {
  if (changedFrom === changedTo) {
    return from === to
      ? changedFrom === from
      : changedFrom > from && changedFrom < to
  }
  if (from === to) {
    return changedFrom === changedTo
      ? changedFrom === from
      : changedFrom < from && changedTo > from
  }
  return changedFrom < to && changedTo > from
}

function mapRange(
  range: SuggestionPosition,
  changes: ChangeSet,
  changedRanges: readonly [number, number][],
): SuggestionPosition | null {
  if (
    changedRanges.some(([from, to]) =>
      changedRangeTouchesSuggestion(range.from, range.to, from, to),
    )
  ) {
    return null
  }
  return {
    from: changes.mapPos(range.from, 1),
    to: changes.mapPos(range.to, -1),
  }
}

function isRangeValid(from: number, to: number, docLength: number): boolean {
  return (
    Number.isInteger(from) &&
    Number.isInteger(to) &&
    from >= 0 &&
    to >= from &&
    to <= docLength
  )
}

function orderSuggestions(
  suggestions: readonly TextSuggestion[],
): TextSuggestion[] {
  return [...suggestions].sort((a, b) => a.from - b.from || a.to - b.to)
}

function rangesOverlap(
  first: SuggestionPosition,
  second: SuggestionPosition,
): boolean {
  if (first.from === first.to) {
    return second.from === second.to
      ? first.from === second.from
      : first.from >= second.from && first.from < second.to
  }
  if (second.from === second.to) {
    return second.from >= first.from && second.from < first.to
  }
  return first.from < second.to && second.from < first.to
}

function hasOverlappingRange(
  suggestions: readonly SuggestionPosition[],
  position: SuggestionPosition | null | undefined,
): boolean {
  return (
    position != null &&
    suggestions.some((range) => rangesOverlap(range, position))
  )
}

function validateSuggestions(
  suggestions: readonly TextSuggestion[],
  docLength: number,
): Result<TextSuggestion[], SuggestionLayerError> {
  const ids = new Set<string>()
  for (const suggestion of suggestions) {
    if (
      !isRangeValid(suggestion.from, suggestion.to, docLength) ||
      ids.has(suggestion.id)
    ) {
      return err({ type: 'invalid-range', id: suggestion.id })
    }
    ids.add(suggestion.id)
  }

  const ordered = orderSuggestions(suggestions)
  for (const [index, current] of ordered.slice(1).entries()) {
    const previous = ordered[index]
    if (previous && rangesOverlap(previous, current)) {
      return err({ type: 'overlapping-ranges' })
    }
  }
  return ok(ordered)
}

function focusForSelection(
  suggestions: readonly TextSuggestion[],
  head: number,
): string | null {
  return (
    suggestions.find(
      (suggestion) => head >= suggestion.from && head <= suggestion.to,
    )?.id ?? null
  )
}

export interface SuggestionLayerOptions {
  initialSuggestions?: readonly TextSuggestion[]
  initialInFlight?: SuggestionPosition
  onResolve?: (suggestion: TextSuggestion, decision: SuggestionDecision) => void
  onCancelInFlight?: () => void
}

export class SuggestionLayerController {
  readonly extension: Extension
  private view: EditorView | null = null
  private readonly stateField: StateField<SuggestionLayerState>
  private nextGeneratedId = 0

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
          if (effect.is(replaceSuggestions)) {
            suggestions = effect.value
            hasEffects = true
          }
          if (effect.is(replaceInFlight)) {
            inFlight = effect.value
            hasEffects = true
          }
          if (effect.is(removeSuggestion)) {
            suggestions = suggestions.filter(({ id }) => id !== effect.value)
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
        return {
          destroy: () => {
            if (this.view === view) this.view = null
          },
        }
      }),
      EditorView.updateListener.of((update) => {
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
          this.options.onCancelInFlight?.()
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

    view.dispatch({ effects: replaceSuggestions.of(validation.value) })
    return ok(undefined)
  }

  resolveInFlight(replacement: string): Result<void, SuggestionLayerError> {
    const view = this.view
    const state = view?.state.field(this.stateField, false)
    if (!view || !state?.inFlight) return ok(undefined)

    const id = this.createSuggestionId(state.suggestions)
    // The pending range is itself the replacement, so it is not a conflict.
    const validation = validateSuggestions(
      [...state.suggestions, { ...state.inFlight, id, replacement }],
      view.state.doc.length,
    )
    if (validation.isErr()) return err(validation.error)
    view.dispatch({
      effects: [
        replaceSuggestions.of(validation.value),
        replaceInFlight.of(null),
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
    view.dispatch({ effects: replaceInFlight.of(position) })
    return ok(undefined)
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
      effects: removeSuggestion.of(id),
      annotations: [
        Transaction.userEvent.of('input.type'),
        isolateHistory.of('full'),
      ],
    })
    view.focus()
    this.options.onResolve?.(suggestion, 'accept')
  }

  reject(id: string): void {
    const view = this.view
    const suggestion = this.findSuggestion(id)
    if (!view || !suggestion) return
    view.dispatch({ effects: removeSuggestion.of(id) })
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
