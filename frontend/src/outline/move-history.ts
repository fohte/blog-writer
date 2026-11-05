import type { EditorView } from '@codemirror/view'
import { err, ok, type Result } from 'neverthrow'
import * as Y from 'yjs'

import { InvalidBlockMoveError } from '#article/errors'
import {
  findMoveBlockRange,
  getBody,
  moveBlock,
  type MoveBlockInput,
  type MoveBlockResult,
  readBody,
  reverseBlockMove,
} from '#article/index'
import {
  captureDeletedUndoItems,
  captureVisibleSegments,
  remapUndoItemIds,
} from '#outline/undo-id-mapping'

type HistoryAction = { kind: 'text' } | { kind: 'move'; move: MoveBlockResult }

export interface MoveHistory {
  undoManager: Y.UndoManager
  move(
    input: MoveBlockInput,
    view?: EditorView,
  ): Result<MoveBlockResult, InvalidBlockMoveError>
  undo(view?: EditorView): Result<boolean, InvalidBlockMoveError>
  redo(view?: EditorView): Result<boolean, InvalidBlockMoveError>
  destroy(): void
}

function makeMoveError(message: string): InvalidBlockMoveError {
  return new InvalidBlockMoveError(message)
}

export function createMoveHistory(doc: Y.Doc): MoveHistory {
  const body = getBody(doc)
  const undoManager = new Y.UndoManager(body)
  const undoActions: HistoryAction[] = []
  const redoActions: HistoryAction[] = []
  let applyingHistory = false

  undoManager.on('stack-item-added', ({ type }) => {
    if (applyingHistory || type !== 'undo') return
    undoActions.push({ kind: 'text' })
  })
  undoManager.on('stack-cleared', ({ undoStackCleared, redoStackCleared }) => {
    if (applyingHistory) return
    if (undoStackCleared) undoActions.length = 0
    if (redoStackCleared) redoActions.length = 0
  })

  const applyMove = (
    from: number,
    operation: () => Result<MoveBlockResult, InvalidBlockMoveError>,
    view?: EditorView,
  ): Result<MoveBlockResult, InvalidBlockMoveError> => {
    const previousText = readBody(doc)
    const range = findMoveBlockRange(previousText, from)
    if (!range) return err(makeMoveError('No Markdown block at position'))
    const oldSegments = captureVisibleSegments(body, range.from, range.to)
    const sourceText = previousText.slice(range.from, range.to)
    const deletedItems = captureDeletedUndoItems(
      doc,
      body,
      range.from,
      range.to,
      [...undoManager.undoStack, ...undoManager.redoStack],
    )

    undoManager.stopCapturing()
    const result = operation()
    if (result.isErr()) return err(result.error)

    const move = result.value
    const nextText = readBody(doc).slice(move.from, move.to)
    remapUndoItemIds({
      doc,
      body,
      oldSegments,
      deletedItems,
      undoStack: undoManager.undoStack,
      redoStack: undoManager.redoStack,
      newFrom: move.from,
      newTo: move.to,
      previousText: sourceText,
      nextText,
    })
    undoManager.stopCapturing()
    view?.dispatch({ annotations: move.annotations })
    return ok(move)
  }

  const move = (input: MoveBlockInput, view?: EditorView) =>
    applyMove(input.from, () => moveBlock(doc, input), view).map((result) => {
      undoManager.clear(false, true)
      redoActions.length = 0
      undoActions.push({ kind: 'move', move: result })
      return result
    })

  const undo = (view?: EditorView): Result<boolean, InvalidBlockMoveError> => {
    const action = undoActions.pop()
    if (!action) return ok(false)

    if (action.kind === 'text') {
      applyingHistory = true
      const result = undoManager.undo()
      applyingHistory = false
      if (!result) {
        undoActions.push(action)
        return ok(false)
      }
      redoActions.push(action)
      return ok(true)
    }

    const result = applyMove(
      action.move.from,
      () => reverseBlockMove(doc, action.move),
      view,
    )
    if (result.isErr()) {
      undoActions.push(action)
      return err(result.error)
    }
    redoActions.push({ kind: 'move', move: result.value })
    return ok(true)
  }

  const redo = (view?: EditorView): Result<boolean, InvalidBlockMoveError> => {
    const action = redoActions.pop()
    if (!action) return ok(false)

    if (action.kind === 'text') {
      applyingHistory = true
      const result = undoManager.redo()
      applyingHistory = false
      if (!result) {
        redoActions.push(action)
        return ok(false)
      }
      undoActions.push(action)
      return ok(true)
    }

    const result = applyMove(
      action.move.from,
      () => reverseBlockMove(doc, action.move),
      view,
    )
    if (result.isErr()) {
      redoActions.push(action)
      return err(result.error)
    }
    undoActions.push({ kind: 'move', move: result.value })
    return ok(true)
  }

  return {
    undoManager,
    move(input, view) {
      return move(input, view)
    },
    undo,
    redo,
    destroy() {
      undoManager.destroy()
    },
  }
}
