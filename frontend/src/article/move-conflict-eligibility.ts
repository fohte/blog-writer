import * as Y from 'yjs'

import {
  coalesceIdRanges,
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
  includeConcurrent: boolean
  includeAll: boolean
}

export function getMoveConflictEligibleRanges(
  doc: Y.Doc,
  range: TrackedIdRange,
  record: MoveRecord | undefined,
  target: MoveConflictTarget,
  restorations: TrackedIdRange[],
): TrackedIdRange[] {
  if (target.includeAll) return [range]

  const end = range.clock + range.length
  const eligible: TrackedIdRange[] = []
  if (target.includeConcurrent && record) {
    const concurrent = getConcurrentClockRange(doc, record, range.client)
    if (concurrent) {
      const start = Math.max(range.clock, concurrent.clock)
      const concurrentEnd = concurrent.clock + concurrent.length
      const overlapEnd = Math.min(end, concurrentEnd)
      if (start < overlapEnd) {
        eligible.push({
          client: range.client,
          clock: start,
          length: overlapEnd - start,
        })
      }
    }
  }
  for (const restoration of restorations) {
    if (restoration.client !== range.client) continue
    const start = Math.max(range.clock, restoration.clock)
    const restorationEnd = restoration.clock + restoration.length
    const overlapEnd = Math.min(end, restorationEnd)
    if (start < overlapEnd) {
      eligible.push({
        client: range.client,
        clock: start,
        length: overlapEnd - start,
      })
    }
  }
  return coalesceIdRanges(eligible)
}
