import * as Y from 'yjs'

import {
  createSuggestionLayer,
  type SuggestionDecision,
  type TextSuggestion,
  type TrackedSuggestionRange,
} from '#editor/suggestion-layer'

export type ClaimEvidenceSuggestionMetadata = {
  sourceId: string
  checkedAt: string
  before?: string
  after?: string
  sourceBodies: { id: string; body: string }[]
  sources: {
    id: string
    researchId: string
    title: string
    url: string
    status: 'available' | 'unavailable'
    body?: string
  }[]
  evidenceIds: string[]
  doc: Y.Doc
}

type ResolveHandler = (
  suggestion: TextSuggestion<ClaimEvidenceSuggestionMetadata>,
  decision: SuggestionDecision,
  acceptedRange?: TrackedSuggestionRange,
) => void

type LayerManager = {
  layer: ReturnType<
    typeof createSuggestionLayer<ClaimEvidenceSuggestionMetadata>
  >
  onResolve: ResolveHandler
  onRangeEdited: () => void
}

const managers = new WeakMap<Y.Doc, LayerManager>()

function getManager(
  doc: Y.Doc,
  onResolve: ResolveHandler,
  onRangeEdited?: () => void,
): LayerManager {
  let manager = managers.get(doc)
  if (!manager) {
    manager = {
      layer: createSuggestionLayer<ClaimEvidenceSuggestionMetadata>({
        trackAcceptedRanges: true,
        onResolve: (...args) => manager?.onResolve(...args),
        onInFlightRangeEdited: () => manager?.onRangeEdited(),
      }),
      onResolve,
      onRangeEdited: onRangeEdited ?? (() => undefined),
    }
    managers.set(doc, manager)
  }
  manager.onResolve = onResolve
  if (onRangeEdited) manager.onRangeEdited = onRangeEdited
  return manager
}

export function claimEvidenceExtension(doc: Y.Doc, onResolve: ResolveHandler) {
  return getManager(doc, onResolve).layer.extension
}

export function claimEvidenceLayerOverlaps(
  doc: Y.Doc,
  range: { from: number; to: number },
  onResolve: ResolveHandler,
): boolean {
  return getManager(doc, onResolve).layer.overlapsOtherLayer(range)
}

export function setClaimEvidenceSuggestion(
  doc: Y.Doc,
  suggestion: TextSuggestion<ClaimEvidenceSuggestionMetadata>,
  onResolve: ResolveHandler,
) {
  return getManager(doc, onResolve).layer.setSuggestions([suggestion])
}

export function setClaimEvidenceInFlight(
  doc: Y.Doc,
  range: { from: number; to: number },
  onResolve: ResolveHandler,
  onRangeEdited: () => void,
) {
  return getManager(doc, onResolve, onRangeEdited).layer.setInFlight(range)
}

export function clearClaimEvidenceInFlight(
  doc: Y.Doc,
  onResolve: ResolveHandler,
  onRangeEdited: () => void,
) {
  getManager(doc, onResolve, onRangeEdited)
    .layer.setInFlight(null)
    .match(
      () => undefined,
      () => undefined,
    )
}

export function currentClaimEvidenceInFlight(
  doc: Y.Doc,
  onResolve: ResolveHandler,
  onRangeEdited: () => void,
) {
  return getManager(doc, onResolve, onRangeEdited).layer.getInFlight()
}
