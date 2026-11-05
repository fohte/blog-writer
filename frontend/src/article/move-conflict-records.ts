import * as Y from 'yjs'

import type { MoveRecord } from '#article/move-conflict-source'
import {
  internalItems,
  MOVE_CONFLICT_TRANSACTION_ORIGIN,
  type TrackedId,
} from '#article/yjs-internals'

export {
  captureMoveSource,
  createMoveRecord,
} from '#article/move-conflict-source'

const MOVE_RECORDS = 'moves'
const MOVE_ACKS = 'move-acks'
const MOVE_DECISIONS = 'move-decisions'
const MOVE_CONFLICT_RELOCATIONS = 'move-conflict-relocations'
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export type TrackedTarget = TrackedId & { side: 'before' | 'after' }

export function getMoveRecords(doc: Y.Doc): Y.Array<MoveRecord> {
  return doc.getArray<MoveRecord>(MOVE_RECORDS)
}

function getMoveAcks(doc: Y.Doc): Y.Map<number> {
  return doc.getMap<number>(MOVE_ACKS)
}

function getMoveDecisions(doc: Y.Doc): Y.Map<boolean> {
  return doc.getMap<boolean>(MOVE_DECISIONS)
}

function getMoveConflictRelocations(doc: Y.Doc): Y.Map<TrackedId> {
  return doc.getMap<TrackedId>(MOVE_CONFLICT_RELOCATIONS)
}

function moveId(record: MoveRecord): string {
  return `${record.copy[0].toString()}:${record.copy[1].toString()}`
}

function moveAckKey(record: MoveRecord, client: number): string {
  return `${moveId(record)}/${client.toString()}`
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
    .map(moveId)
  if (removed.length === 0) return

  const removedIds = new Set(removed)
  doc.transact(() => {
    const current = records.toArray()
    for (let index = current.length - 1; index >= 0; index -= 1) {
      const record = current[index]
      if (record && removedIds.has(moveId(record))) records.delete(index, 1)
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
  })
}

function moveDecisionKey(recordId: string, conflictId: string): string {
  return `${recordId}/${conflictId}`
}

export function isMoveConflictKept(
  doc: Y.Doc,
  recordId: string,
  conflictId: string,
): boolean {
  return getMoveDecisions(doc).has(moveDecisionKey(recordId, conflictId))
}

export function keepMoveConflict(
  doc: Y.Doc,
  recordId: string,
  conflictId: string,
): void {
  getMoveDecisions(doc).set(moveDecisionKey(recordId, conflictId), true)
}

function relocationKey(recordId: string, id: TrackedId): string {
  return `${recordId}/${id.client.toString()}:${id.clock.toString()}`
}

export function getMoveConflictRelocation(
  doc: Y.Doc,
  recordId: string,
  id: TrackedId,
): TrackedId | undefined {
  return getMoveConflictRelocations(doc).get(relocationKey(recordId, id))
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

export function observeMoveConflictDecisions(
  doc: Y.Doc,
  onChange: () => void,
): () => void {
  const decisions = getMoveDecisions(doc)
  decisions.observe(onChange)
  return () => {
    decisions.unobserve(onChange)
  }
}

export function locate(
  record: MoveRecord,
  client: number,
  clock: number,
): number | undefined {
  let offset = 0
  for (const [sourceClient, sourceClock, length, visible] of record.src) {
    if (
      sourceClient === client &&
      clock >= sourceClock &&
      clock < sourceClock + length
    ) {
      return visible === 1 ? offset + clock - sourceClock : offset - 1
    }
    if (visible === 1) offset += length
  }
  return undefined
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
  const ack = getMoveAcks(doc).get(moveAckKey(record, client))
  return (
    client !== record.copy[0] &&
    clock >= (record.sv[client.toString()] ?? 0) &&
    clock < (ack ?? Number.POSITIVE_INFINITY)
  )
}

export function isAcknowledged(
  doc: Y.Doc,
  record: MoveRecord,
  client: number,
  clock: number,
): boolean {
  const ack = getMoveAcks(doc).get(moveAckKey(record, client))
  return clock >= (ack ?? Number.POSITIVE_INFINITY)
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
            moveId(other) !== moveId(record) &&
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
  let knownRecordIds = new Set(currentRecords.map(moveId))
  const observe = (transaction: Y.Transaction) => {
    const allRecords = records.toArray().filter(isMoveRecord)
    const allRecordIds = new Set(allRecords.map(moveId))
    const addedRecordIds = new Set(
      allRecords
        .filter((record) => !knownRecordIds.has(moveId(record)))
        .map(moveId),
    )
    knownRecordIds = allRecordIds

    for (const record of allRecords) {
      if (record.copy[0] === doc.clientID) continue
      if (record.createdAt <= Date.now() - RETENTION_MS) continue
      const recordWasAdded = addedRecordIds.has(moveId(record))
      if (recordWasAdded || transaction.deleteSet.clients.size > 0) {
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
