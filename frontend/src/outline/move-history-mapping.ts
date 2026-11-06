import type { ChangeSet } from '@codemirror/state'

import type { MemoAdoptionSnapshot } from '#article/memos'

export function mapMemoAdoptions(
  snapshots: readonly MemoAdoptionSnapshot[],
  changes: ChangeSet,
): MemoAdoptionSnapshot[] {
  return snapshots.map((snapshot) => {
    let markerIndex = changes.mapPos(snapshot.markerIndex, -1)
    let markerOffset = snapshot.markerOffset
    changes.iterChangedRanges((fromA, toA, fromB) => {
      if (fromA <= snapshot.markerIndex && snapshot.markerIndex < toA) {
        markerIndex = fromB
        markerOffset ??= snapshot.markerIndex - fromA
      }
    })
    return {
      ...snapshot,
      markerIndex,
      ...(markerOffset === undefined ? {} : { markerOffset }),
    }
  })
}
