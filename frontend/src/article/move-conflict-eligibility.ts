import * as Y from 'yjs'

import {
  coalesceIdRanges,
  intersectIdRange,
  type TrackedIdRange,
} from '#article/move-conflict-ranges'
import {
  getConcurrentClockRange,
  type TrackedTarget,
} from '#article/move-conflict-records'
import type { MoveRecord } from '#article/move-conflict-source'

export type MoveConflictTarget = {
  target: TrackedTarget
  position: number
  recordId: string
  eligibility: 'all' | 'concurrent-or-restored' | 'restored-only'
}

export function getMoveConflictEligibleRanges(
  doc: Y.Doc,
  range: TrackedIdRange,
  record: MoveRecord | undefined,
  target: MoveConflictTarget,
  restorations: TrackedIdRange[],
): TrackedIdRange[] {
  if (target.eligibility === 'all') return [range]
  const candidateRanges = [
    ...(target.eligibility === 'concurrent-or-restored' && record
      ? [getConcurrentClockRange(doc, record, range.client)]
      : []),
    ...restorations,
  ]
  return coalesceIdRanges(
    candidateRanges.flatMap((candidate) => {
      if (!candidate) return []
      const intersection = intersectIdRange(range, candidate)
      return intersection ? [intersection] : []
    }),
  )
}
