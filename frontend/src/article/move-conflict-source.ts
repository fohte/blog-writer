import * as Y from 'yjs'

import {
  type InternalItem,
  internalItems,
  type TrackedId,
} from '#article/yjs-internals'

type MoveSourceRun = [
  client: number,
  clock: number,
  length: number,
  visible: 0 | 1,
]

export type MoveRecord = {
  src: MoveSourceRun[]
  copy: [client: number, clock: number]
  sv: Record<string, number>
  offsets: Array<number | null>
  createdAt: number
}

const moveRecordIds = new WeakMap<object, string>()

export function moveRecordId(record: Pick<MoveRecord, 'copy'>): string {
  const cached = moveRecordIds.get(record)
  if (cached !== undefined) return cached
  const id = `${record.copy[0].toString()}:${record.copy[1].toString()}`
  moveRecordIds.set(record, id)
  return id
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
  offsets: Array<number | null>
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
