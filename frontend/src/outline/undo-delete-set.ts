import * as Y from 'yjs'

import type { IdMapping } from '#outline/undo-id-segments'

type UndoStackItem = Y.UndoManager['undoStack'][number]
type DeleteRange = { clock: number; len: number }

function sortAndMerge(ranges: DeleteRange[]): DeleteRange[] {
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

export function remapDeleteSet(
  stackItem: UndoStackItem,
  key: 'insertions' | 'deletions',
  mappings: IdMapping[],
): void {
  const remapped = new Map<number, DeleteRange[]>()
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
