export type OutlineRowBadgesProps = {
  memoCount: number
  moveConflictCount: number
}

export function OutlineRowBadges({
  memoCount,
  moveConflictCount,
}: OutlineRowBadgesProps) {
  return (
    <>
      {moveConflictCount > 0 ? (
        <span
          className="font-mono text-xs text-primary"
          title="移動前の場所に残った文"
        >
          重なり {moveConflictCount}
        </span>
      ) : null}
      {memoCount > 0 ? (
        <span
          className="font-mono text-xs text-muted-foreground"
          title="採用済みのメモ"
        >
          メモ {memoCount}
        </span>
      ) : null}
    </>
  )
}
