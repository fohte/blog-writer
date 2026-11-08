import { useEffect, useMemo, useState } from 'react'
import type * as Y from 'yjs'

import { getBody } from '#article/index'
import type { MoveConflict } from '#article/move-conflict-detection'
import { countMoveConflictsByHeading } from '#article/move-conflict-headings'
import { getMoveConflicts, observeMoveConflicts } from '#article/move-conflicts'
import type { Heading } from '#article/types'

export function useMoveConflictCounts(
  doc: Y.Doc,
  headings: readonly Heading[],
): Readonly<Record<number, number>> {
  const [conflicts, setConflicts] = useState<MoveConflict[]>([])

  useEffect(() => {
    const body = getBody(doc)
    let active = true
    let scheduled = false
    const read = () => {
      scheduled = false
      if (active) setConflicts(getMoveConflicts(doc))
    }
    // Reading conflicts can write to the document, which is not allowed while an observer runs.
    const schedule = () => {
      if (scheduled) return
      scheduled = true
      queueMicrotask(read)
    }
    const stopObserving = observeMoveConflicts(doc, schedule)
    body.observe(schedule)
    read()
    return () => {
      active = false
      body.unobserve(schedule)
      stopObserving()
    }
  }, [doc])

  return useMemo(
    () => countMoveConflictsByHeading(headings, conflicts),
    [conflicts, headings],
  )
}
