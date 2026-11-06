import type { TrackedId } from '#article/yjs-internals'

export type TrackedIdRange = TrackedId & { length: number }

export function coalesceIdRanges(ranges: TrackedIdRange[]): TrackedIdRange[] {
  const sorted = ranges.toSorted(
    (left, right) => left.client - right.client || left.clock - right.clock,
  )
  const result: TrackedIdRange[] = []
  for (const range of sorted) {
    const last = result.at(-1)
    if (
      last &&
      last.client === range.client &&
      last.clock + last.length >= range.clock
    ) {
      last.length =
        Math.max(last.clock + last.length, range.clock + range.length) -
        last.clock
    } else {
      result.push({ ...range })
    }
  }
  return result
}

export function getUnkeptMoveConflictRanges(
  decisionsByRecord: ReadonlyMap<string, TrackedIdRange[]>,
  recordId: string,
  range: TrackedIdRange,
): TrackedIdRange[] {
  const keptRanges = (decisionsByRecord.get(recordId) ?? []).filter(
    (stored) => stored.client === range.client,
  )
  if (keptRanges.length === 0) return [range]

  const end = range.clock + range.length
  let cursor = range.clock
  const unkept: TrackedIdRange[] = []
  for (const kept of keptRanges) {
    const keptEnd = kept.clock + kept.length
    if (keptEnd <= cursor || kept.clock >= end) continue
    const overlapStart = Math.max(cursor, kept.clock)
    if (cursor < overlapStart)
      unkept.push({
        client: range.client,
        clock: cursor,
        length: overlapStart - cursor,
      })
    cursor = Math.max(cursor, keptEnd)
    if (cursor >= end) break
  }
  if (cursor < end)
    unkept.push({ client: range.client, clock: cursor, length: end - cursor })
  return unkept
}
