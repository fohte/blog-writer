import type { ChangeSet, EditorSelection, Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { Result } from 'neverthrow'

import type { InvalidBlockMoveError } from '#article/errors'
import type { MemoAdoptionSnapshot } from '#article/memos'
import type { MoveBlockInput, MoveBlockResult } from '#article/move-block'

export type TextHistoryEntry = {
  kind: 'text'
  inverse: ChangeSet
  memoAdoptions: MemoAdoptionSnapshot[]
  selectionBefore: EditorSelection
  selectionAfter: EditorSelection
  userEvent: string | undefined
  time: number
  isolateBefore: boolean
  isolateAfter: boolean
  failure?: string
}

type MoveHistoryEntry = {
  kind: 'move'
  move: MoveBlockResult
  requiresValidation?: true
  failure?: string
}

export type HistoryEntry = TextHistoryEntry | MoveHistoryEntry

export type HistoryStateValue = {
  undo: HistoryEntry[]
  redo: HistoryEntry[]
  groupBarrier: boolean
}

export type TextHistoryStep = {
  direction: 'undo' | 'redo'
  entry: TextHistoryEntry
  memoAdoptions: MemoAdoptionSnapshot[]
  beforeState: ReadonlyMap<number, number>
}

export type MoveHistoryStep = {
  direction: 'undo' | 'redo'
  move: MoveBlockResult
  beforeState: ReadonlyMap<number, number>
}

export interface MoveHistory {
  extension: Extension
  onError(
    listener: (error: InvalidBlockMoveError | undefined) => void,
  ): () => void
  move(
    input: MoveBlockInput,
    view: EditorView,
  ): Result<MoveBlockResult, InvalidBlockMoveError>
  undo(view: EditorView): Result<boolean, InvalidBlockMoveError>
  redo(view: EditorView): Result<boolean, InvalidBlockMoveError>
  destroy(): void
}
