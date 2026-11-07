import { err, errAsync, ok, type Result, ResultAsync } from 'neverthrow'
import * as Y from 'yjs'

import {
  addEvidence,
  getBody,
  listEvidenceOverlapping,
  removeEvidence,
} from '#article/index'
import type { EvidenceVerdict } from '#article/types'
import type { SavedResearchJobResult } from '#research/research-from-heading'
import {
  ResearchJobInterruptedError,
  ResearchJobInterruptedWithSavedSourcesError,
} from '#research/research-job'

type ClaimEvidenceSnapshot = {
  id: string
  from: number
  to: number
  claim: string
  sourceId: string | null
  quote: string
  verdict: EvidenceVerdict
  checkedAt: string
}

export function snapshotClaimEvidence(
  doc: Y.Doc,
  range: { from: number; to: number },
  claim: string,
): ClaimEvidenceSnapshot[] {
  const body = getBody(doc)
  return listEvidenceOverlapping(doc, range).flatMap((item) => {
    if (item.currentClaim !== claim) return []
    const from = Y.createAbsolutePositionFromRelativePosition(item.from, doc)
    const to = Y.createAbsolutePositionFromRelativePosition(item.to, doc)
    if (!from || !to || from.type !== body || to.type !== body) return []
    return [
      {
        id: item.id,
        from: from.index,
        to: to.index,
        claim: item.claim,
        sourceId: item.sourceId,
        quote: item.quote,
        verdict: item.verdict,
        checkedAt: item.checkedAt,
      },
    ]
  })
}

function restoreClaimEvidence(
  doc: Y.Doc,
  currentEvidenceId: string,
  previousEvidence: ClaimEvidenceSnapshot[],
): Result<void, Error> {
  const ids = new Set([
    currentEvidenceId,
    ...previousEvidence.map(({ id }) => id),
  ])
  for (const id of ids) removeEvidence(doc, id)

  return doc.transact(() => {
    for (const evidence of previousEvidence) {
      const result = addEvidence(doc, evidence)
      if (result.isErr()) return err(result.error)
    }
    return ok(undefined)
  })
}

export function rollbackClaimEvidenceResult(
  savedResult: SavedResearchJobResult,
  error: Error,
  evidence?: {
    doc: Y.Doc
    currentEvidenceId: string
    previousEvidence: ClaimEvidenceSnapshot[]
  },
): ResultAsync<never, Error> {
  const evidenceResult =
    evidence === undefined
      ? ok(undefined)
      : restoreClaimEvidence(
          evidence.doc,
          evidence.currentEvidenceId,
          evidence.previousEvidence,
        )
  return savedResult.rollback().andThen((preservedSourceIds) => {
    if (evidenceResult.isErr()) return errAsync(evidenceResult.error)
    if (
      error instanceof ResearchJobInterruptedError &&
      preservedSourceIds.length > 0
    )
      return errAsync(new ResearchJobInterruptedWithSavedSourcesError(error))
    return errAsync(error)
  })
}
