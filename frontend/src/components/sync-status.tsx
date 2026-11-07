import type { SyncState } from '#lib/sync-client'

const stateLabels: Record<SyncState, { symbol: string; label: string }> = {
  saved: { symbol: '✓', label: '端末に保存済み' },
  unsynced: { symbol: '○', label: '未同期' },
  syncing: { symbol: '◐', label: '同期中' },
  synced: { symbol: '●', label: '同期済み' },
}

type SyncStatusProps = {
  state: SyncState
}

export function SyncStatus({ state }: SyncStatusProps) {
  const { symbol, label } = stateLabels[state]

  return (
    <span
      aria-live="polite"
      className="font-mono text-xs text-muted-foreground-strong"
      data-state={state}
      role="status"
    >
      <span aria-hidden="true">{symbol} </span>
      {label}
    </span>
  )
}
