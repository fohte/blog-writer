import { Kbd } from '@fohte/ui/kbd'

import type { LlmRoute } from '#lib/llm-settings'
import type { SyncState } from '#lib/sync-client'

const serverStateLabels: Record<SyncState, string> = {
  saved: '',
  unsynced: ' · 未同期',
  syncing: ' · 同期中',
  synced: ' · 同期済み',
}

const llmRouteLabels: Record<LlmRoute, string> = {
  server: 'LLM サーバー',
  local: 'LLM ローカル',
}

const isApple = /Mac|iPhone|iPad/u.test(navigator.userAgent)
const modLabel = isApple ? '⌘' : 'Ctrl+'
const altLabel = isApple ? '⌥' : 'Alt+'

const formatTime = (time: number) =>
  new Date(time).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

type EditorStatusBarProps = {
  syncStatus?: SyncState | undefined
  syncedAt?: number | undefined
  llmRoute?: LlmRoute | undefined
  characterCount?: number | undefined
}

export function EditorStatusBar({
  syncStatus,
  syncedAt,
  llmRoute,
  characterCount,
}: EditorStatusBarProps) {
  return (
    <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-4 py-1.5 font-mono text-2xs text-muted-foreground-strong">
      <span>
        端末に保存済み
        {syncStatus === undefined ? '' : serverStateLabels[syncStatus]}
        {syncStatus === 'synced' && syncedAt !== undefined
          ? ` ${formatTime(syncedAt)}`
          : ''}
      </span>
      {llmRoute === undefined ? null : <span>{llmRouteLabels[llmRoute]}</span>}
      {characterCount === undefined ? null : (
        <span>{characterCount.toLocaleString('ja-JP')} 字</span>
      )}
      <span className="flex-1" />
      <span>
        <Kbd>{modLabel}K</Kbd> 依頼
      </span>
      <span>
        <Kbd>Tab</Kbd> 提案を選ぶ・採用
      </span>
      <span>
        <Kbd>{altLabel}↑</Kbd>
        <Kbd>{altLabel}↓</Kbd> 移動
      </span>
    </footer>
  )
}
