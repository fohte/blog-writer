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
  const eligible: TrackedIdRange[] = []
  if (target.eligibility === 'concurrent-or-restored' && record) {
    const concurrent = getConcurrentClockRange(doc, record, range.client)
    const intersection = concurrent && intersectIdRange(range, concurrent)
    if (
      intersection?.clock === range.clock &&
      intersection.length === range.length
    ) {
      return [range]
    }
    if (intersection) eligible.push(intersection)
  }
  if (restorations.length === 0) return eligible
  for (const restoration of restorations) {
    const intersection = intersectIdRange(range, restoration)
    if (intersection) eligible.push(intersection)
  }
  return eligible.length < 2 ? eligible : coalesceIdRanges(eligible)
}
