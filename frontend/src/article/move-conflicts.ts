import { err, ok, Result } from 'neverthrow'
import * as Y from 'yjs'

import { InvalidBlockMoveError } from '#article/errors'
import {
  detectMoveConflictDetails,
  type MoveConflict,
  resolveMoveConflictRange,
} from '#article/move-conflict-detection'
import {
  cleanupMoveRecords,
  keepMoveConflict,
  observeMoveConflictState,
  registerMoveConflictObserver,
} from '#article/move-conflict-records'

export type { MoveConflict } from '#article/move-conflict-detection'
export { recordMoveConflictRestoration } from '#article/move-conflict-detection'

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
