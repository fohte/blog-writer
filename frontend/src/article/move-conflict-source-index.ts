import type { MoveRecord } from '#article/move-conflict-source'

export type MoveSourceMatch = {
  record: MoveRecord
  recordOrder: number
  sourceClock: number
  sourceOffset: number
}

type IndexedMoveSourceRange = {
  clock: number
  length: number
  offset: number
  prefixEnd: number
  record: MoveRecord
  recordOrder: number
  visible: number
}

export type MoveRecordSourceIndex = Map<number, IndexedMoveSourceRange[]>

type IndexedSourceRange = {
  clock: number
  length: number
  offset: number
  visible: number
}

const sourceIndexByRecord = new WeakMap<
  MoveRecord,
  Map<number, IndexedSourceRange[]>
>()

export function indexMoveRecordSources(
  records: MoveRecord[],
): MoveRecordSourceIndex {
  const ranges = new Map<number, IndexedMoveSourceRange[]>()
  for (const [recordOrder, record] of records.entries()) {
    let offset = 0
    for (const [client, clock, length, visible] of record.src) {
      const clientRanges = ranges.get(client) ?? []
      clientRanges.push({
        clock,
        length,
        offset,
        prefixEnd: 0,
        record,
        recordOrder,
        visible,
      })
      ranges.set(client, clientRanges)
      if (visible === 1) offset += length
    }
  }
  for (const clientRanges of ranges.values()) {
    clientRanges.sort((left, right) => left.clock - right.clock)
    let prefixEnd = 0
    for (const range of clientRanges) {
      prefixEnd = Math.max(prefixEnd, range.clock + range.length)
      range.prefixEnd = prefixEnd
    }
  }
  return ranges
}

export function moveSourcesAt(
  index: MoveRecordSourceIndex,
  client: number,
  clock: number,
): MoveSourceMatch[] {
  return moveSourcesInRange(index, client, clock, clock + 1, 'forward')
}

export function moveSourcesInRange(
  index: MoveRecordSourceIndex,
  client: number,
  from: number,
  to: number,
  direction: 'forward' | 'backward',
): MoveSourceMatch[] {
  const ranges = index.get(client)
  if (!ranges || from >= to) return []
  let low = 0
  let high = ranges.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const range = ranges[middle]
    if (!range) return []
    if (range.prefixEnd <= from) low = middle + 1
    else high = middle
  }
  const matches = new Map<number, MoveSourceMatch>()
  for (let position = low; position < ranges.length; position += 1) {
    const range = ranges[position]
    if (!range) continue
    if (range.clock >= to) break
    const matchClock =
      direction === 'forward'
        ? Math.max(from, range.clock)
        : Math.min(to - 1, range.clock + range.length - 1)
    if (
      matchClock < from ||
      matchClock >= to ||
      matchClock >= range.clock + range.length
    )
      continue
    const sourceOffset = locate(range.record, client, matchClock)
    if (sourceOffset === undefined) continue
    const previous = matches.get(range.recordOrder)
    if (
      previous &&
      (direction === 'forward'
        ? previous.sourceClock <= matchClock
        : previous.sourceClock >= matchClock)
    ) {
      continue
    }
    matches.set(range.recordOrder, {
      record: range.record,
      recordOrder: range.recordOrder,
      sourceClock: matchClock,
      sourceOffset,
    })
  }
  return [...matches.values()].sort(
    (left, right) => left.recordOrder - right.recordOrder,
  )
}

function sourceIndex(record: MoveRecord): Map<number, IndexedSourceRange[]> {
  const cached = sourceIndexByRecord.get(record)
  if (cached) return cached
  const ranges = new Map<number, IndexedSourceRange[]>()
  let offset = 0
  for (const [client, clock, length, visible] of record.src) {
    const clientRanges = ranges.get(client) ?? []
    clientRanges.push({ clock, length, offset, visible })
    ranges.set(client, clientRanges)
    if (visible === 1) offset += length
  }
  for (const clientRanges of ranges.values()) {
    clientRanges.sort((left, right) => left.clock - right.clock)
  }
  sourceIndexByRecord.set(record, ranges)
  return ranges
}

export function locate(
  record: MoveRecord,
  client: number,
  clock: number,
): number | undefined {
  const ranges = sourceIndex(record).get(client)
  if (!ranges) return undefined
  let low = 0
  let high = ranges.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const range = ranges[middle]
    if (!range) return undefined
    if (clock < range.clock) high = middle - 1
    else if (clock >= range.clock + range.length) low = middle + 1
    else {
      return range.visible === 1
        ? range.offset + clock - range.clock
        : range.offset - 1
    }
  }
  return undefined
}
