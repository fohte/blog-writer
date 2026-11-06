import type { MoveBlockResult } from '#article/move-block'
import type { HistoryEntry } from '#outline/move-history-types'

type MoveHistoryEntry = Extract<HistoryEntry, { kind: 'move' }>

export function moveEntryForReverseStep(
  entry: Pick<MoveHistoryEntry, 'requiresValidation'>,
  move: MoveBlockResult,
): MoveHistoryEntry {
  return {
    kind: 'move',
    move,
    ...(entry.requiresValidation === true ? { requiresValidation: true } : {}),
  }
}
