import { isolateHistory } from '@codemirror/commands'
import {
  Annotation,
  type ChangeSet,
  EditorSelection,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import { err, ok, type Result } from 'neverthrow'
import { ySyncAnnotation } from 'y-codemirror.next'
import * as Y from 'yjs'

import { InvalidBlockMoveError } from '#article/errors'
import {
  blockMoved,
  captureDeletedMemoAdoptions,
  getReverseMoveChange,
  mapMoveBlockPosition,
  moveBlock,
  type MoveBlockResult,
  resolveMoveBlockStart,
  restoreMemoAdoptions,
  reverseBlockMove,
} from '#article/index'
import type { MemoTextRange } from '#article/memos'
import { mapRemoteHistoryEntries } from '#outline/move-history-remote'
import type {
  HistoryStateValue,
  MoveHistory,
  MoveHistoryStep,
  TextHistoryEntry,
  TextHistoryStep,
} from '#outline/move-history-types'

const textHistoryStep = Annotation.define<TextHistoryStep>()
const recordMove = StateEffect.define<MoveBlockResult>()
const applyMoveHistoryStep = StateEffect.define<MoveHistoryStep>()
const dropHistoryEntry = StateEffect.define<{
  direction: 'undo' | 'redo'
}>()

const newGroupDelay = 500
const joinableUserEvent = /^(input\.type|delete)($|\.)/u

function changeRangesAreAdjacent(
  previous: ChangeSet,
  next: ChangeSet,
): boolean {
  const previousRanges: MemoTextRange[] = []
  previous.iterChangedRanges((from, to) => {
    previousRanges.push({ from, to })
  })

  let adjacent = false
  next.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    if (previousRanges.some((range) => toB >= range.from && fromB <= range.to))
      adjacent = true
  })
  return adjacent
}

function isHistoryBoundary(
  value: string | undefined,
  side: 'before' | 'after',
) {
  return value === 'full' || value === side
}

function canJoinTextEntries(
  previous: TextHistoryEntry | undefined,
  next: TextHistoryEntry,
  groupBarrier: boolean,
): previous is TextHistoryEntry {
  return Boolean(
    previous &&
    !groupBarrier &&
    !previous.isolateAfter &&
    !next.isolateBefore &&
    (next.userEvent === undefined ||
      joinableUserEvent.test(next.userEvent) ||
      next.userEvent === 'input.type.compose') &&
    (next.userEvent === 'input.type.compose' ||
      (next.time - previous.time < newGroupDelay &&
        changeRangesAreAdjacent(previous.inverse, next.inverse))),
  )
}

export type { MoveHistory }

