import { Button } from '@fohte/ui/button'

import { AppHeader } from '#components/app-header'
import { OfflineBanner } from '#components/offline-banner'
import { ReauthenticationPrompt } from '#components/reauthentication-prompt'
import type { Article, SyncState } from '#lib/sync-client'

export interface ArticleListViewProps {
  articles: Article[]
  statuses: Record<string, SyncState>
  error?: string | undefined
  offline: boolean
  requiresAuthentication: boolean
  canCreate: boolean
  onCreateArticle: () => void
  onOpenArticle: (id: string) => void
  onOpenSettings: () => void
  onLoginAgain: () => void
}

const rowStatusLabels: Partial<Record<SyncState, string>> = {
  unsynced: '未同期',
  syncing: '同期中',
}

function formatCreatedDate(createdAt: number) {
  const date = new Date(createdAt)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(date.getFullYear())}-${month}-${day}`
}

export function ArticleListView({
  articles,
  statuses,
  error,
  offline,
  requiresAuthentication,
  canCreate,
  onCreateArticle,
  onOpenArticle,
  onOpenSettings,
  onLoginAgain,
}: ArticleListViewProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader
        onOpenSettings={onOpenSettings}
        status={
          offline ? (
            <span className="font-mono text-xs text-muted-foreground-strong">
              ○ オフライン
            </span>
          ) : undefined
        }
      />
      {offline ? <OfflineBanner /> : null}

      <main className="mx-auto flex w-full max-w-240 flex-col gap-5 px-6 pt-10 pb-20">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex-auto text-2xl font-bold">記事</h1>
          <Button
            disabled={!canCreate}
            onClick={onCreateArticle}
            type="button"
            variant="solid"
          >
            新しい記事
          </Button>
        </div>

        {error !== undefined ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {requiresAuthentication ? (
          <ReauthenticationPrompt onLoginAgain={onLoginAgain} />
        ) : null}

        {articles.length === 0 ? (
          <p className="border border-border px-3 py-4 text-sm">
            記事はまだありません
          </p>
        ) : (
          <>
            <ul className="border-t border-border">
              {articles.map(({ id, title, createdAt, syncFileStatus }) => {
                const statusLabel =
                  syncFileStatus === 'external_changed'
                    ? '外部で変更あり'
                    : rowStatusLabels[statuses[id] ?? 'saved']

                return (
                  <li
                    className="relative flex flex-wrap items-baseline gap-x-4 gap-y-1.5 border-b border-border px-2 py-4 hover:bg-card"
                    key={id}
                  >
                    {/* The pseudo-element stretches the button over the row so the whole row opens the article. */}
                    <button
                      className="grow basis-88 text-left text-base font-bold outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:outline-ring"
                      onClick={() => {
                        onOpenArticle(id)
                      }}
                      type="button"
                    >
                      {title}
                    </button>
                    {statusLabel !== undefined ? (
                      <span className="font-mono text-xs text-muted-foreground-strong">
                        {statusLabel}
                      </span>
                    ) : null}
                    <span className="w-28 text-right font-mono text-xs text-muted-foreground-strong">
                      作成{' '}
                      <time dateTime={new Date(createdAt).toISOString()}>
                        {formatCreatedDate(createdAt)}
                      </time>
                    </span>
                  </li>
                )
              })}
            </ul>
            <p className="text-xs text-muted-foreground-strong">
              {articles.length} 件
            </p>
          </>
        )}
      </main>
    </div>
  )
}
