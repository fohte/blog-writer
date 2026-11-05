import type * as Y from 'yjs'

import {
  captureDeletedUndoItems,
  type DeletedUndoItem,
  equalRuns,
  remapDeletedUndoItems,
} from '#outline/deleted-undo-items'
import { remapDeleteSet } from '#outline/undo-delete-set'
import {
  captureVisibleSegments,
  type IdMapping,
  type IdSegment,
} from '#outline/undo-id-segments'

export { captureDeletedUndoItems, captureVisibleSegments }
export type { DeletedUndoItem, IdMapping, IdSegment }

function intersectIdSegments(
  oldSegments: IdSegment[],
  newSegments: IdSegment[],
  equalRun: { from: number; to: number; nextFrom: number },
): IdMapping[] {
  const mappings: IdMapping[] = []
  let offset = equalRun.from
  while (offset < equalRun.to) {
    const nextOffset = equalRun.nextFrom + offset - equalRun.from
    const oldSegment = oldSegments.find(
      ({ from, to }) => from <= offset && offset < to,
    )
    const newSegment = newSegments.find(
      ({ from, to }) => from <= nextOffset && nextOffset < to,
    )
    if (!oldSegment || !newSegment) break

    const length = Math.min(
      equalRun.to - offset,
      oldSegment.to - offset,
      newSegment.to - nextOffset,
    )
    mappings.push({
      fromClient: oldSegment.client,
      fromClock: oldSegment.clock + offset - oldSegment.from,
      toClient: newSegment.client,
      toClock: newSegment.clock + nextOffset - newSegment.from,
      length,
    })
    offset += length
  }
  return mappings
}

/** Yjs stores undo targets as item IDs, so moved text needs matching IDs in both history stacks. */
export function remapUndoItemIds(input: {
  doc: Y.Doc
  body: Y.Text
  oldSegments: IdSegment[]
  deletedItems: DeletedUndoItem[]
  undoStack: Y.UndoManager['undoStack']
  redoStack: Y.UndoManager['redoStack']
  newFrom: number
  newTo: number
  previousText: string
  nextText: string
}): IdMapping[] {
  const newSegments = captureVisibleSegments(
    input.body,
    input.newFrom,
    input.newTo,
  )
  const mappings = equalRuns(input.previousText, input.nextText).flatMap(
    (run) => intersectIdSegments(input.oldSegments, newSegments, run),
  )

  const deletedMappings = remapDeletedUndoItems({
    doc: input.doc,
    body: input.body,
    deletedItems: input.deletedItems,
    newFrom: input.newFrom,
    previousText: input.previousText,
    nextText: input.nextText,
  })

  for (const stackItem of [...input.undoStack, ...input.redoStack]) {
    remapDeleteSet(stackItem, 'insertions', mappings)
  }
  return [...mappings, ...deletedMappings]
}
