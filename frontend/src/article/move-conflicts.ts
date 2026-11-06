import { err, ok, Result } from 'neverthrow'
import * as Y from 'yjs'

import { InvalidBlockMoveError } from '#article/errors'
import {
  detectMoveConflictDetails,
  type MoveConflict,
  recordMoveConflictRestoration as recordRestoration,
  resolveMoveConflictRange,
} from '#article/move-conflict-detection'
import {
  cleanupMoveRecords,
  keepMoveConflict,
  observeMoveConflictState,
  registerMoveConflictObserver,
} from '#article/move-conflict-records'

export type { MoveConflict } from '#article/move-conflict-detection'

export function getMoveConflicts(doc: Y.Doc): MoveConflict[] {
  cleanupMoveRecords(doc)
  return detectMoveConflictDetails(doc).map(({ conflict }) => conflict)
}

export function resolveMoveConflict(
  doc: Y.Doc,
  conflictId: string,
  resolution: 'move' | 'keep',
): Result<void, InvalidBlockMoveError> {
  const detail = detectMoveConflictDetails(doc).find(
    ({ conflict }) => conflict.id === conflictId,
  )
  if (!detail)
    return err(
      new InvalidBlockMoveError('The move conflict is no longer available'),
    )
  if (resolution === 'keep') {
    keepMoveConflict(doc, detail.recordId, conflictId, detail.decisionRanges)
    return ok()
  }
  resolveMoveConflictRange(doc, detail.conflict, detail.recordId, detail.target)
  return ok()
}

export function recordMoveConflictRestoration(
  doc: Y.Doc,
  events: readonly Y.YTextEvent[],
): Result<void, InvalidBlockMoveError> {
  const body = doc.getText('body')
  if (events.some((event) => event.target !== body))
    return err(
      new InvalidBlockMoveError(
        'Move conflict restorations must target the article body',
      ),
    )
  const currentState = Y.decodeStateVector(Y.encodeStateVector(doc))
  if (
    events.some((event) => {
      if (event.transaction.doc !== doc) return true
      const eventState = event.transaction.afterState
      const clients = new Set([...currentState.keys(), ...eventState.keys()])
      return [...clients].some(
        (client) => currentState.get(client) !== eventState.get(client),
      )
    })
  )
    return err(
      new InvalidBlockMoveError(
        'Move conflict restoration events must describe the current document state',
      ),
    )
  recordRestoration(doc, events)
  return ok()
}

export function observeMoveConflicts(
  doc: Y.Doc,
  onAcknowledgement?: () => void,
): () => void {
  const stopObservingRecords = registerMoveConflictObserver(doc)
  if (!onAcknowledgement) return stopObservingRecords

  const acknowledgements = doc.getMap<number>('move-acks')
  const notify = () => {
    onAcknowledgement()
  }
  acknowledgements.observe(notify)
  const stopObservingState = observeMoveConflictState(doc, notify)
  return () => {
    acknowledgements.unobserve(notify)
    stopObservingState()
    stopObservingRecords()
  }
}
