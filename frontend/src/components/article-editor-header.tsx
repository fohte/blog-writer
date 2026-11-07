import { Button } from '@fohte/ui/button'

import { AppHeader } from '#components/app-header'
import { MobileEditorHeader } from '#components/mobile-editor-header'
import { MobilePanelHeader } from '#components/mobile-panel-header'
import { SyncStatus } from '#components/sync-status'
import type { SyncState } from '#lib/sync-client'

type ArticleEditorHeaderProps = {
  mobile: boolean
  /** Replaces the article header on mobile while a panel covers the article. */
  mobilePanel?:
    { title: string; closeLabel: string; onClose: () => void } | undefined
  title: string
  syncStatus?: SyncState | undefined
  onBack: () => void
  onOpenSettings: () => void
  onShowPremise: () => void
  onShowSources?: (() => void) | undefined
  onExport?: (() => void) | undefined
}

export function ArticleEditorHeader({
  mobile,
  mobilePanel,
  title,
  syncStatus,
  onBack,
  onOpenSettings,
  onShowPremise,
  onShowSources,
  onExport,
}: ArticleEditorHeaderProps) {
  const status = syncStatus ? <SyncStatus state={syncStatus} /> : undefined

  if (mobile && mobilePanel) return <MobilePanelHeader {...mobilePanel} />
  if (mobile)
    return (
      <MobileEditorHeader
        menuItems={[
          { label: '前提', onSelect: onShowPremise },
          ...(onShowSources
            ? [{ label: '資料', onSelect: onShowSources }]
            : []),
          ...(onExport ? [{ label: '書き出し', onSelect: onExport }] : []),
          { label: '設定', onSelect: onOpenSettings },
        ]}
        onBack={onBack}
        status={status}
        title={title}
      />
    )
  return (
    <AppHeader
      actions={
        onExport ? (
          <Button
            onClick={() => {
              onExport()
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            書き出し
          </Button>
        ) : null
      }
      articleTitle={title}
      onHome={onBack}
      onOpenSettings={onOpenSettings}
      status={status}
    />
  )
}
