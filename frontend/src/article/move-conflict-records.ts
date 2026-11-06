import * as Y from 'yjs'

import {
  coalesceIdRanges,
  type TrackedIdRange,
} from '#article/move-conflict-ranges'
import { type MoveRecord, moveRecordId } from '#article/move-conflict-source'
import { locate } from '#article/move-conflict-source-index'
import {
  internalItems,
  MOVE_CONFLICT_TRANSACTION_ORIGIN,
  type TrackedId,
} from '#article/yjs-internals'

export {
  captureMoveSource,
  createMoveRecord,
} from '#article/move-conflict-source'
export { locate } from '#article/move-conflict-source-index'

const MOVE_RECORDS = 'moves'
const MOVE_ACKS = 'move-acks'
const MOVE_DECISIONS = 'move-decisions'
const MOVE_CONFLICT_RESTORATIONS = 'move-conflict-restorations'
const MOVE_CONFLICT_RELOCATIONS = 'move-conflict-relocations'
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export type TrackedTarget = TrackedId & { side: 'before' | 'after' }

export function getMoveRecords(doc: Y.Doc): Y.Array<MoveRecord> {
  return doc.getArray<MoveRecord>(MOVE_RECORDS)
}

function getMoveAcks(doc: Y.Doc): Y.Map<number> {
  return doc.getMap<number>(MOVE_ACKS)
}

function getMoveDecisions(doc: Y.Doc): Y.Map<TrackedIdRange[]> {
  return doc.getMap<TrackedIdRange[]>(MOVE_DECISIONS)
}

function getMoveConflictRestorations(doc: Y.Doc): Y.Map<TrackedIdRange> {
  return doc.getMap<TrackedIdRange>(MOVE_CONFLICT_RESTORATIONS)
}

function getMoveConflictRelocations(doc: Y.Doc): Y.Map<TrackedId> {
  return doc.getMap<TrackedId>(MOVE_CONFLICT_RELOCATIONS)
}

function moveAckKey(record: MoveRecord, client: number): string {
  return `${moveRecordId(record)}/${client.toString()}`
}

function isMoveRecord(value: unknown): value is MoveRecord {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('src' in value) ||
    !('copy' in value) ||
    !('sv' in value) ||
    !('offsets' in value) ||
    !('createdAt' in value)
  )
    return false
  const copy = value.copy
  return (
    Array.isArray(value.src) &&
    Array.isArray(copy) &&
    typeof copy[0] === 'number' &&
    typeof copy[1] === 'number' &&
    typeof value.sv === 'object' &&
    value.sv !== null &&
    Array.isArray(value.offsets) &&
    typeof value.createdAt === 'number'
  )
}

export function cleanupMoveRecords(doc: Y.Doc, now = Date.now()): void {
  if (!doc.share.has(MOVE_RECORDS)) return
  const records = getMoveRecords(doc)
  const cutoff = now - RETENTION_MS
  const removed = records
    .toArray()
    .filter((record) => record.createdAt <= cutoff)
    .map(moveRecordId)
  if (removed.length === 0) return

  const removedIds = new Set(removed)
  doc.transact(() => {
    const current = records.toArray()
    for (let index = current.length - 1; index >= 0; index -= 1) {
      const record = current[index]
      if (record && removedIds.has(moveRecordId(record)))
        records.delete(index, 1)
    }
    const acks = getMoveAcks(doc)
    for (const key of acks.keys()) {
      if (removed.some((id) => key.startsWith(`${id}/`))) acks.delete(key)
    }
    const decisions = getMoveDecisions(doc)
    for (const key of decisions.keys()) {
      if (removed.some((id) => key.startsWith(`${id}/`))) decisions.delete(key)
    }
    const relocations = getMoveConflictRelocations(doc)
    for (const key of relocations.keys()) {
      if (removed.some((id) => key.startsWith(`${id}/`)))
        relocations.delete(key)
    }
    const restorations = getMoveConflictRestorations(doc)
    for (const key of restorations.keys()) {
      if (removed.some((id) => key.startsWith(`${id}/`)))
        restorations.delete(key)
    }
  })
}

function moveDecisionKey(recordId: string, conflictId: string): string {
  return `${recordId}/${conflictId}`
}

function moveConflictRestorationKey(
  recordId: string,
  range: TrackedIdRange,
): string {
  return `${recordId}/${range.client.toString()}:${range.clock.toString()}:${range.length.toString()}`
}

function groupRangesByRecordId(
  entries: Iterable<[string, TrackedIdRange[]]>,
): Map<string, TrackedIdRange[]> {
  const rangesByRecord = new Map<string, TrackedIdRange[]>()
  for (const [key, ranges] of entries) {
    const separator = key.lastIndexOf('/')
    if (separator < 0) continue
    const recordId = key.slice(0, separator)
    rangesByRecord.set(recordId, [
      ...(rangesByRecord.get(recordId) ?? []),
      ...ranges,
    ])
  }
  return rangesByRecord
}

