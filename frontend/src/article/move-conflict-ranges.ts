import type { TrackedId } from '#article/yjs-internals'

export type TrackedIdRange = TrackedId & { length: number }

export function containsIdRange(
  range: TrackedIdRange,
  contained: TrackedIdRange,
): boolean {
  return (
    range.client === contained.client &&
    range.clock <= contained.clock &&
    range.clock + range.length >= contained.clock + contained.length
  )
}

export function intersectIdRange(
  left: TrackedIdRange,
  right: TrackedIdRange,
): TrackedIdRange | undefined {
  if (left.client !== right.client) return undefined
  const clock = Math.max(left.clock, right.clock)
  const end = Math.min(left.clock + left.length, right.clock + right.length)
  return clock < end
    ? { client: left.client, clock, length: end - clock }
    : undefined
}

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
