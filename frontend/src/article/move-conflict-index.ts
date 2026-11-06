import * as Y from 'yjs'

import { locate, type TrackedTarget } from '#article/move-conflict-records'
import { type MoveRecord, moveRecordId } from '#article/move-conflict-source'
import {
  type MoveRecordSourceIndex,
  type MoveSourceMatch,
  moveSourcesAt,
  moveSourcesInRange,
} from '#article/move-conflict-source-index'
import {
  type InternalItem,
  internalItems,
  type TrackedId,
} from '#article/yjs-internals'

export type InternalItemIndex = {
  items: InternalItem[]
  byClient: Map<number, InternalItem[]>
  positionByItem: Map<InternalItem, number>
  documentOffsetByItem: Map<InternalItem, number>
  sourceCandidatesToLeft: Array<MoveSourceMatch[] | undefined>
  sourceCandidatesToRight: Array<MoveSourceMatch[] | undefined>
}

export type RelocationIndex = Map<string, Map<string, TrackedId>>

export function indexInternalItems(
  text: Y.Text,
  sourceIndex?: MoveRecordSourceIndex,
): InternalItemIndex {
  const items = [...internalItems(text)]
  const byClient = new Map<number, InternalItem[]>()
  const positionByItem = new Map<InternalItem, number>()
  const documentOffsetByItem = new Map<InternalItem, number>()
  let documentOffset = 0
  for (const [position, item] of items.entries()) {
    const clientItems = byClient.get(item.id.client) ?? []
    clientItems.push(item)
    byClient.set(item.id.client, clientItems)
    positionByItem.set(item, position)
    documentOffsetByItem.set(item, documentOffset)
    if (!item.deleted && item.countable) {
      documentOffset += item.length
    }
  }
  for (const clientItems of byClient.values()) {
    clientItems.sort((left, right) => left.id.clock - right.id.clock)
  }
  const sourceCandidatesToLeft: Array<MoveSourceMatch[] | undefined> = []
  const sourceCandidatesToRight: Array<MoveSourceMatch[] | undefined> = []
  if (sourceIndex) {
    const collect = (direction: 'left' | 'right') => {
      const candidates = new Map<number, MoveSourceMatch>()
      const start = direction === 'left' ? 0 : items.length - 1
      const end = direction === 'left' ? items.length : -1
      const step = direction === 'left' ? 1 : -1
      for (let position = start; position !== end; position += step) {
        const item = items[position]
        if (!item) continue
        if (!item.deleted) {
          candidates.clear()
          continue
        }
        const destination =
          direction === 'left'
            ? sourceCandidatesToLeft
            : sourceCandidatesToRight
        destination[position] = [...candidates.values()]
        const clock =
          item.id.clock + (direction === 'left' ? item.length - 1 : 0)
        for (const match of moveSourcesAt(sourceIndex, item.id.client, clock)) {
          candidates.set(match.recordOrder, match)
        }
      }
    }
    collect('left')
    collect('right')
  }
  return {
    items,
    byClient,
    positionByItem,
    documentOffsetByItem,
    sourceCandidatesToLeft,
    sourceCandidatesToRight,
  }
}

export function findItem(
  index: InternalItemIndex,
  id: TrackedId,
): InternalItem | undefined {
  const clientItems = index.byClient.get(id.client)
  if (!clientItems) return undefined
  let low = 0
  let high = clientItems.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const item = clientItems[middle]
    if (!item) return undefined
    if (id.clock < item.id.clock) high = middle - 1
    else if (id.clock >= item.id.clock + item.length) low = middle + 1
    else return item
  }
  return undefined
}

export function targetPositionFromIndex(
  index: InternalItemIndex,
  target: TrackedTarget,
): number | undefined {
  const item = findItem(index, target)
  if (!item) return undefined
  const position = index.documentOffsetByItem.get(item)
  if (position === undefined || item.deleted) return position
  return (
    position + target.clock - item.id.clock + (target.side === 'after' ? 1 : 0)
  )
}