export function indexMoveConflictDecisions(
  doc: Y.Doc,
): Map<string, TrackedIdRange[]> {
  const decisionsByRecord = groupRangesByRecordId(getMoveDecisions(doc))
  for (const [recordId, ranges] of decisionsByRecord)
    decisionsByRecord.set(recordId, coalesceIdRanges(ranges))
  return decisionsByRecord
}

export function indexMoveConflictRestorations(
  doc: Y.Doc,
): Map<string, TrackedIdRange[]> {
  const entries = [...getMoveConflictRestorations(doc)].map(
    ([key, range]) => [key, [range]] as [string, TrackedIdRange[]],
  )
  return groupRangesByRecordId(entries)
}

export function keepMoveConflict(
  doc: Y.Doc,
  recordId: string,
  conflictId: string,
  decisionRanges: TrackedIdRange[],
): void {
  getMoveDecisions(doc).set(
    moveDecisionKey(recordId, conflictId),
    coalesceIdRanges(decisionRanges),
  )
}

export function recordMoveConflictRestorations(
  doc: Y.Doc,
  restorations: Array<{ recordId: string; range: TrackedIdRange }>,
): void {
  if (restorations.length === 0) return
  const stored = getMoveConflictRestorations(doc)
  doc.transact(() => {
    for (const { recordId, range } of restorations) {
      stored.set(moveConflictRestorationKey(recordId, range), range)
    }
  }, MOVE_CONFLICT_TRANSACTION_ORIGIN)
}

function relocationKey(recordId: string, id: TrackedId): string {
  return `${recordId}/${id.client.toString()}:${id.clock.toString()}`
}

export function recordMoveConflictRelocations(
  doc: Y.Doc,
  recordId: string,
  sourceIds: TrackedId[],
  destinationIds: TrackedId[],
): void {
  const relocations = getMoveConflictRelocations(doc)
  for (let index = 0; index < sourceIds.length; index += 1) {
    const source = sourceIds[index]
    const destination = destinationIds[index]
    if (source && destination) {
      relocations.set(relocationKey(recordId, source), destination)
    }
  }
}

export function observeMoveConflictState(
  doc: Y.Doc,
  onChange: () => void,
): () => void {
  const decisions = getMoveDecisions(doc)
  const restorations = getMoveConflictRestorations(doc)
  decisions.observe(onChange)
  restorations.observe(onChange)
  return () => {
    decisions.unobserve(onChange)
    restorations.unobserve(onChange)
  }
}

function mappedOffset(
  record: MoveRecord,
  sourceOffset: number,
): number | undefined {
  if (sourceOffset < 0) return sourceOffset
  const mapped = record.offsets[sourceOffset]
  return mapped === null ? undefined : (mapped ?? sourceOffset)
}

function forward(records: MoveRecord[], id: TrackedId): TrackedId | undefined {
  for (;;) {
    const record = records.find(
      (candidate) => locate(candidate, id.client, id.clock) !== undefined,
    )
    if (!record) return id
    const offset = locate(record, id.client, id.clock)
    if (offset === undefined) return id
    const mapped = mappedOffset(record, offset)
    if (mapped === undefined) return undefined
    id = { client: record.copy[0], clock: record.copy[1] + mapped }
  }
}

export function targetFor(
  records: MoveRecord[],
  record: MoveRecord,
  sourceOffset: number,
): TrackedTarget | undefined {
  const firstVisible = record.src.find(([, , , visible]) => visible === 1)
  if (!firstVisible) return undefined
  if (sourceOffset < 0) {
    const firstOffset = mappedOffset(record, 0)
    if (firstOffset === undefined) return undefined
    const id = forward(records, {
      client: record.copy[0],
      clock: record.copy[1] + firstOffset,
    })
    return id ? { ...id, side: 'before' } : undefined
  }
  const offset = mappedOffset(record, sourceOffset)
  if (offset === undefined) return undefined
  const id = forward(records, {
    client: record.copy[0],
    clock: record.copy[1] + offset,
  })
  return id ? { ...id, side: 'after' } : undefined
}

export function isConcurrent(
  doc: Y.Doc,
  record: MoveRecord,
  client: number,
  clock: number,
): boolean {
  const range = getConcurrentClockRange(doc, record, client)
  return (
    range !== undefined &&
    clock >= range.clock &&
    clock < range.clock + range.length
  )
}

export function getConcurrentClockRange(
  doc: Y.Doc,
  record: MoveRecord,
  client: number,
): TrackedIdRange | undefined {
  if (client === record.copy[0]) return undefined
  const clock = record.sv[client.toString()] ?? 0
  const end =
    getMoveAcks(doc).get(moveAckKey(record, client)) ?? Number.POSITIVE_INFINITY
  return clock < end ? { client, clock, length: end - clock } : undefined
}

function deleteSetIntersectsSource(
  record: MoveRecord,
  deleteSet: Y.Transaction['deleteSet'],
): boolean {
  return record.src.some(([client, clock, length, visible]) => {
    if (visible === 0) return false
    return (
      deleteSet.clients
        .get(client)
        ?.some(
          (deletion) =>
            deletion.clock < clock + length &&
            clock < deletion.clock + deletion.len,
        ) ?? false
    )
  })
}

