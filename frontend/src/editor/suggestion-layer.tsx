import { SuggestionLayerController } from '#editor/suggestion-layer-controller'
import type { SuggestionLayerOptions } from '#editor/suggestion-layer-types'

export { SuggestionLayerController }
export type {
  InFlightSuggestion,
  SuggestionDecision,
  SuggestionLayerError,
  SuggestionPosition,
  SuggestionReplacementMark,
  TextSuggestion,
  TrackedSuggestionRange,
} from '#editor/suggestion-layer-range'
export type { SuggestionLayerOptions } from '#editor/suggestion-layer-types'

export function createSuggestionLayer<Metadata = unknown>(
  options?: SuggestionLayerOptions<Metadata>,
): SuggestionLayerController<Metadata> {
  return new SuggestionLayerController(options)
}
