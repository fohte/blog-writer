import * as Y from 'yjs'

import { diff } from '#editor/text-diff'

export type IdSegment = {
  from: number
  to: number
  client: number
  clock: number
}
type DeleteRange = { clock: number; len: number }
type IdMapping = {
  fromClient: number
  fromClock: number
  toClient: number
  toClock: number
  length: number
}
type UndoStackItem = Y.UndoManager['undoStack'][number]
type DeletedUndoItem = {
  stackItem: UndoStackItem
  from: number
  client: number
  clock: number
  length: number
  text: string
}
type VisibleItemRange = { item: Y.Item; from: number; to: number }

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

export function captureVisibleSegments(
  body: Y.Text,
  from: number,
  to: number,
): IdSegment[] {
  const segments: IdSegment[] = []
  let position = 0
  for (let item = body._start; item; item = item.next) {
    if (item.deleted || !item.countable) continue
    const end = position + item.length
    const overlapFrom = Math.max(from, position)
    const overlapTo = Math.min(to, end)
    if (overlapFrom < overlapTo) {
      segments.push({
        from: overlapFrom - from,
        to: overlapTo - from,
        client: item.id.client,
        clock: item.id.clock + overlapFrom - position,
      })
    }
    position = end
  }
  return segments
}

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
      const anchor = right
      const segment = findVisibleItem(
        visibleItemsByClient.get(anchor.id.client),
        anchor.id.clock,
      )
      if (segment) return segment.from + anchor.id.clock - segment.item.id.clock
      right = anchor.right
    }

    let left = item.left
    while (left) {
      const anchor = left
      const segment = findVisibleItem(
        visibleItemsByClient.get(anchor.id.client),
        anchor.id.clock,
      )
      if (segment) return segment.from + segment.item.length
      left = anchor.left
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
          if (position < from || position >= to) continue
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
            })
          }
        }
      }
    }
  }
  return targets
}

