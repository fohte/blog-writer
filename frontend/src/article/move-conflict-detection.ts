import * as Y from 'yjs'

import {
  getMoveRecords,
  isConcurrent,
  locate,
  targetFor,
  type TrackedId,
  type TrackedTarget,
} from '#article/move-conflict-records'

export type MoveConflict = {
  id: string
  from: number
  to: number
  text: string
  target: number
}

type InternalItem = {
  id: TrackedId
  length: number
  deleted: boolean
  countable: boolean
  origin: TrackedId | null
  right: InternalItem | null
}
type InternalText = Y.Text & { _start: InternalItem | null }

function idEqual(left: TrackedId, right: TrackedId): boolean {
  return left.client === right.client && left.clock === right.clock
}

function targetPosition(doc: Y.Doc, target: TrackedTarget): number | undefined {
  const text = doc.getText('body') as InternalText
  let position = 0
  for (let item = text._start; item; item = item.right) {
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

export function detectMoveConflicts(doc: Y.Doc): MoveConflict[] {
  const text = doc.getText('body') as InternalText
  const records = getMoveRecords(doc).toArray()
  const tainted = new Map<string, TrackedTarget>()
  const ranges: Array<{
    from: number
    to: number
    target: TrackedTarget
    id: string
  }> = []
  let position = 0
  let last: (typeof ranges)[number] | undefined

  for (let item = text._start; item; item = item.right) {
    let target: TrackedTarget | undefined
    const origin = item.origin
    if (origin) {
      const record = records.find(
        (candidate) =>
          locate(candidate, origin.client, origin.clock) !== undefined &&
          locate(candidate, item.id.client, item.id.clock) === undefined &&
          isConcurrent(doc, candidate, item.id.client, item.id.clock),
      )
      if (record) {
        const sourceOffset = locate(record, origin.client, origin.clock)
        if (sourceOffset !== undefined)
          target = targetFor(records, record, sourceOffset)
      } else {
        for (const [key, taintedTarget] of tainted) {
          const [client, clock, length] = key.split(':').map(Number)
          if (
            client === origin.client &&
            clock !== undefined &&
            length !== undefined &&
            origin.clock >= clock &&
            origin.clock < clock + length
          ) {
            target = taintedTarget
            break
          }
        }
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
      idEqual(last.target, target) &&
      last.target.side === target.side
    ) {
      last.to += item.length
    } else {
      last = {
        from: position,
        to: position + item.length,
        target,
        id: `${item.id.client.toString()}:${item.id.clock.toString()}`,
      }
      ranges.push(last)
    }
    position += item.length
  }

  const markdown = text.toJSON()
  return ranges.flatMap((range) => {
    const target = targetPosition(doc, range.target)
    return target === undefined
      ? []
      : [
          {
            id: range.id,
            from: range.from,
            to: range.to,
            text: markdown.slice(range.from, range.to),
            target,
          },
        ]
  })
}

export function resolveMoveConflictRange(
  doc: Y.Doc,
  conflict: MoveConflict,
): void {
  const text = doc.getText('body')
  if (text.toJSON().slice(conflict.from, conflict.to) !== conflict.text) return
  const target = Math.max(0, Math.min(conflict.target, text.length))
  const insertion =
    target > conflict.from ? target - (conflict.to - conflict.from) : target
  doc.transact(() => {
    text.delete(conflict.from, conflict.to - conflict.from)
    text.insert(insertion, conflict.text)
  }, 'move-conflict-resolution')
}

export function isConflictCurrent(doc: Y.Doc, conflict: MoveConflict): boolean {
  return (
    doc.getText('body').toJSON().slice(conflict.from, conflict.to) ===
    conflict.text
  )
}
