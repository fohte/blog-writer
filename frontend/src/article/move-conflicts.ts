import { err, ok, Result } from 'neverthrow'
import * as Y from 'yjs'

import { InvalidBlockMoveError } from '#article/errors'
import {
  detectMoveConflicts,
  isConflictCurrent,
  type MoveConflict,
  resolveMoveConflictRange,
} from '#article/move-conflict-detection'
import {
  cleanupMoveRecords,
  registerMoveConflictObserver,
} from '#article/move-conflict-records'

export type { MoveConflict } from '#article/move-conflict-detection'

export function getMoveConflicts(doc: Y.Doc): MoveConflict[] {
  cleanupMoveRecords(doc)
  return detectMoveConflicts(doc)
}

export function resolveMoveConflict(
  doc: Y.Doc,
  conflictId: string,
  resolution: 'move' | 'keep',
): Result<void, InvalidBlockMoveError> {
  const conflict = detectMoveConflicts(doc).find(({ id }) => id === conflictId)
  if (!conflict)
    return err(
      new InvalidBlockMoveError('The move conflict is no longer available'),
    )
  if (resolution === 'keep') return ok()
  if (!isConflictCurrent(doc, conflict))
    return err(new InvalidBlockMoveError('The moved text has changed'))

  resolveMoveConflictRange(doc, conflict)
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
  return () => {
    acknowledgements.unobserve(notify)
    stopObservingRecords()
  }
}
