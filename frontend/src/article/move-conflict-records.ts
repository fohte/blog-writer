import * as Y from 'yjs'

import {
  type InternalItem,
  internalItems,
  type TrackedId,
} from '#article/yjs-internals'

const MOVE_RECORDS = 'moves'
const MOVE_ACKS = 'move-acks'
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

type MoveId = [client: number, clock: number]
type MoveSourceRun = [
  client: number,
  clock: number,
  length: number,
  visible: 0 | 1,
]
type MoveRecord = {
  src: MoveSourceRun[]
  copy: MoveId
  sv: Record<string, number>
  offsets: number[]
  createdAt: number
}
export type TrackedTarget = TrackedId & { side: 'before' | 'after' }

export function getMoveRecords(doc: Y.Doc): Y.Array<MoveRecord> {
  return doc.getArray<MoveRecord>(MOVE_RECORDS)
}

function getMoveAcks(doc: Y.Doc): Y.Map<number> {
  return doc.getMap<number>(MOVE_ACKS)
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

function pushRun(
  runs: MoveSourceRun[],
  client: number,
  clock: number,
  length: number,
  visible: 0 | 1,
): void {
  const last = runs.at(-1)
  if (
    last &&
    last[0] === client &&
    last[3] === visible &&
    last[1] + last[2] === clock
  ) {
    last[2] += length
  } else {
    runs.push([client, clock, length, visible])
  }
}

function spanOf(text: Y.Text, from: number, to: number): MoveSourceRun[] {
  const runs: MoveSourceRun[] = []
  let tombstones: InternalItem[] = []
  let position = 0

  for (const item of internalItems(text)) {
    if (item.deleted) {
      if (runs.length > 0) tombstones.push(item)
      continue
    }
    if (!item.countable) continue
    if (position >= to) break

    const start = Math.max(from - position, 0)
    const end = Math.min(to - position, item.length)
    if (start < end) {
      for (const tombstone of tombstones) {
        pushRun(
          runs,
          tombstone.id.client,
          tombstone.id.clock,
          tombstone.length,
          0,
        )
      }
      tombstones = []
      pushRun(runs, item.id.client, item.id.clock + start, end - start, 1)
      if (end < item.length) {
        tombstones = []
        break
      }
    }
    position += item.length
  }

  for (const tombstone of tombstones) {
    pushRun(runs, tombstone.id.client, tombstone.id.clock, tombstone.length, 0)
  }
  return runs
}

export function captureMoveSource(
  text: Y.Text,
  from: number,
  to: number,
): MoveSourceRun[] {
  return spanOf(text, from, to)
}

export function createMoveRecord(input: {
  text: Y.Text
  copyFrom: number
  src: MoveSourceRun[]
  sv: Record<string, number>
  offsets: number[]
  createdAt?: number
}): MoveRecord | undefined {
  const { text, copyFrom, src, sv, offsets } = input
  let position = 0
  let copy: TrackedId | undefined
  for (const item of internalItems(text)) {
    if (item.deleted || !item.countable) continue
    if (copyFrom >= position && copyFrom < position + item.length) {
      copy = {
        client: item.id.client,
        clock: item.id.clock + copyFrom - position,
      }
      break
    }
    position += item.length
  }
  if (!copy) return undefined

  return {
    src,
    copy: [copy.client, copy.clock],
    sv,
    offsets,
    createdAt: input.createdAt ?? Date.now(),
  }
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
  })
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

function mappedOffset(record: MoveRecord, sourceOffset: number): number {
  if (sourceOffset < 0) return sourceOffset
  return record.offsets[sourceOffset] ?? sourceOffset
}

function forward(records: MoveRecord[], id: TrackedId): TrackedId {
  for (;;) {
    const record = records.find(
      (candidate) => locate(candidate, id.client, id.clock) !== undefined,
    )
    if (!record) return id
    const offset = locate(record, id.client, id.clock)
    if (offset === undefined) return id
    const mapped = mappedOffset(record, offset)
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
    const id = forward(records, {
      client: record.copy[0],
      clock: record.copy[1] + firstOffset,
    })
    return { ...id, side: 'before' }
  }
  const id = forward(records, {
    client: record.copy[0],
    clock: record.copy[1] + mappedOffset(record, sourceOffset),
  })
  return { ...id, side: 'after' }
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

function repairDeletedMoveCharacters(
  doc: Y.Doc,
  record: MoveRecord,
  deleteSet: Y.Transaction['deleteSet'],
  records = getMoveRecords(doc).toArray(),
): void {
  const ids: TrackedId[] = []
  let offset = 0
  for (const [client, clock, length, visible] of record.src) {
    if (visible === 0) continue
    for (let index = 0; index < length; index += 1, offset += 1) {
      const id = Y.createID(client, clock + index)
      if (
        !Y.isDeleted(deleteSet, id) &&
        !records.some(
          (other) =>
            moveId(other) !== moveId(record) &&
            locate(other, client, clock + index) !== undefined,
        )
      ) {
        ids.push(
          forward(records, {
            client: record.copy[0],
            clock: record.copy[1] + mappedOffset(record, offset),
          }),
        )
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
  }, 'move-conflict-repair')
}

function observeMoveRecords(doc: Y.Doc): () => void {
  cleanupMoveRecords(doc)
  const records = getMoveRecords(doc)
  const acks = getMoveAcks(doc)
  for (const record of records.toArray()) {
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
  const observe = (
    event: Y.YArrayEvent<MoveRecord>,
    transaction: Y.Transaction,
  ) => {
    const added: MoveRecord[] = []
    for (const item of event.changes.added) {
      const content: unknown = item.content.getContent()
      if (!Array.isArray(content)) continue
      for (const value of content) {
        if (isMoveRecord(value)) added.push(value)
      }
    }
    if (added.length > 0) {
      const allRecords = records.toArray()
      for (const record of added) {
        if (
          record.copy[0] === doc.clientID ||
          record.createdAt <= Date.now() - RETENTION_MS
        )
          continue
        repairDeletedMoveCharacters(
          doc,
          record,
          transaction.deleteSet,
          allRecords,
        )
        getMoveAcks(doc).set(
          moveAckKey(record, doc.clientID),
          Y.getState(doc.store, doc.clientID),
        )
      }
    }
    cleanupMoveRecords(doc)
  }
  records.observe(observe)
  return () => {
    records.unobserve(observe)
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