export function sourceOffsetFromAnchor(
  record: MoveRecord,
  anchor: TrackedId,
  side: 'before' | 'after',
  index: InternalItemIndex,
): number | undefined {
  const direct = locate(record, anchor.client, anchor.clock)
  if (direct !== undefined) return direct

  const anchorItem = findItem(index, anchor)
  if (!anchorItem) return undefined
  if (!anchorItem.deleted) return undefined
  const itemIndex = index.positionByItem.get(anchorItem)
  if (itemIndex === undefined) return undefined
  const direction = side === 'before' ? 1 : -1
  for (
    let clock = anchor.clock + direction;
    clock >= anchorItem.id.clock &&
    clock < anchorItem.id.clock + anchorItem.length;
    clock += direction
  ) {
    const offset = locate(record, anchor.client, clock)
    if (offset !== undefined) return offset
  }
  for (
    let position = itemIndex + direction;
    position >= 0 && position < index.items.length;
    position += direction
  ) {
    const item = index.items[position]
    if (!item) continue
    if (!item.deleted) break
    const clock = item.id.clock + (direction < 0 ? item.length - 1 : 0)
    const offset = locate(record, item.id.client, clock)
    if (offset !== undefined) return offset
  }
  return undefined
}

export function sourceCandidatesFromAnchor(
  sourceIndex: MoveRecordSourceIndex,
  anchor: TrackedId,
  side: 'before' | 'after',
  index: InternalItemIndex,
): MoveSourceMatch[] {
  const direct = moveSourcesAt(sourceIndex, anchor.client, anchor.clock)
  const anchorItem = findItem(index, anchor)
  if (anchorItem === undefined || !anchorItem.deleted) return direct
  const candidates = new Map<number, MoveSourceMatch>(
    direct.map((match) => [match.recordOrder, match]),
  )
  const itemIndex = index.positionByItem.get(anchorItem)
  if (itemIndex === undefined) return direct
  const sameItemMatches =
    side === 'before'
      ? moveSourcesInRange(
          sourceIndex,
          anchor.client,
          anchor.clock + 1,
          anchorItem.id.clock + anchorItem.length,
          'forward',
        )
      : moveSourcesInRange(
          sourceIndex,
          anchor.client,
          anchorItem.id.clock,
          anchor.clock,
          'backward',
        )
  for (const match of sameItemMatches) {
    if (!candidates.has(match.recordOrder)) {
      candidates.set(match.recordOrder, match)
    }
  }
  const neighboringMatches =
    side === 'before'
      ? index.sourceCandidatesToRight[itemIndex]
      : index.sourceCandidatesToLeft[itemIndex]
  const adjacentMatches =
    neighboringMatches ??
    neighboringSourceMatches(
      sourceIndex,
      index,
      itemIndex,
      side === 'before' ? 1 : -1,
    )
  for (const match of adjacentMatches) {
    if (!candidates.has(match.recordOrder)) {
      candidates.set(match.recordOrder, match)
    }
  }
  return [...candidates.values()].toSorted(
    (left, right) => left.recordOrder - right.recordOrder,
  )
}

function neighboringSourceMatches(
  sourceIndex: MoveRecordSourceIndex,
  index: InternalItemIndex,
  itemIndex: number,
  direction: -1 | 1,
): MoveSourceMatch[] {
  const matches = new Map<number, MoveSourceMatch>()
  for (
    let position = itemIndex + direction;
    position >= 0 && position < index.items.length;
    position += direction
  ) {
    const item = index.items[position]
    if (!item || !item.deleted) break
    const clock = item.id.clock + (direction < 0 ? item.length - 1 : 0)
    for (const match of moveSourcesAt(sourceIndex, item.id.client, clock)) {
      matches.set(match.recordOrder, match)
    }
  }
  return [...matches.values()].toSorted(
    (left, right) => left.recordOrder - right.recordOrder,
  )
}

export function indexRelocations(
  doc: Y.Doc,
  records: MoveRecord[],
): RelocationIndex {
  const recordIds = new Set(records.map(moveRecordId))
  const result: RelocationIndex = new Map()
  for (const [key, destination] of doc
    .getMap<TrackedId>('move-conflict-relocations')
    .entries()) {
    const separator = key.indexOf('/')
    const recordId = key.slice(0, separator)
    if (separator < 0 || !recordIds.has(recordId)) continue
    const [client, clock] = key
      .slice(separator + 1)
      .split(':')
      .map(Number)
    if (
      client === undefined ||
      clock === undefined ||
      !Number.isSafeInteger(client) ||
      !Number.isSafeInteger(clock)
    )
      continue
    const sourceKey = `${client.toString()}:${clock.toString()}`
    const byRecord = result.get(sourceKey) ?? new Map<string, TrackedId>()
    byRecord.set(recordId, destination)
    result.set(sourceKey, byRecord)
  }
  return result
}
