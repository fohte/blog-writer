import { Button } from '@fohte/ui/button'
import { Input } from '@fohte/ui/input'
import { Kbd } from '@fohte/ui/kbd'
import { SegmentedControl } from '@fohte/ui/segmented-control'
import { SearchIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { formatLocalDate } from '#article/format-local-date'
import { AppHeader } from '#components/app-header'
import { ArticleRowMenu } from '#components/article-row-menu'
import { ArticleTrashDialog } from '#components/article-trash-dialog'
import { OfflineBanner } from '#components/offline-banner'
import { ReauthenticationPrompt } from '#components/reauthentication-prompt'
import { type ArticleSortOrder, selectArticles } from '#lib/select-articles'
import type {
  Article,
  ArticleSummary,
  SyncState,
  TrashedArticle,
} from '#lib/sync-client'

export interface ArticleListViewProps {
  articles: Article[]
  statuses: Record<string, SyncState>
  searchQuery: string
  sortOrder: ArticleSortOrder
  error?: string | undefined
  offline: boolean
  requiresAuthentication: boolean
  canCreate: boolean
  readArticleBody: (id: string) => string
  readArticleSummary: (id: string) => ArticleSummary | undefined
  onSearchQueryChange: (query: string) => void
  onSortOrderChange: (sortOrder: ArticleSortOrder) => void
  onCreateArticle: () => void
  onOpenArticle: (id: string) => void
  onDuplicateArticle: (id: string) => void
  onTrashArticle: (id: string) => void
  onRestoreArticle: (id: string) => void
  onOpenSettings: () => void
  onLoginAgain: () => void
}

const rowStatusLabels: Partial<Record<SyncState, string>> = {
  unsynced: '未同期',
  syncing: '同期中',
}

const sortOptions: Array<{ value: ArticleSortOrder; label: string }> = [
  { value: 'edited', label: '最近編集した順' },
  { value: 'created', label: '作成した順' },
]

function formatArticleSummary({
  unorganizedMemoCount,
  bodyIsEmpty,
}: ArticleSummary) {
  return [
    ...(unorganizedMemoCount > 0
      ? [`未整理メモ ${String(unorganizedMemoCount)}`]
      : []),
    ...(bodyIsEmpty ? ['本文なし'] : []),
  ].join(' · ')
}

export function ArticleListView({
  articles,
  statuses,
  searchQuery,
  sortOrder,
  error,
  offline,
  requiresAuthentication,
  canCreate,
  readArticleBody,
  readArticleSummary,
  onSearchQueryChange,
  onSortOrderChange,
  onCreateArticle,
  onOpenArticle,
  onDuplicateArticle,
  onTrashArticle,
  onRestoreArticle,
  onOpenSettings,
  onLoginAgain,
}: ArticleListViewProps) {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const activeArticles = articles.filter(
    ({ trashedAt }) => trashedAt === undefined,
  )
  const trashedArticles = articles.filter(
    (article): article is TrashedArticle => article.trashedAt !== undefined,
  )
  const visibleArticles = selectArticles(
    activeArticles,
    searchQuery,
    sortOrder,
    readArticleBody,
  )
  const syncedCount = activeArticles.filter(
    ({ id }) => statuses[id] === 'synced',
  ).length
  // A browser that is offline still reports `syncing` until its connection attempt fails.
  const syncInProgress =
    !offline && activeArticles.some(({ id }) => statuses[id] === 'syncing')

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey)
        return
      if (
        event.target instanceof Element &&
        event.target.matches('input, textarea, select, [contenteditable]')
      )
        return
      event.preventDefault()
      searchInputRef.current?.focus()
    }
    window.addEventListener('keydown', focusSearch)
    return () => {
      window.removeEventListener('keydown', focusSearch)
    }
  }, [])

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
          {activeArticles.length > 0 ? (
            <div className="relative min-w-0 grow basis-70 md:max-w-90">
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground-strong"
              />
              <Input
                aria-label="タイトルと本文を検索"
                className="ps-8 md:pe-8"
                onChange={(event) => {
                  onSearchQueryChange(event.target.value)
                }}
                placeholder="タイトルと本文を検索"
                ref={searchInputRef}
                value={searchQuery}
              />
              <Kbd
                aria-hidden="true"
                className="absolute top-1/2 right-2.5 -translate-y-1/2 max-md:hidden"
              >
                /
              </Kbd>
            </div>
          ) : null}
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

        {syncInProgress ? (
          <p className="border border-border px-2.5 py-1.5 font-mono text-xs">
            ◐ 全記事を同期中 {syncedCount} / {activeArticles.length}{' '}
            <span className="text-muted-foreground-strong">
              · 開ける記事から使えます
            </span>
          </p>
        ) : null}

        {activeArticles.length === 0 ? (
          <p className="border border-border px-3 py-4 text-sm">
            記事はまだありません
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground-strong">
              <span>並び</span>
              <SegmentedControl
                aria-label="記事の並び"
                onValueChange={onSortOrderChange}
                options={sortOptions}
                value={sortOrder}
              />
            </div>
            {visibleArticles.length === 0 ? (
              <p className="border border-border px-3 py-4 text-sm">
                一致する記事はありません
              </p>
            ) : (
              <ul className="border-t border-border">
                {visibleArticles.map(
                  ({ id, title, createdAt, syncFileStatus }) => {
                    const statusLabel =
                      syncFileStatus === 'external_changed'
                        ? '外部で変更あり'
                        : rowStatusLabels[statuses[id] ?? 'saved']
                    const summary = readArticleSummary(id)

                    return (
                      <li
                        className="relative flex flex-wrap items-baseline gap-x-4 gap-y-1.5 border-b border-border px-2 py-4 hover:bg-card"
                        key={id}
                      >
                        {/* The pseudo-element stretches the button over the row so the whole row opens the article. */}
                        <button
                          className="min-w-0 grow basis-88 text-left text-base font-bold wrap-anywhere outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:outline-ring"
                          onClick={() => {
                            onOpenArticle(id)
                          }}
                          type="button"
                        >
                          {title}
                        </button>
                        <span className="font-mono text-xs text-muted-foreground-strong empty:hidden">
                          {summary !== undefined
                            ? formatArticleSummary(summary)
                            : null}
                        </span>
                        {statusLabel !== undefined ? (
                          <span className="font-mono text-xs text-muted-foreground-strong">
                            {statusLabel}
                          </span>
                        ) : null}
                        <span className="w-28 text-right font-mono text-xs text-muted-foreground-strong">
                          作成{' '}
                          <time dateTime={new Date(createdAt).toISOString()}>
                            {formatLocalDate(createdAt)}
                          </time>
                        </span>
                        <ArticleRowMenu
                          onDuplicate={() => {
                            onDuplicateArticle(id)
                          }}
                          onTrash={() => {
                            onTrashArticle(id)
                          }}
                        />
                      </li>
                    )
                  },
                )}
              </ul>
            )}
          </>
        )}

        <div className="flex gap-4 text-xs text-muted-foreground-strong empty:hidden">
          {activeArticles.length > 0 ? (
            <span>{visibleArticles.length} 件</span>
          ) : null}
          {trashedArticles.length > 0 ? (
            <button
              className="underline underline-offset-3"
              onClick={() => {
                setTrashOpen(true)
              }}
              type="button"
            >
              ゴミ箱 ({trashedArticles.length})
            </button>
          ) : null}
        </div>
        <ArticleTrashDialog
          articles={trashedArticles}
          onOpenChange={setTrashOpen}
          onRestore={onRestoreArticle}
          open={trashOpen}
        />
      </main>
    </div>
  )
}