function repairDeletedMoveCharacters(
  doc: Y.Doc,
  record: MoveRecord,
  transaction: Y.Transaction,
  recordWasAdded: boolean,
  records = getMoveRecords(doc).toArray(),
): void {
  const ids: TrackedId[] = []
  let offset = 0
  for (const [client, clock, length, visible] of record.src) {
    if (visible === 0) continue
    for (let index = 0; index < length; index += 1, offset += 1) {
      const id = Y.createID(client, clock + index)
      const wasReceived =
        (transaction.beforeState.get(client) ?? 0) > clock + index
      const deletedInTransaction = Y.isDeleted(transaction.deleteSet, id)
      const wasDeletedWhileConflicted = recordWasAdded
        ? wasReceived && !deletedInTransaction
        : wasReceived && deletedInTransaction
      if (
        wasDeletedWhileConflicted &&
        !records.some(
          (other) =>
            moveRecordId(other) !== moveRecordId(record) &&
            locate(other, client, clock + index) !== undefined,
        )
      ) {
        const mapped = mappedOffset(record, offset)
        if (mapped === undefined) continue
        const id = forward(records, {
          client: record.copy[0],
          clock: record.copy[1] + mapped,
        })
        if (id) ids.push(id)
      }
    }
  }
  deleteVisibleIds(doc, ids)
}

function deleteVisibleIds(doc: Y.Doc, ids: TrackedId[]): void {
  const text = doc.getText('body')
  const ranges: Array<[number, number]> = []
  const uniqueIds = new Map(
    ids.map((id) => [`${id.client.toString()}:${id.clock.toString()}`, id]),
  )
  let position = 0
  for (const item of internalItems(text)) {
    if (item.deleted || !item.countable) continue
    for (const id of uniqueIds.values()) {
      if (
        id.client !== item.id.client ||
        id.clock < item.id.clock ||
        id.clock >= item.id.clock + item.length
      ) {
        continue
      }
      const start = position + id.clock - item.id.clock
      const last = ranges.at(-1)
      if (last && last[0] + last[1] === start) last[1] += 1
      else ranges.push([start, 1])
    }
    position += item.length
  }
  if (ranges.length === 0) return
  doc.transact(() => {
    for (const [start, length] of ranges.toReversed()) {
      text.delete(start, length)
    }
  }, MOVE_CONFLICT_TRANSACTION_ORIGIN)
}

function observeMoveRecords(doc: Y.Doc): () => void {
  cleanupMoveRecords(doc)
  const records = getMoveRecords(doc)
  const acks = getMoveAcks(doc)
  const currentRecords = records.toArray()
  for (const record of currentRecords) {
    if (
      record.copy[0] !== doc.clientID &&
      acks.get(moveAckKey(record, doc.clientID)) === undefined
    ) {
      // A persisted move can predate observers, so begin tracking from this loaded state.
      acks.set(
        moveAckKey(record, doc.clientID),
        Y.getState(doc.store, doc.clientID),
      )
    }
  }
  let knownRecordIds = new Set(currentRecords.map(moveRecordId))
  const observe = (transaction: Y.Transaction) => {
    if (
      !transaction.changed.has(records) &&
      transaction.deleteSet.clients.size === 0
    ) {
      return
    }
    const allRecords = records.toArray().filter(isMoveRecord)
    const allRecordIds = new Set(allRecords.map(moveRecordId))
    const addedRecordIds = new Set(
      allRecords
        .filter((record) => !knownRecordIds.has(moveRecordId(record)))
        .map(moveRecordId),
    )
    knownRecordIds = allRecordIds

    for (const record of allRecords) {
      if (record.copy[0] === doc.clientID) continue
      if (record.createdAt <= Date.now() - RETENTION_MS) continue
      const recordWasAdded = addedRecordIds.has(moveRecordId(record))
      if (
        recordWasAdded ||
        deleteSetIntersectsSource(record, transaction.deleteSet)
      ) {
        repairDeletedMoveCharacters(
          doc,
          record,
          transaction,
          recordWasAdded,
          allRecords,
        )
      }
      if (recordWasAdded) {
        getMoveAcks(doc).set(
          moveAckKey(record, doc.clientID),
          Y.getState(doc.store, doc.clientID),
        )
      }
    }
    cleanupMoveRecords(doc)
  }
  doc.on('afterTransaction', observe)
  return () => {
    doc.off('afterTransaction', observe)
  }
}

const observersByDoc = new WeakMap<Y.Doc, { count: number; stop: () => void }>()

export function registerMoveConflictObserver(doc: Y.Doc): () => void {
  const current = observersByDoc.get(doc)
  if (current) current.count += 1
  else observersByDoc.set(doc, { count: 1, stop: observeMoveRecords(doc) })

  return () => {
    const registration = observersByDoc.get(doc)
    if (!registration) return
    registration.count -= 1
    if (registration.count === 0) {
      registration.stop()
      observersByDoc.delete(doc)
    }
  }
}
