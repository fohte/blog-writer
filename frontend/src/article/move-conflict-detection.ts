import * as Y from 'yjs'

import {
  getMoveConflictRelocation,
  getMoveRecords,
  isAcknowledged,
  isConcurrent,
  locate,
  recordMoveConflictRelocations,
  targetFor,
  type TrackedTarget,
} from '#article/move-conflict-records'
import {
  type InternalItem,
  internalItems,
  MOVE_CONFLICT_TRANSACTION_ORIGIN,
  type TrackedId,
} from '#article/yjs-internals'

export type MoveConflict = {
  id: string
  from: number
  to: number
  text: string
  target: number
}

export type MoveConflictDetail = {
  conflict: MoveConflict
  recordId: string
  target: TrackedTarget
}

function idEqual(left: TrackedId, right: TrackedId): boolean {
  return left.client === right.client && left.clock === right.clock
}

function moveRecordId(record: { copy: [number, number] }): string {
  return `${record.copy[0].toString()}:${record.copy[1].toString()}`
}

type MoveRecord = Parameters<typeof locate>[0]

type InternalItemIndex = {
  items: InternalItem[]
  byClient: Map<number, InternalItem[]>
  positionByItem: Map<InternalItem, number>
  documentOffsetByItem: Map<InternalItem, number>
}

function indexInternalItems(text: Y.Text): InternalItemIndex {
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
    if (!item.deleted && item.countable) documentOffset += item.length
  }
  for (const clientItems of byClient.values()) {
    clientItems.sort((left, right) => left.id.clock - right.id.clock)
  }
  return { items, byClient, positionByItem, documentOffsetByItem }
}

