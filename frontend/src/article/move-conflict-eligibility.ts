import * as Y from 'yjs'

import {
  coalesceIdRanges,
  containsIdRange,
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
    // Restoration ranges cannot add IDs when concurrency already covers the item.
    if (concurrent && containsIdRange(concurrent, range)) return [range]
    const intersection = concurrent && intersectIdRange(range, concurrent)
    if (intersection) eligible.push(intersection)
  }
  for (const restoration of restorations) {
    const intersection = intersectIdRange(range, restoration)
    if (intersection) eligible.push(intersection)
  }
  return eligible.length < 2 ? eligible : coalesceIdRanges(eligible)
}
