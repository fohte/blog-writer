import * as Y from 'yjs'

import {
  createSuggestionLayer,
  type SuggestionDecision,
  type TextSuggestion,
  type TrackedSuggestionRange,
} from '#editor/suggestion-layer'

export type ClaimEvidenceSuggestionMetadata = {
  articleId: string
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
    status: 'available' | 'unavailable' | 'login_required'
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

const suggestionListeners = new WeakMap<Y.Doc, Set<() => void>>()

function notifySuggestionListeners(doc: Y.Doc) {
  suggestionListeners.get(doc)?.forEach((listener) => {
    listener()
  })
}

/** Suggestions live in the editor state, so a doc observer does not see them resolve. */
export function observeClaimEvidenceSuggestions(
  doc: Y.Doc,
  listener: () => void,
): () => void {
  const listeners = suggestionListeners.get(doc) ?? new Set()
  suggestionListeners.set(doc, listeners)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function findClaimEvidenceSuggestion(doc: Y.Doc, evidenceId: string) {
  return managers
    .get(doc)
    ?.layer.getSuggestions()
    .find(({ metadata }) => metadata?.evidenceIds.includes(evidenceId) === true)
}

export function decideClaimEvidenceSuggestion(
  doc: Y.Doc,
  id: string,
  decision: SuggestionDecision,
) {
  const layer = managers.get(doc)?.layer
  if (decision === 'accept') layer?.accept(id)
  else layer?.reject(id)
}

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
        onResolve: (...args) => {
          manager?.onResolve(...args)
          notifySuggestionListeners(doc)
        },
        onInFlightRangeEdited: () => manager?.onRangeEdited(),
        // Cancelling from the editor stops the check the same way editing its range does.
        onCancelInFlight: () => manager?.onRangeEdited(),
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
  const result = getManager(doc, onResolve).layer.addSuggestion(suggestion)
  notifySuggestionListeners(doc)
  return result
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
