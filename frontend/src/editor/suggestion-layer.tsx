import { indentMore } from '@codemirror/commands'
import {
  type EditorState,
  type Extension,
  Prec,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view'
import { err, ok, type Result } from 'neverthrow'
import { createRoot, type Root } from 'react-dom/client'

import { SuggestionDiff } from '#components/suggestion-diff'
import { undoManagerFacet } from '#editor/undo-manager-facet'

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

interface SuggestionLayerState {
  suggestions: readonly TextSuggestion[]
  inFlight: SuggestionPosition | null
  focusedId: string | null
}

const replaceSuggestions = StateEffect.define<readonly TextSuggestion[]>()
const replaceInFlight = StateEffect.define<SuggestionPosition | null>()
const removeSuggestion = StateEffect.define<string>()
const rootsByDOM = new WeakMap<HTMLElement, Root>()

function changedRangeTouchesSuggestion(
  from: number,
  to: number,
  changedFrom: number,
  changedTo: number,
): boolean {
  if (changedFrom === changedTo) {
    return changedFrom >= from && changedFrom <= to
  }
  if (from === to) return changedFrom <= from && changedTo >= from
  return changedFrom < to && changedTo > from
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

function createDecorations(
  state: SuggestionLayerState,
  editorState: EditorState,
  controller: SuggestionLayerController,
): DecorationSet {
  const decorations = state.suggestions.map((suggestion) => {
    const original = editorState.doc.sliceString(suggestion.from, suggestion.to)
    return Decoration.replace({
      block: true,
      widget: new SuggestionDiffWidget(
        suggestion,
        original,
        suggestion.id === state.focusedId,
        controller,
      ),
    }).range(suggestion.from, suggestion.to)
  })

  if (state.inFlight) {
    decorations.push(
      Decoration.widget({
        block: true,
        side: 1,
        widget: new SuggestionDiffWidget(null, '', false, controller),
      }).range(state.inFlight.from),
    )
  }

  return Decoration.set(decorations, true)
}

class SuggestionDiffWidget extends WidgetType {
  constructor(
    readonly suggestion: TextSuggestion | null,
    readonly original: string,
    readonly focused: boolean,
    private readonly controller: SuggestionLayerController,
  ) {
    super()
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof SuggestionDiffWidget &&
      other.suggestion?.id === this.suggestion?.id &&
      other.suggestion?.from === this.suggestion?.from &&
      other.suggestion?.to === this.suggestion?.to &&
      other.suggestion?.replacement === this.suggestion?.replacement &&
      other.original === this.original &&
      other.focused === this.focused
    )
  }

  override toDOM(): HTMLElement {
    const dom = document.createElement('div')
    dom.className = 'cm-suggestion-widget'
    const root = createRoot(dom)
    const suggestion = this.suggestion
    rootsByDOM.set(dom, root)
    root.render(
      suggestion ? (
        <SuggestionDiff
          focused={this.focused}
          {...(this.focused
            ? {
                onAccept: () => {
                  this.controller.accept(suggestion.id)
                },
                onReject: () => {
                  this.controller.reject(suggestion.id)
                },
              }
            : {})}
          original={this.original}
          replacement={suggestion.replacement}
        />
      ) : (
        <SuggestionDiff generating original="" replacement="" />
      ),
    )
    return dom
  }

  override destroy(dom: HTMLElement): void {
    rootsByDOM.get(dom)?.unmount()
    rootsByDOM.delete(dom)
  }

  override ignoreEvent(): boolean {
    return true
  }
}

export interface SuggestionLayerOptions {
  onResolve?: (suggestion: TextSuggestion, decision: SuggestionDecision) => void
  onCancelInFlight?: () => void
}

export class SuggestionLayerController {
  readonly extension: Extension
  private view: EditorView | null = null
  private readonly stateField: StateField<SuggestionLayerState>

  constructor(private readonly options: SuggestionLayerOptions = {}) {
    this.stateField = StateField.define<SuggestionLayerState>({
      create: () => ({
        suggestions: [],
        inFlight: null,
        focusedId: null,
      }),
      update: (value, transaction) => {
        let suggestions = value.suggestions
        let inFlight = value.inFlight

        for (const effect of transaction.effects) {
          if (effect.is(replaceSuggestions)) suggestions = effect.value
          if (effect.is(replaceInFlight)) inFlight = effect.value
          if (effect.is(removeSuggestion)) {
            suggestions = suggestions.filter(({ id }) => id !== effect.value)
          }
        }

        if (transaction.docChanged) {
          const changedRanges: Array<[number, number]> = []
          transaction.changes.iterChangedRanges((fromA, toA) => {
            changedRanges.push([fromA, toA])
          })
          suggestions = suggestions.flatMap((suggestion) => {
            if (
              changedRanges.some(([from, to]) =>
                changedRangeTouchesSuggestion(
                  suggestion.from,
                  suggestion.to,
                  from,
                  to,
                ),
              )
            ) {
              return []
            }
            return [
              {
                ...suggestion,
                from: transaction.changes.mapPos(suggestion.from, 1),
                to: transaction.changes.mapPos(suggestion.to, 1),
              },
            ]
          })

          if (inFlight) {
            const currentInFlight = inFlight
            inFlight = changedRanges.some(([from, to]) =>
              changedRangeTouchesSuggestion(
                currentInFlight.from,
                currentInFlight.to,
                from,
                to,
              ),
            )
              ? null
              : {
                  from: transaction.changes.mapPos(currentInFlight.from, 1),
                  to: transaction.changes.mapPos(currentInFlight.to, 1),
                }
          }
        }

        return {
          suggestions,
          inFlight,
          focusedId: focusForSelection(
            suggestions,
            transaction.newSelection.main.head,
          ),
        }
      },
      provide: (field) => {
        return EditorView.decorations.compute([field], (state) =>
          createDecorations(state.field(field), state, this),
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
      Prec.highest(
        keymap.of([
          { key: 'Tab', run: (view) => this.handleTab(view) },
          { key: 'Escape', run: () => this.handleEscape() },
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

    const ids = new Set<string>()
    for (const suggestion of suggestions) {
      if (
        !isRangeValid(suggestion.from, suggestion.to, view.state.doc.length) ||
        ids.has(suggestion.id)
      ) {
        return err({ type: 'invalid-range', id: suggestion.id })
      }
      ids.add(suggestion.id)
    }

    const ordered = [...suggestions].sort(
      (a, b) => a.from - b.from || a.to - b.to,
    )
    for (const [index, current] of ordered.slice(1).entries()) {
      const previous = ordered[index]
      if (!previous) continue
      if (current.from < previous.to || current.from === previous.from) {
        return err({ type: 'overlapping-ranges' })
      }
    }

    view.dispatch({ effects: replaceSuggestions.of(suggestions) })
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
    view.dispatch({ effects: replaceInFlight.of(position) })
    return ok(undefined)
  }

  accept(id: string): void {
    const view = this.view
    const suggestion = view?.state
      .field(this.stateField, false)
      ?.suggestions.find((candidate) => candidate.id === id)
    if (!view || !suggestion) return

    view.state.facet(undoManagerFacet)?.stopCapturing()
    view.dispatch({
      changes: {
        from: suggestion.from,
        to: suggestion.to,
        insert: suggestion.replacement,
      },
      effects: removeSuggestion.of(id),
      annotations: Transaction.userEvent.of('input.type'),
    })
    view.state.facet(undoManagerFacet)?.stopCapturing()
    this.options.onResolve?.(suggestion, 'accept')
  }

  reject(id: string): void {
    const view = this.view
    const suggestion = view?.state
      .field(this.stateField, false)
      ?.suggestions.find((candidate) => candidate.id === id)
    if (!view || !suggestion) return
    view.dispatch({ effects: removeSuggestion.of(id) })
    this.options.onResolve?.(suggestion, 'reject')
  }

  private handleTab(view: EditorView): boolean {
    const state = view.state.field(this.stateField, false)
    const focused = state?.suggestions.find(({ id }) => id === state.focusedId)
    if (focused) {
      this.accept(focused.id)
      return true
    }

    const line = view.state.doc.lineAt(view.state.selection.main.head)
    if (/^\s*(?:[-*+]|\d+[.)])\s/.test(line.text) && indentMore(view)) {
      return true
    }

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

  private handleEscape(): boolean {
    const view = this.view
    const state = view?.state.field(this.stateField, false)
    if (state?.inFlight) {
      this.setInFlight(null).match(
        () => undefined,
        () => undefined,
      )
      this.options.onCancelInFlight?.()
      return true
    }
    const focused = state?.suggestions.find(({ id }) => id === state.focusedId)
    if (focused) {
      this.reject(focused.id)
      return true
    }
    return false
  }
}

export function createSuggestionLayer(
  options?: SuggestionLayerOptions,
): SuggestionLayerController {
  return new SuggestionLayerController(options)
}
