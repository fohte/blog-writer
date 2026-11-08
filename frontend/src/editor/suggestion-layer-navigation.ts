import { indentMore } from '@codemirror/commands'
import { Facet } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

import type { SuggestionPosition } from '#editor/suggestion-layer-range'

export type SuggestionDirection = 'next' | 'previous'

/** Every layer's suggestions in document order, because moving between them crosses layers. */
export const suggestionStops = Facet.define<
  readonly SuggestionPosition[],
  readonly SuggestionPosition[]
>({
  combine: (layers) =>
    layers
      .flat()
      .sort((left, right) => left.from - right.from || left.to - right.to),
})

function adjacentStop(
  stops: readonly SuggestionPosition[],
  head: number,
  direction: SuggestionDirection,
): SuggestionPosition | undefined {
  // Comparing with the cursor rather than the focused stop keeps moving when a stop starts where the focused one ends.
  return direction === 'next'
    ? (stops.find(({ from }) => from > head) ?? stops[0])
    : (stops.findLast(({ to }) => to < head) ?? stops.at(-1))
}

export function moveToAdjacentSuggestion(
  view: EditorView,
  direction: SuggestionDirection,
): boolean {
  const stop = adjacentStop(
    view.state.facet(suggestionStops),
    view.state.selection.main.head,
    direction,
  )
  if (!stop) return false
  view.dispatch({ selection: { anchor: stop.from }, scrollIntoView: true })
  view.focus()
  return true
}

export function moveToNextSuggestion(view: EditorView): boolean {
  return moveToAdjacentSuggestion(view, 'next')
}

export function indentListOrMoveToNextSuggestion(view: EditorView): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  if (/^\s*(?:[-*+]|\d+[.)])\s/.test(line.text) && indentMore(view)) {
    return true
  }
  return moveToNextSuggestion(view)
}
