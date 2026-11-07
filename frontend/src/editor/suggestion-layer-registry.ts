import type { EditorView } from '@codemirror/view'

import type {
  InFlightSuggestion,
  SuggestionPosition,
} from '#editor/suggestion-layer-range'

type SuggestionLayerSnapshot = {
  suggestions: readonly SuggestionPosition[]
  inFlight: InFlightSuggestion | null
}

export type GetSuggestionLayerSnapshot = () => SuggestionLayerSnapshot

const mountedSuggestionLayers = new WeakMap<
  EditorView,
  Set<GetSuggestionLayerSnapshot>
>()

/** Returns a function that removes the layer from the view again. */
export function registerSuggestionLayer(
  view: EditorView,
  getSnapshot: GetSuggestionLayerSnapshot,
): () => void {
  const viewLayers = mountedSuggestionLayers.get(view)
  if (viewLayers) {
    viewLayers.add(getSnapshot)
  } else {
    mountedSuggestionLayers.set(view, new Set([getSnapshot]))
  }
  return () => {
    const layers = mountedSuggestionLayers.get(view)
    layers?.delete(getSnapshot)
    if (layers?.size === 0) mountedSuggestionLayers.delete(view)
  }
}

export function suggestionLayerSnapshots(
  view: EditorView,
): GetSuggestionLayerSnapshot[] {
  return Array.from(mountedSuggestionLayers.get(view) ?? [])
}
