import type {
  InFlightSuggestion,
  SuggestionDecision,
  TextSuggestion,
  TrackedSuggestionRange,
} from '#editor/suggestion-layer-range'
import type { SuggestionDisplay } from '#editor/suggestion-layer-view'

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
