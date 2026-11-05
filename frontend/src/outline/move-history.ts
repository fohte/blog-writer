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
  onError(
    listener: (error: InvalidBlockMoveError | undefined) => void,
  ): () => void
  move(
    input: MoveBlockInput,
    view?: EditorView,
  ): Result<MoveBlockResult, InvalidBlockMoveError>
  undo(view?: EditorView): Result<boolean, InvalidBlockMoveError>
  redo(view?: EditorView): Result<boolean, InvalidBlockMoveError>
  destroy(): void
}

export function createMoveHistory(doc: Y.Doc): MoveHistory {
  const body = getBody(doc)
  const undoManager = new Y.UndoManager(body)
  const undoActions: HistoryAction[] = []
  const redoActions: HistoryAction[] = []
  const errorListeners = new Set<
    (error: InvalidBlockMoveError | undefined) => void
  >()
  let currentError: InvalidBlockMoveError | undefined
  let applyingHistory = false

  const report = <T>(result: Result<T, InvalidBlockMoveError>) =>
    result
      .map((value) => {
        currentError = undefined
        for (const listener of errorListeners) listener(undefined)
        return value
      })
      .mapErr((error) => {
        currentError = error
        for (const listener of errorListeners) listener(error)
        return error
      })

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
    if (!range)
      return err(new InvalidBlockMoveError('No Markdown block at position'))
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

  const stepHistory = (
    fromStack: HistoryAction[],
    toStack: HistoryAction[],
    applyTextAction: () => ReturnType<Y.UndoManager['undo']>,
    view?: EditorView,
  ): Result<boolean, InvalidBlockMoveError> => {
    const action = fromStack.pop()
    if (!action) return ok(false)

    if (action.kind === 'text') {
      applyingHistory = true
      const result = applyTextAction()
      applyingHistory = false
      if (result === null) {
        fromStack.push(action)
        return ok(false)
      }
      toStack.push(action)
      return ok(true)
    }

    const result = applyMove(
      action.move.from,
      () => reverseBlockMove(doc, action.move),
      view,
    )
    if (result.isErr()) {
      fromStack.push(action)
      return err(result.error)
    }
    toStack.push({ kind: 'move', move: result.value })
    return ok(true)
  }

  const undo = (view?: EditorView) =>
    report(
      stepHistory(undoActions, redoActions, () => undoManager.undo(), view),
    )

  const redo = (view?: EditorView) =>
    report(
      stepHistory(redoActions, undoActions, () => undoManager.redo(), view),
    )

  return {
    undoManager,
    move(input, view) {
      return report(move(input, view))
    },
    undo,
    redo,
    onError(listener) {
      errorListeners.add(listener)
      listener(currentError)
      return () => {
        errorListeners.delete(listener)
      }
    },
    destroy() {
      errorListeners.clear()
      undoManager.destroy()
    },
  }
}
