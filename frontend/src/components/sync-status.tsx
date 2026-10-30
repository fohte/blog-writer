import { Chip } from '@fohte/ui/chip'

import type { SyncState } from '#lib/sync-client'

const stateLabels: Record<SyncState, string> = {
  saved: '保存済み',
  unsynced: '未同期',
  syncing: '同期中',
  synced: '同期済み',
}

const stateTones: Record<SyncState, 'faint' | 'muted' | 'strong'> = {
  saved: 'muted',
  unsynced: 'strong',
  syncing: 'muted',
  synced: 'faint',
}

type SyncStatusProps = {
  state: SyncState
}

export function SyncStatus({ state }: SyncStatusProps) {
  return (
    <Chip
      aria-live="polite"
      data-state={state}
      role="status"
      size="md"
      tone={stateTones[state]}
    >
      {stateLabels[state]}
    </Chip>
  )
}
