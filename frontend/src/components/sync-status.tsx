import type { SyncState } from '#lib/sync-client'
import { cn } from '#lib/utils'

const stateLabels: Record<SyncState, string> = {
  saved: '保存済み',
  unsynced: '未同期',
  syncing: '同期中',
  synced: '同期済み',
}

const stateStyles: Record<SyncState, string> = {
  saved: 'bg-muted text-muted-foreground',
  unsynced: 'bg-amber-100 text-amber-900',
  syncing: 'bg-blue-100 text-blue-900',
  synced: 'bg-green-100 text-green-900',
}

type SyncStatusProps = {
  state: SyncState
}

export function SyncStatus({ state }: SyncStatusProps) {
  return (
    <span
      aria-live="polite"
      className={cn(
        'inline-flex rounded-full px-2 py-1 text-xs font-medium',
        stateStyles[state],
      )}
      data-state={state}
      role="status"
    >
      {stateLabels[state]}
    </span>
  )
}
