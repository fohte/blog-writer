import type { ChangeSet } from '@codemirror/state'

import type { MemoAdoptionSnapshot } from '#article/memos'

export function mapMemoAdoptions(
  snapshots: readonly MemoAdoptionSnapshot[],
  changes: ChangeSet,
): MemoAdoptionSnapshot[] {
  return snapshots.map((snapshot) => ({
    ...snapshot,
    markerIndex: changes.mapPos(snapshot.markerIndex, -1),
  }))
}