function findItem(
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

function targetPositionFromIndex(
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

function sourceOffsetFromAnchor(
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
  if (side === 'before') {
    for (
      let clock = anchor.clock + 1;
      clock < anchorItem.id.clock + anchorItem.length;
      clock += 1
    ) {
      const offset = locate(record, anchor.client, clock)
      if (offset !== undefined) return offset
    }
    for (
      let position = itemIndex + 1;
      position < index.items.length;
      position += 1
    ) {
      const item = index.items[position]
      if (!item) continue
      if (!item.deleted) break
      const offset = locate(record, item.id.client, item.id.clock)
      if (offset !== undefined) return offset
    }
  } else {
    for (
      let clock = anchor.clock - 1;
      clock >= anchorItem.id.clock;
      clock -= 1
    ) {
      const offset = locate(record, anchor.client, clock)
      if (offset !== undefined) return offset
    }
    for (let position = itemIndex - 1; position >= 0; position -= 1) {
      const item = index.items[position]
      if (!item) continue
      if (!item.deleted) break
      const offset = locate(
        record,
        item.id.client,
        item.id.clock + item.length - 1,
      )
      if (offset !== undefined) return offset
    }
  }
  return undefined
}

function targetFromAnchor(
  doc: Y.Doc,
  records: MoveRecord[],
  item: InternalItem,
  anchor: TrackedId | null,
  side: 'before' | 'after',
  index: InternalItemIndex,
): { target: TrackedTarget; position: number; recordId: string } | undefined {
  if (!anchor) return undefined
  for (const record of records) {
    if (
      locate(record, item.id.client, item.id.clock) !== undefined ||
      item.id.client === record.copy[0]
    ) {
      continue
    }
    const recordId = moveRecordId(record)
    const relocatedAnchor = getMoveConflictRelocation(doc, recordId, anchor)
    if (relocatedAnchor) {
      const laterMove = records.find(
        (candidate) =>
          locate(candidate, relocatedAnchor.client, relocatedAnchor.clock) !==
          undefined,
      )
      const laterOffset = laterMove
        ? locate(laterMove, relocatedAnchor.client, relocatedAnchor.clock)
        : undefined
      const mapped =
        laterMove && laterOffset !== undefined
          ? targetFor(records, laterMove, laterOffset)
          : relocatedAnchor
      if (mapped) {
        const target: TrackedTarget = { ...mapped, side }
        const position = targetPositionFromIndex(index, target)
        if (position !== undefined) return { target, position, recordId }
      }
      continue
    }
    const sourceOffset = sourceOffsetFromAnchor(record, anchor, side, index)
    if (
      sourceOffset === undefined ||
      locate(record, item.id.client, item.id.clock) !== undefined
    ) {
      continue
    }
    const concurrent =
      (side === 'after' || sourceOffset > 0) &&
      isConcurrent(doc, record, item.id.client, item.id.clock)
    const leftOffset = item.origin
      ? sourceOffsetFromAnchor(record, item.origin, 'after', index)
      : undefined
    const rightOffset = item.rightOrigin
      ? sourceOffsetFromAnchor(record, item.rightOrigin, 'before', index)
      : undefined
    const restoredAfterAcknowledgement =
      isAcknowledged(doc, record, item.id.client, item.id.clock) &&
      (leftOffset !== undefined || rightOffset !== undefined)
    if (!concurrent && !restoredAfterAcknowledgement) continue

    const mapped = targetFor(records, record, sourceOffset)
    if (mapped) {
      const target: TrackedTarget =
        side === 'before' ? { ...mapped, side: 'before' } : mapped
      const position = targetPositionFromIndex(index, target)
      if (position === undefined) continue
      return {
        target,
        position,
        recordId: moveRecordId(record),
      }
    }
  }
  return undefined
}

function targetPosition(doc: Y.Doc, target: TrackedTarget): number | undefined {
  const text = doc.getText('body')
  let position = 0
  for (const item of internalItems(text)) {
    if (
      item.id.client === target.client &&
      target.clock >= item.id.clock &&
      target.clock < item.id.clock + item.length
    ) {
      const offset = target.clock - item.id.clock
      return item.deleted
        ? position
        : position + offset + (target.side === 'after' ? 1 : 0)
    }
    if (!item.deleted && item.countable) position += item.length
  }
  return undefined
}

export function detectMoveConflictDetails(doc: Y.Doc): MoveConflictDetail[] {
  const text = doc.getText('body')
  const records = getMoveRecords(doc).toArray()
  const itemIndex = indexInternalItems(text)
  const tainted = new Map<
    string,
    { target: TrackedTarget; position: number; recordId: string }
  >()
  const ranges: Array<{
    from: number
    to: number
    target: TrackedTarget
    targetPosition: number
    id: string
    recordId: string
  }> = []
  let position = 0
  let last: (typeof ranges)[number] | undefined

  for (const item of itemIndex.items) {
    const originTarget = targetFromAnchor(
      doc,
      records,
      item,
      item.origin,
      'after',
      itemIndex,
    )
    const rightOriginTarget = targetFromAnchor(
      doc,
      records,
      item,
      item.rightOrigin,
      'before',
      itemIndex,
    )
    let target = originTarget ?? rightOriginTarget
    if (!target) {
      for (const anchor of [item.origin, item.rightOrigin]) {
        if (!anchor) continue
        for (const [key, taintedTarget] of tainted) {
          const [client, clock, length] = key.split(':').map(Number)
          if (
            client === anchor.client &&
            clock !== undefined &&
            length !== undefined &&
            anchor.clock >= clock &&
            anchor.clock < clock + length
          ) {
            target = taintedTarget
            break
          }
        }
        if (target) break
      }
    }

    if (target) {
      tainted.set(
        `${item.id.client.toString()}:${item.id.clock.toString()}:${item.length.toString()}`,
        target,
      )
    }
    if (item.deleted || !item.countable) continue
    if (!target) {
      last = undefined
      position += item.length
      continue
    }
    if (
      last &&
      idEqual(last.target, target.target) &&
      last.target.side === target.target.side &&
      last.recordId === target.recordId
    ) {
      last.to += item.length
    } else {
      last = {
        from: position,
        to: position + item.length,
        target: target.target,
        targetPosition: target.position,
        id: `${item.id.client.toString()}:${item.id.clock.toString()}`,
        recordId: target.recordId,
      }
      ranges.push(last)
    }
    position += item.length
  }

  const markdown = text.toJSON()
  return ranges.map((range) => ({
    conflict: {
      id: range.id,
      from: range.from,
      to: range.to,
      text: markdown.slice(range.from, range.to),
      target: range.targetPosition,
    },
    recordId: range.recordId,
    target: range.target,
  }))
}

export function resolveMoveConflictRange(
  doc: Y.Doc,
  conflict: MoveConflict,
  recordId: string,
  target: TrackedTarget,
): void {
  const text = doc.getText('body')
  const idsInRange = (from: number, to: number): TrackedId[] => {
    const ids: TrackedId[] = []
    let position = 0
    for (const item of internalItems(text)) {
      if (item.deleted || !item.countable) continue
      const start = Math.max(from - position, 0)
      const end = Math.min(to - position, item.length)
      for (let offset = start; offset < end; offset += 1) {
        ids.push({ client: item.id.client, clock: item.id.clock + offset })
      }
      position += item.length
      if (position >= to) break
    }
    return ids
  }
  doc.transact(() => {
    const sourceIds = idsInRange(conflict.from, conflict.to)
    text.delete(conflict.from, conflict.to - conflict.from)
    const targetPositionAfterDelete = targetPosition(doc, target)
    const insertion = Math.max(
      0,
      Math.min(targetPositionAfterDelete ?? conflict.target, text.length),
    )
    text.insert(insertion, conflict.text)
    const destinationIds = idsInRange(
      insertion,
      insertion + conflict.text.length,
    )
    recordMoveConflictRelocations(doc, recordId, sourceIds, destinationIds)
  }, MOVE_CONFLICT_TRANSACTION_ORIGIN)
}