function equalRuns(previous: string, next: string) {
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

function intersectIdSegments(
  oldSegments: IdSegment[],
  newSegments: IdSegment[],
  equalRun: { from: number; to: number; nextFrom: number },
): IdMapping[] {
  const mappings: IdMapping[] = []
  let offset = equalRun.from
  while (offset < equalRun.to) {
    const nextOffset = equalRun.nextFrom + offset - equalRun.from
    const oldSegment = oldSegments.find(
      ({ from, to }) => from <= offset && offset < to,
    )
    const newSegment = newSegments.find(
      ({ from, to }) => from <= nextOffset && nextOffset < to,
    )
    if (!oldSegment || !newSegment) break

    const length = Math.min(
      equalRun.to - offset,
      oldSegment.to - offset,
      newSegment.to - nextOffset,
    )
    mappings.push({
      fromClient: oldSegment.client,
      fromClock: oldSegment.clock + offset - oldSegment.from,
      toClient: newSegment.client,
      toClock: newSegment.clock + nextOffset - newSegment.from,
      length,
    })
    offset += length
  }
  return mappings
}

function sortAndMerge(
  ranges: { clock: number; len: number }[],
): { clock: number; len: number }[] {
  const sorted = ranges.toSorted((left, right) => left.clock - right.clock)
  const merged: DeleteRange[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (
      previous !== undefined &&
      previous.clock + previous.len >= range.clock
    ) {
      previous.len =
        Math.max(previous.clock + previous.len, range.clock + range.len) -
        previous.clock
    } else {
      merged.push({ ...range })
    }
  }
  return merged
}

function remapDeleteSet(
  stackItem: UndoStackItem,
  key: 'insertions' | 'deletions',
  mappings: IdMapping[],
): void {
  const remapped = new Map<number, { clock: number; len: number }[]>()
  const add = (client: number, clock: number, len: number) => {
    const ranges = remapped.get(client) ?? []
    ranges.push({ clock, len })
    remapped.set(client, ranges)
  }

  const deleteSet = stackItem[key]
  for (const [client, ranges] of deleteSet.clients) {
    for (const { clock, len } of ranges) {
      const end = clock + len
      const matches = mappings
        .filter(
          (mapping) =>
            mapping.fromClient === client &&
            mapping.fromClock < end &&
            mapping.fromClock + mapping.length > clock,
        )
        .toSorted((left, right) => left.fromClock - right.fromClock)
      let current = clock
      for (const mapping of matches) {
        const overlapFrom = Math.max(current, mapping.fromClock)
        const overlapTo = Math.min(end, mapping.fromClock + mapping.length)
        if (current < overlapFrom) add(client, current, overlapFrom - current)
        add(
          mapping.toClient,
          mapping.toClock + overlapFrom - mapping.fromClock,
          overlapTo - overlapFrom,
        )
        current = overlapTo
      }
      if (current < end) add(client, current, end - current)
    }
  }

  deleteSet.clients.clear()
  for (const [client, ranges] of remapped) {
    deleteSet.clients.set(client, sortAndMerge(ranges))
  }
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

function remapDeletedUndoItems(input: {
  doc: Y.Doc
  body: Y.Text
  deletedItems: DeletedUndoItem[]
  newFrom: number
  previousText: string
  nextText: string
}): void {
  if (input.deletedItems.length === 0) return
  const runs = equalRuns(input.previousText, input.nextText)
  const groups = new Map<
    number,
    { text: string; items: { item: DeletedUndoItem; offset: number }[] }
  >()
  for (const item of input.deletedItems) {
    const position = mapGap(item.from, runs)
    const group = groups.get(position) ?? { text: '', items: [] }
    group.items.push({ item, offset: group.text.length })
    group.text += item.text
    groups.set(position, group)
  }

  const mappingsByStackItem = new Map<UndoStackItem, IdMapping[]>()
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

      for (const { item, offset } of group.items) {
        const mappings = mappingsByStackItem.get(item.stackItem) ?? []
        const itemEnd = offset + item.length
        for (const segment of newSegments) {
          const overlapFrom = Math.max(offset, segment.from)
          const overlapTo = Math.min(itemEnd, segment.to)
          if (overlapFrom >= overlapTo) continue
          mappings.push({
            fromClient: item.client,
            fromClock: item.clock + overlapFrom - offset,
            toClient: segment.client,
            toClock: segment.clock + overlapFrom - segment.from,
            length: overlapTo - overlapFrom,
          })
        }
        mappingsByStackItem.set(item.stackItem, mappings)
      }
    }
  }, historyMaintenanceOrigin)
  input.doc.gc = garbageCollection

  for (const [stackItem, mappings] of mappingsByStackItem) {
    remapDeleteSet(stackItem, 'deletions', mappings)
  }
}

/** Yjs stores undo targets as item IDs, so moved text needs matching IDs in both history stacks. */
export function remapUndoItemIds(input: {
  doc: Y.Doc
  body: Y.Text
  oldSegments: IdSegment[]
  deletedItems: DeletedUndoItem[]
  undoStack: Y.UndoManager['undoStack']
  redoStack: Y.UndoManager['redoStack']
  newFrom: number
  newTo: number
  previousText: string
  nextText: string
}): void {
  const newSegments = captureVisibleSegments(
    input.body,
    input.newFrom,
    input.newTo,
  )
  const mappings = equalRuns(input.previousText, input.nextText).flatMap(
    (run) => intersectIdSegments(input.oldSegments, newSegments, run),
  )

  remapDeletedUndoItems({
    doc: input.doc,
    body: input.body,
    deletedItems: input.deletedItems,
    newFrom: input.newFrom,
    previousText: input.previousText,
    nextText: input.nextText,
  })

  for (const stackItem of [...input.undoStack, ...input.redoStack]) {
    remapDeleteSet(stackItem, 'insertions', mappings)
  }
}
