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
  mapMoveBlockPosition,
  moveBlock,
  type MoveBlockResult,
  recordMoveConflictRestoration,
  resolveMoveBlockStart,
  restoreMemoAdoptionHistory,
  restoreMemoAdoptions,
  reverseBlockMove,
} from '#article/index'
import type { MemoTextRange } from '#article/memos'
import { mapMemoAdoptions } from '#outline/move-history-mapping'
import { mapRemoteHistoryEntries } from '#outline/move-history-remote'
import { moveEntryForReverseStep } from '#outline/move-history-transitions'
import type {
  HistoryEntry,
  HistoryStateValue,
  MemoAdoptionHistoryRecord,
  MoveHistory,
  MoveHistoryFailure,
  MoveHistoryStep,
  TextHistoryEntry,
  TextHistoryStep,
} from '#outline/move-history-types'

const textHistoryStep = Annotation.define<TextHistoryStep>()
const recordMemoAdoptionHistory =
  StateEffect.define<MemoAdoptionHistoryRecord>()
const recordMove = StateEffect.define<MoveBlockResult>()
const applyMoveHistoryStep = StateEffect.define<MoveHistoryStep>()
const dropHistoryEntry = StateEffect.define<{
  direction: 'undo' | 'redo'
}>()
const clearHistory = StateEffect.define()

const newGroupDelay = 500
const maxHistoryDepth = 100
const joinableUserEvent = /^(input\.type|delete)($|\.)/u

export function memoAdoptionHistoryEffect(record: MemoAdoptionHistoryRecord) {
  return recordMemoAdoptionHistory.of(record)
}

function pushHistoryEntry(stack: HistoryEntry[], entry: HistoryEntry): void {
  stack.push(entry)
  if (stack.length > maxHistoryDepth)
    stack.splice(0, stack.length - maxHistoryDepth)
}

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

function deletedRangesIn(changes: ChangeSet): MemoTextRange[] {
  const ranges: MemoTextRange[] = []
  changes.iterChangedRanges((from, to) => {
    if (to > from) ranges.push({ from, to })
  })
  return ranges
}

