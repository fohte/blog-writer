import { type ChangeSet, Text } from '@codemirror/state'

import { mapMoveBlockHistoryRemote } from '#article/move-block'
import type { HistoryEntry } from '#outline/move-history-types'

export function mapRemoteHistoryEntries(
  entries: HistoryEntry[],
  change: ChangeSet,
  markdown: string,
): HistoryEntry[] {
  const mappedEntries = [...entries]
  let currentChange: ChangeSet = change
  let currentMarkdown = markdown

  for (let index = mappedEntries.length - 1; index >= 0; index -= 1) {
    const entry = mappedEntries[index]
    if (!entry) continue

    if (entry.kind === 'text') {
      if (entry.inverse.length !== currentChange.length) {
        mappedEntries[index] = {
          ...entry,
          failure: 'The text history no longer matches the document',
        }
        return mappedEntries.slice(index)
      }
      const inverseBeforeMapping = entry.inverse
      const inverse = inverseBeforeMapping.map(currentChange)
      const changeBeforeEntry = currentChange.map(inverseBeforeMapping, true)
      if (inverse.length !== currentMarkdown.length) {
        mappedEntries[index] = {
          ...entry,
          failure: 'The text history no longer matches the document',
        }
        return mappedEntries.slice(index)
      }
      currentMarkdown = inverse
        .apply(Text.of(currentMarkdown.split('\n')))
        .toString()
      const memoAdoptions = entry.memoAdoptions.map((snapshot) => ({
        ...snapshot,
        markerIndex: currentChange.mapPos(snapshot.markerIndex, -1),
      }))

      if (inverse.empty) {
        mappedEntries.splice(index, 1)
      } else {
        mappedEntries[index] = { ...entry, inverse, memoAdoptions }
      }
      currentChange = changeBeforeEntry
      continue
    }

    if (entry.failure !== undefined) return mappedEntries.slice(index)
    if (entry.inverse.length !== currentChange.length) {
      mappedEntries[index] = {
        ...entry,
        failure: 'The move history no longer matches the document',
      }
      return mappedEntries.slice(index)
    }

    const inverseBeforeMapping = entry.inverse
    const mapped = mapMoveBlockHistoryRemote(
      currentMarkdown,
      entry.move,
      currentChange,
      inverseBeforeMapping,
    )
    if (mapped.isErr()) {
      mappedEntries[index] = { ...entry, failure: mapped.error.message }
      return mappedEntries.slice(index)
    }
    if (mapped.value.inverse.empty) {
      mappedEntries[index] = {
        ...entry,
        failure: 'The move history no longer matches the document',
      }
      return mappedEntries.slice(index)
    }
    mappedEntries[index] = {
      kind: 'move',
      move: mapped.value.move,
      inverse: mapped.value.inverse,
    }
    currentChange = mapped.value.changeBeforeMove
    currentMarkdown = mapped.value.markdownBeforeMove
  }

  return mappedEntries
}