export function createMoveHistory(doc: Y.Doc): MoveHistory {
  const errorListeners = new Set<
    (error: InvalidBlockMoveError | undefined) => void
  >()
  let currentError: InvalidBlockMoveError | undefined
  let applyingLocalMove = false

  const historyField = StateField.define<HistoryStateValue>({
    create: () => ({ undo: [], redo: [], groupBarrier: false }),
    update(current, transaction) {
      const step = transaction.annotation(textHistoryStep)
      if (step) {
        const undo = [...current.undo]
        const redo = [...current.redo]
        const from = step.direction === 'undo' ? undo : redo
        const to = step.direction === 'undo' ? redo : undo
        const entry = from.pop()
        if (entry?.kind !== 'text') return current
        to.push({
          ...entry,
          inverse: transaction.changes.invert(transaction.startState.doc),
        })
        return { undo, redo, groupBarrier: true }
      }

      const undo = [...current.undo]
      let redo = [...current.redo]
      let groupBarrier = current.groupBarrier

      const moveStep = transaction.effects.find((effect) =>
        effect.is(applyMoveHistoryStep),
      )
      if (
        moveStep?.is(applyMoveHistoryStep) === true &&
        transaction.annotation(blockMoved) !== undefined
      ) {
        const { direction, move } = moveStep.value
        const from = direction === 'undo' ? undo : redo
        const to = direction === 'undo' ? redo : undo
        const entry = from.pop()
        if (entry?.kind !== 'move') return current
        const inverse = getReverseMoveChange(move)
        if (inverse) to.push({ kind: 'move', move, inverse })
        groupBarrier = true
      }

      const dropped = transaction.effects.find((effect) =>
        effect.is(dropHistoryEntry),
      )
      if (dropped?.is(dropHistoryEntry) === true) {
        const stack = dropped.value.direction === 'undo' ? undo : redo
        stack.pop()
        groupBarrier = true
      }

      const move = transaction.effects.find((effect) => effect.is(recordMove))
      if (
        move?.is(recordMove) === true &&
        transaction.annotation(blockMoved) !== undefined
      ) {
        const inverse = getReverseMoveChange(move.value)
        if (inverse) undo.push({ kind: 'move', move: move.value, inverse })
        redo = []
        groupBarrier = true
      }

      if (transaction.docChanged) {
        if (transaction.annotation(ySyncAnnotation) !== undefined) {
          if (applyingLocalMove) return { undo, redo, groupBarrier: true }
          const remoteChange = transaction.changes
          const remoteMarkdown = transaction.newDoc.toString()
          return {
            undo: mapRemoteHistoryEntries(undo, remoteChange, remoteMarkdown),
            redo: mapRemoteHistoryEntries(redo, remoteChange, remoteMarkdown),
            groupBarrier: true,
          }
        }
        if (transaction.annotation(Transaction.addToHistory) === false) {
          return { undo, redo, groupBarrier: true }
        }

        const deletedRanges: MemoTextRange[] = []
        transaction.changes.iterChangedRanges((from, to) => {
          if (to > from) deletedRanges.push({ from, to })
        })
        const memoAdoptions = captureDeletedMemoAdoptions(
          doc,
          transaction.startState.doc.toString(),
          deletedRanges,
        ).map((snapshot) => ({
          ...snapshot,
          markerIndex: transaction.changes.mapPos(snapshot.markerIndex, -1),
        }))
        const isolation = transaction.annotation(isolateHistory)
        const inverse = transaction.changes.invert(transaction.startState.doc)
        const next: TextHistoryEntry = {
          kind: 'text',
          inverse,
          memoAdoptions,
          userEvent: transaction.annotation(Transaction.userEvent),
          time: transaction.annotation(Transaction.time) ?? Date.now(),
          isolateBefore: isHistoryBoundary(isolation, 'before'),
          isolateAfter: isHistoryBoundary(isolation, 'after'),
        }
        const previous = undo.at(-1)
        if (
          previous?.kind === 'text' &&
          canJoinTextEntries(previous, next, groupBarrier)
        ) {
          const mappedSnapshots = previous.memoAdoptions.map((snapshot) => ({
            ...snapshot,
            markerIndex: transaction.changes.mapPos(snapshot.markerIndex, -1),
          }))
          undo[undo.length - 1] = {
            ...previous,
            inverse: next.inverse.compose(previous.inverse),
            memoAdoptions: mappedSnapshots,
            userEvent: next.userEvent,
            time: next.time,
            isolateAfter: next.isolateAfter,
          }
        } else {
          undo.push(next)
        }
        return { undo, redo: [], groupBarrier: false }
      }

      if (transaction.selection !== undefined) groupBarrier = true
      return { undo, redo, groupBarrier }
    },
  })

  const clearError = () => {
    currentError = undefined
    for (const listener of errorListeners) listener(undefined)
  }

  const report = <T>(result: Result<T, InvalidBlockMoveError>) =>
    result
      .map((value) => {
        clearError()
        return value
      })
      .mapErr((error) => {
        currentError = error
        for (const listener of errorListeners) listener(error)
        return error
      })

  const updateAfterView = (update: ViewUpdate) => {
    for (const transaction of update.transactions) {
      const step = transaction.annotation(textHistoryStep)
      if (step) {
        const entry = step.entry
        if (step.direction === 'undo') {
          const snapshots = entry.memoAdoptions.map((snapshot) => ({
            ...snapshot,
            markerIndex: transaction.changes.mapPos(snapshot.markerIndex, -1),
          }))
          const insertedRanges: MemoTextRange[] = []
          transaction.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
            if (toB > fromB) insertedRanges.push({ from: fromB, to: toB })
          })
          restoreMemoAdoptions(doc, snapshots, insertedRanges)
        }
        continue
      }
    }
  }

  const applyMove = (
    operation: () => Result<MoveBlockResult, InvalidBlockMoveError>,
    view: EditorView,
  ): Result<MoveBlockResult, InvalidBlockMoveError> => {
    const selection = view.state.selection.main
    applyingLocalMove = true
    const result = operation()
    applyingLocalMove = false
    if (result.isErr()) return err(result.error)

    const move = result.value
    const mappedAnchor = mapMoveBlockPosition(move, selection.anchor)
    const mappedHead = mapMoveBlockPosition(move, selection.head)
    view.dispatch({
      ...(mappedAnchor === undefined || mappedHead === undefined
        ? {}
        : { selection: EditorSelection.range(mappedAnchor, mappedHead) }),
      annotations: move.annotations,
      effects: [recordMove.of(move)],
    })
    view.focus()
    return ok(move)
  }

  const stepHistory = (
    direction: 'undo' | 'redo',
    view: EditorView,
  ): Result<boolean, InvalidBlockMoveError> => {
    const state = view.state.field(historyField)
    const stack = direction === 'undo' ? state.undo : state.redo
    const entry = stack.at(-1)
    if (!entry) return ok(false)

    if (entry.kind === 'text') {
      if (entry.failure !== undefined) {
        view.dispatch({ effects: dropHistoryEntry.of({ direction }) })
        return err(new InvalidBlockMoveError(entry.failure))
      }
      if (entry.inverse.length !== view.state.doc.length) {
        view.dispatch({ effects: dropHistoryEntry.of({ direction }) })
        return err(
          new InvalidBlockMoveError('The text history no longer matches'),
        )
      }
      view.dispatch({
        changes: entry.inverse,
        annotations: [
          textHistoryStep.of({ direction, entry }),
          Transaction.addToHistory.of(false),
          Transaction.userEvent.of(direction),
        ],
      })
      return ok(true)
    }

    if (entry.failure !== undefined) {
      view.dispatch({ effects: dropHistoryEntry.of({ direction }) })
      return err(new InvalidBlockMoveError(entry.failure))
    }

    if (resolveMoveBlockStart(doc, entry.move) === undefined) {
      view.dispatch({ effects: dropHistoryEntry.of({ direction }) })
      return err(
        new InvalidBlockMoveError('The moved block is no longer available'),
      )
    }

    applyingLocalMove = true
    const result = reverseBlockMove(doc, entry.move, direction)
    applyingLocalMove = false
    if (result.isErr()) {
      view.dispatch({ effects: dropHistoryEntry.of({ direction }) })
      return err(result.error)
    }

    const reversed = result.value
    const selection = view.state.selection.main
    const mappedAnchor = mapMoveBlockPosition(reversed, selection.anchor)
    const mappedHead = mapMoveBlockPosition(reversed, selection.head)
    view.dispatch({
      ...(mappedAnchor === undefined || mappedHead === undefined
        ? {}
        : { selection: EditorSelection.range(mappedAnchor, mappedHead) }),
      annotations: reversed.annotations,
      effects: [applyMoveHistoryStep.of({ direction, move: reversed })],
    })
    view.focus()
    return ok(true)
  }

  const extension = [
    historyField,
    EditorView.updateListener.of(updateAfterView),
  ] as const

  return {
    extension,
    move(input, view) {
      return report(applyMove(() => moveBlock(doc, input), view))
    },
    undo(view) {
      return report(stepHistory('undo', view))
    },
    redo(view) {
      return report(stepHistory('redo', view))
    },
    onError(listener) {
      errorListeners.add(listener)
      listener(currentError)
      return () => {
        errorListeners.delete(listener)
      }
    },
    destroy() {
      errorListeners.clear()
    },
  }
}
