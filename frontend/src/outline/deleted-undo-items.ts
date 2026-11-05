import * as Y from 'yjs'

import { diff } from '#editor/text-diff'
import { remapDeleteSet } from '#outline/undo-delete-set'
import {
  captureVisibleSegments,
  type IdMapping,
} from '#outline/undo-id-segments'

type UndoStackItem = Y.UndoManager['undoStack'][number]
type GapBiasRange = { from: number; to: number; bias: number }
type VisibleItemRange = { item: Y.Item; from: number; to: number }
export type DeletedUndoItem = {
  stackItem: UndoStackItem
  from: number
  client: number
  clock: number
  length: number
  text: string
  gapBias: number
}

const gapBiasByStackItem = new WeakMap<
  UndoStackItem,
  Map<number, GapBiasRange[]>
>()

function findVisibleItem(
  items: VisibleItemRange[] | undefined,
  clock: number,
): VisibleItemRange | undefined {
  if (!items) return undefined
  let low = 0
  let high = items.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const range = items[middle]
    if (!range) return undefined
    if (clock < range.item.id.clock) {
      high = middle
    } else if (clock >= range.item.id.clock + range.item.length) {
      low = middle + 1
    } else {
      return range
    }
  }
  return undefined
}

function findGapBias(
  stackItem: UndoStackItem,
  client: number,
  clock: number,
): number {
  return (
    gapBiasByStackItem
      .get(stackItem)
      ?.get(client)
      ?.find((range) => range.from <= clock && clock < range.to)?.bias ?? 0
  )
}

function rememberGapBias(
  stackItem: UndoStackItem,
  client: number,
  from: number,
  to: number,
  bias: number,
): void {
  if (bias === 0) return
  const byClient =
    gapBiasByStackItem.get(stackItem) ?? new Map<number, GapBiasRange[]>()
  const ranges = byClient.get(client) ?? []
  ranges.push({ from, to, bias })
  byClient.set(client, ranges)
  gapBiasByStackItem.set(stackItem, byClient)
}

function firstStructEndingAfter(
  structs: { id: { clock: number }; length: number }[],
  clock: number,
): number {
  let low = 0
  let high = structs.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const struct = structs[middle]
    if (!struct || struct.id.clock + struct.length <= clock) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low
}

const historyMaintenanceOrigin = Symbol('history-maintenance')

export function captureDeletedUndoItems(
  doc: Y.Doc,
  body: Y.Text,
  from: number,
  to: number,
  stackItems: UndoStackItem[],
): DeletedUndoItem[] {
  const visibleItemsByClient = new Map<number, VisibleItemRange[]>()
  let visiblePosition = 0
  for (let item = body._start; item; item = item.next) {
    if (item.deleted || !item.countable) continue
    const clientItems = visibleItemsByClient.get(item.id.client) ?? []
    clientItems.push({
      item,
      from: visiblePosition,
      to: visiblePosition + item.length,
    })
    visibleItemsByClient.set(item.id.client, clientItems)
    visiblePosition += item.length
  }
  for (const items of visibleItemsByClient.values()) {
    items.sort((left, right) => left.item.id.clock - right.item.id.clock)
  }

  const positionOf = (item: Y.Item): number => {
    let right = item.right
    while (right) {
      const segment = findVisibleItem(
        visibleItemsByClient.get(right.id.client),
        right.id.clock,
      )
      if (segment) return segment.from + right.id.clock - segment.item.id.clock
      right = right.right
    }

    let left = item.left
    while (left) {
      const segment = findVisibleItem(
        visibleItemsByClient.get(left.id.client),
        left.id.clock,
      )
      if (segment) {
        return (
          segment.from +
          Math.min(
            left.id.clock + left.length,
            segment.item.id.clock + segment.item.length,
          ) -
          segment.item.id.clock
        )
      }
      left = left.left
    }
    return 0
  }

  const targets: DeletedUndoItem[] = []
  for (const stackItem of stackItems) {
    for (const [client, deletions] of stackItem.deletions.clients) {
      const insertions = stackItem.insertions.clients.get(client) ?? []
      const structs = doc.store.clients.get(client) ?? []
      for (const deletion of deletions) {
        const end = deletion.clock + deletion.len
        const first = firstStructEndingAfter(structs, deletion.clock)
        for (let index = first; index < structs.length; index += 1) {
          const struct = structs[index]
          if (!struct || struct.id.clock >= end) break
          if (!(struct instanceof Y.Item)) continue
          const overlapFrom = Math.max(struct.id.clock, deletion.clock)
          const overlapTo = Math.min(struct.id.clock + struct.length, end)
          if (overlapFrom >= overlapTo) continue
          const position = positionOf(struct)
          if (position < from || position > to) continue
          const content = struct.content.getContent()
          if (
            !content.every((part): part is string => typeof part === 'string')
          )
            continue

          const ranges = [{ from: overlapFrom, to: overlapTo }]
          for (const insertion of insertions) {
            const nextRanges: typeof ranges = []
            for (const range of ranges) {
              if (
                insertion.clock >= range.to ||
                insertion.clock + insertion.len <= range.from
              ) {
                nextRanges.push(range)
                continue
              }
              if (range.from < insertion.clock) {
                nextRanges.push({ from: range.from, to: insertion.clock })
              }
              if (insertion.clock + insertion.len < range.to) {
                nextRanges.push({
                  from: insertion.clock + insertion.len,
                  to: range.to,
                })
              }
            }
            ranges.splice(0, ranges.length, ...nextRanges)
          }

          for (const range of ranges) {
            const start = range.from - struct.id.clock
            const end = range.to - struct.id.clock
            const text = content.join('').slice(start, end)
            if (text.length !== end - start) continue
            targets.push({
              stackItem,
              from: position - from,
              client,
              clock: range.from,
              length: range.to - range.from,
              text,
              gapBias: findGapBias(stackItem, client, range.from),
            })
          }
        }
      }
    }
  }
  return targets
}