function memoAdoptionsForOppositeStep(
  step: TextHistoryStep,
  entry: TextHistoryEntry,
) {
  if (step.direction === 'redo') return step.memoAdoptions
  return step.memoAdoptions.map((snapshot) => {
    const change = entry.memoAdoptionChanges.find(
      ({ id }) => id === snapshot.id,
    )
    if (change === undefined) return snapshot
    return { ...snapshot, adoptedTo: change.previousAdoptedTo }
  })
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
    (failure: MoveHistoryFailure | undefined) => void
  >()
  let currentError: MoveHistoryFailure | undefined
  let applyingLocalMove = false

  const historyField = StateField.define<HistoryStateValue>({
    create: () => ({ undo: [], redo: [], groupBarrier: false }),
    update(current, transaction) {
      if (transaction.effects.some((effect) => effect.is(clearHistory))) {
        return { undo: [], redo: [], groupBarrier: true }
      }

      const step = transaction.annotation(textHistoryStep)
      if (step) {
        const undo = [...current.undo]
        const redo = [...current.redo]
        const from = step.direction === 'undo' ? undo : redo
        const to = step.direction === 'undo' ? redo : undo
        const entry = from.pop()
        if (entry?.kind !== 'text') return current
        pushHistoryEntry(to, {
          ...entry,
          inverse: transaction.changes.invert(transaction.startState.doc),
          memoAdoptions: memoAdoptionsForOppositeStep(step, entry),
          selectionBefore: entry.selectionAfter,
          selectionAfter: entry.selectionBefore,
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
        pushHistoryEntry(to, moveEntryForReverseStep(entry, move))
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
        pushHistoryEntry(undo, { kind: 'move', move: move.value })
        redo = []
        groupBarrier = true
      }

      if (transaction.docChanged) {
        if (transaction.annotation(ySyncAnnotation) !== undefined) {
          if (applyingLocalMove) return { undo, redo, groupBarrier: true }
          const remoteChange = transaction.changes
          return {
            undo: mapRemoteHistoryEntries(undo, remoteChange),
            redo: mapRemoteHistoryEntries(redo, remoteChange),
            groupBarrier: true,
          }
        }
        if (transaction.annotation(Transaction.addToHistory) === false) {
          return { undo, redo, groupBarrier: true }
        }

        const deletedRanges = deletedRangesIn(transaction.changes)
        const memoAdoptions = mapMemoAdoptions(
          captureDeletedMemoAdoptions(
            doc,
            () => transaction.startState.doc.toString(),
            deletedRanges,
          ),
          transaction.changes,
        )
        const adoptionRecord = transaction.effects.find((effect) =>
          effect.is(recordMemoAdoptionHistory),
        )
        const isolation = transaction.annotation(isolateHistory)
        const inverse = transaction.changes.invert(transaction.startState.doc)
        const next: TextHistoryEntry = {
          kind: 'text',
          inverse,
          memoAdoptions:
            adoptionRecord?.is(recordMemoAdoptionHistory) === true
              ? [...memoAdoptions, adoptionRecord.value.redoSnapshot]
              : memoAdoptions,
          memoAdoptionChanges:
            adoptionRecord?.is(recordMemoAdoptionHistory) === true
              ? [adoptionRecord.value.change]
              : [],
          selectionBefore: transaction.startState.selection,
          selectionAfter: transaction.newSelection,
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
          const mappedSnapshots = mapMemoAdoptions(
            previous.memoAdoptions,
            transaction.changes,
          )
          undo[undo.length - 1] = {
            ...previous,
            inverse: next.inverse.compose(previous.inverse),
            memoAdoptions: [...mappedSnapshots, ...next.memoAdoptions],
            memoAdoptionChanges: [
              ...previous.memoAdoptionChanges,
              ...next.memoAdoptionChanges,
            ],
            selectionAfter: next.selectionAfter,
            userEvent: next.userEvent,
            time: next.time,
            isolateAfter: next.isolateAfter,
          }
        } else {
          pushHistoryEntry(undo, next)
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

  const report = <T>(
    result: Result<T, InvalidBlockMoveError>,
    operation: MoveHistoryFailure['operation'],
  ) =>
    result
      .map((value) => {
        clearError()
        return value
      })
      .mapErr((error) => {
        currentError = { operation, error }
        for (const listener of errorListeners) listener(currentError)
        return error
      })

  const updateAfterView = (update: ViewUpdate) => {
    for (const transaction of update.transactions) {
      const step = transaction.annotation(textHistoryStep)
      const moveStep = transaction.effects.find((effect) =>
        effect.is(applyMoveHistoryStep),
      )
      const moveHistoryStep =
        moveStep?.is(applyMoveHistoryStep) === true ? moveStep.value : undefined
      const beforeState = step?.beforeState ?? moveHistoryStep?.beforeState
      if (beforeState !== undefined) {
        recordMoveConflictRestoration(
          doc,
          beforeState,
          Y.decodeStateVector(Y.encodeStateVector(doc)),
        )
      }
      if (!step) continue

      if (step.direction === 'undo') {
        restoreMemoAdoptionHistory(
          doc,
          step.entry.memoAdoptionChanges,
          step.memoAdoptions,
        )
      }

      const snapshots = mapMemoAdoptions(
        step.entry.memoAdoptions,
        transaction.changes,
      )
      const insertedRanges: MemoTextRange[] = []
      transaction.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
        if (toB > fromB) insertedRanges.push({ from: fromB, to: toB })
      })
      restoreMemoAdoptions(doc, snapshots, insertedRanges)
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

    const dropAndFail = (message: string) => {
      view.dispatch({ effects: dropHistoryEntry.of({ direction }) })
      return err(new InvalidBlockMoveError(message))
    }

    if (entry.kind === 'text') {
      if (entry.failure !== undefined) return dropAndFail(entry.failure)
      if (entry.inverse.length !== view.state.doc.length)
        return dropAndFail('The text history no longer matches')
      view.dispatch({
        changes: entry.inverse,
        selection: entry.selectionBefore,
        annotations: [
          textHistoryStep.of({
            direction,
            entry,
            beforeState: Y.decodeStateVector(Y.encodeStateVector(doc)),
            memoAdoptions: mapMemoAdoptions(
              captureDeletedMemoAdoptions(
                doc,
                () => view.state.doc.toString(),
                deletedRangesIn(entry.inverse),
              ),
              entry.inverse,
            ),
          }),
          Transaction.addToHistory.of(false),
          Transaction.userEvent.of(direction),
        ],
        effects: [EditorView.scrollIntoView(entry.selectionBefore.main.head)],
      })
      return ok(true)
    }

    const discardMoveAndFail = (message: string) => {
      view.dispatch({ effects: clearHistory.of(null) })
      return err(new InvalidBlockMoveError(message))
    }

    if (entry.failure !== undefined) return discardMoveAndFail(entry.failure)

    if (resolveMoveBlockStart(doc, entry.move) === undefined)
      return discardMoveAndFail('The moved block is no longer available')

    const selection = view.state.selection.main
    const beforeState = Y.decodeStateVector(Y.encodeStateVector(doc))
    applyingLocalMove = true
    const result = reverseBlockMove(doc, entry.move, direction, {
      validate: entry.requiresValidation === true,
    })
    applyingLocalMove = false
    if (result.isErr())
      return discardMoveAndFail(
        'The block can no longer be restored to its previous position',
      )

    const reversed = result.value
    const mappedAnchor = mapMoveBlockPosition(reversed, selection.anchor)
    const mappedHead = mapMoveBlockPosition(reversed, selection.head)
    view.dispatch({
      ...(mappedAnchor === undefined || mappedHead === undefined
        ? {}
        : { selection: EditorSelection.range(mappedAnchor, mappedHead) }),
      annotations: reversed.annotations,
      effects: [
        applyMoveHistoryStep.of({ direction, move: reversed, beforeState }),
      ],
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
      return report(
        applyMove(() => moveBlock(doc, input), view),
        'move',
      )
    },
    undo(view) {
      return report(stepHistory('undo', view), 'undo')
    },
    redo(view) {
      return report(stepHistory('redo', view), 'redo')
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
