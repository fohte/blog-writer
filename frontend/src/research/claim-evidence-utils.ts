import * as Y from 'yjs'

import type { ClaimEvidenceResult } from '#research/claim-evidence'
import type { SavedResearchSource } from '#research/research-from-heading'

export type ClaimEvidenceTarget = {
  articleId: string
  doc: Y.Doc
  claim: string
  range: { from: number; to: number }
  before?: string
  after?: string
}

export function selectedResearchJobSource(
  result: ClaimEvidenceResult,
  sources: SavedResearchSource[],
) {
  if (result.quote)
    return sources.find(
      ({ researchId }) => researchId === result.quote?.source_id,
    )
  return sources[0]
}

export function selectedSavedSource(
  result: ClaimEvidenceResult,
  sources: SavedResearchSource[],
) {
  if (result.quote)
    return sources.find(({ id }) => id === result.quote?.source_id)
  return sources[0]
}