export function equalRuns(previous: string, next: string) {
  const runs: { from: number; to: number; nextFrom: number }[] = []
  const changes = diff(previous, next)
  let previousPosition = 0
  let nextPosition = 0

  for (const change of changes) {
    const equalLength = change.from - previousPosition
    if (equalLength > 0) {
      runs.push({
        from: previousPosition,
        to: change.from,
        nextFrom: nextPosition,
      })
    }
    nextPosition += equalLength + change.insert.length
    previousPosition = change.to
  }

  if (previousPosition < previous.length) {
    runs.push({
      from: previousPosition,
      to: previous.length,
      nextFrom: nextPosition,
    })
  }
  return runs
}

function mapGap(
  position: number,
  runs: { from: number; to: number; nextFrom: number }[],
): number {
  const following = runs.find(
    (run) => run.from <= position && position < run.to,
  )
  if (following) return following.nextFrom + position - following.from

  const adjacentFollowing = runs.find((run) => run.from === position)
  if (adjacentFollowing) return adjacentFollowing.nextFrom

  const preceding = runs.findLast(
    (run) => run.from < position && position <= run.to,
  )
  if (preceding) return preceding.nextFrom + preceding.to - preceding.from

  const next = runs.find((run) => run.from > position)
  if (next) return next.nextFrom
  const last = runs.at(-1)
  return last ? last.nextFrom + last.to - last.from : 0
}

function mapGapWithBias(
  position: number,
  previous: string,
  next: string,
  runs: { from: number; to: number; nextFrom: number }[],
  gapBias: number,
): { position: number; gapBias: number } {
  const mappedPosition = mapGap(position, runs)
  const changes = diff(previous, next)
  const insertion = changes.find(
    (change) => change.from === position && change.to === position,
  )
  if (gapBias > 0 && insertion) {
    const consumed = Math.min(gapBias, insertion.insert.length)
    return {
      position: mappedPosition + consumed,
      gapBias: gapBias - consumed,
    }
  }

  const deletion = changes.find(
    (change) => change.from < position && position <= change.to,
  )
  const lostOffset = deletion
    ? position -
      deletion.from -
      Math.min(position - deletion.from, deletion.insert.length)
    : 0
  return {
    position: mappedPosition,
    gapBias: lostOffset > 0 ? lostOffset : gapBias,
  }
}

export function remapDeletedUndoItems(input: {
  doc: Y.Doc
  body: Y.Text
  deletedItems: DeletedUndoItem[]
  newFrom: number
  previousText: string
  nextText: string
}): IdMapping[] {
  if (input.deletedItems.length === 0) return []
  const runs = equalRuns(input.previousText, input.nextText)
  const groups = new Map<
    number,
    {
      text: string
      items: { item: DeletedUndoItem; offset: number; gapBias: number }[]
    }
  >()
  for (const item of input.deletedItems) {
    const mapped = mapGapWithBias(
      item.from,
      input.previousText,
      input.nextText,
      runs,
      item.gapBias,
    )
    const position = mapped.position
    const group = groups.get(position) ?? { text: '', items: [] }
    group.items.push({
      item,
      offset: group.text.length,
      gapBias: mapped.gapBias,
    })
    group.text += item.text
    groups.set(position, group)
  }

  const mappingsByStackItem = new Map<UndoStackItem, IdMapping[]>()
  const allMappings: IdMapping[] = []
  const garbageCollection = input.doc.gc
  // UndoManager needs the placeholder content when it restores a prior deletion.
  input.doc.gc = false
  input.doc.transact(() => {
    for (const [position, group] of groups) {
      const insertionFrom = input.newFrom + position
      input.body.insert(insertionFrom, group.text)
      const newSegments = captureVisibleSegments(
        input.body,
        insertionFrom,
        insertionFrom + group.text.length,
      )
      input.body.delete(insertionFrom, group.text.length)

      for (const { item, offset, gapBias } of group.items) {
        const mappings = mappingsByStackItem.get(item.stackItem) ?? []
        const itemEnd = offset + item.length
        for (const segment of newSegments) {
          const overlapFrom = Math.max(offset, segment.from)
          const overlapTo = Math.min(itemEnd, segment.to)
          if (overlapFrom >= overlapTo) continue
          const mapping = {
            fromClient: item.client,
            fromClock: item.clock + overlapFrom - offset,
            toClient: segment.client,
            toClock: segment.clock + overlapFrom - segment.from,
            length: overlapTo - overlapFrom,
          }
          mappings.push(mapping)
          allMappings.push(mapping)
          rememberGapBias(
            item.stackItem,
            segment.client,
            segment.clock + overlapFrom - segment.from,
            segment.clock + overlapTo - segment.from,
            gapBias,
          )
        }
        mappingsByStackItem.set(item.stackItem, mappings)
      }
    }
  }, historyMaintenanceOrigin)
  input.doc.gc = garbageCollection

  for (const [stackItem, mappings] of mappingsByStackItem) {
    remapDeleteSet(stackItem, 'deletions', mappings)
  }
  return allMappings
}
