import type { StateField } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

import type {
  SuggestionLayerState,
  TextSuggestion,
} from '#editor/suggestion-layer-range'

export function findSuggestion<Metadata>(
  view: EditorView | null,
  stateField: StateField<SuggestionLayerState<Metadata>>,
  id: string,
): TextSuggestion<Metadata> | undefined {
  return view?.state
    .field(stateField, false)
    ?.suggestions.find((suggestion) => suggestion.id === id)
}

export function findFocusedSuggestion<Metadata>(
  view: EditorView | null,
  stateField: StateField<SuggestionLayerState<Metadata>>,
): TextSuggestion<Metadata> | undefined {
  const state = view?.state.field(stateField, false)
  return state?.suggestions.find(({ id }) => id === state.focusedId)
}

export function createSuggestionId<Metadata>(
  suggestions: readonly TextSuggestion<Metadata>[],
  nextGeneratedId: number,
): { id: string; nextGeneratedId: number } {
  let id = `in-flight-${String(nextGeneratedId)}`
  while (suggestions.some((suggestion) => suggestion.id === id)) {
    nextGeneratedId += 1
    id = `in-flight-${String(nextGeneratedId)}`
  }
  return { id, nextGeneratedId: nextGeneratedId + 1 }
}
