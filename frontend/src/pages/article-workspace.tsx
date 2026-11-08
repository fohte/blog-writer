import { useState } from 'react'

import { readBody } from '#article/index'
import type { ArticleEditorIntegrationProps } from '#components/article-editor-view'
import { ArticleListView } from '#components/article-list-view'
import { useOnline } from '#hooks/use-online'
import type { ArticleSortOrder } from '#lib/select-articles'
import type { Article, SyncClientApi, SyncState } from '#lib/sync-client'
import { ArticleEditorPage } from '#pages/article-editor-page'

export type ArticleWorkspaceProps = {
  articles: Article[]
  statuses: Record<string, SyncState>
  client?: SyncClientApi | undefined
  error?: string | undefined
  ready: boolean
  requiresAuthentication: boolean
  onCreateArticle: () => Article | undefined
  onOpenSettings: () => void
} & ArticleEditorIntegrationProps

export function ArticleWorkspace({
  articles,
  statuses,
  client,
  error,
  ready,
  requiresAuthentication,
  onCreateArticle,
  onOpenSettings,
  bodyAccessory,
  onRequest,
  editorExtensions,
  articleNotice,
  exportScreen,
  onViewChange,
  outlineRenderer,
  premisePanel,
  sourcesPanel,
}: ArticleWorkspaceProps) {
  const [selectedArticleId, setSelectedArticleId] = useState<string>()
  // Kept here so the list looks the same after coming back from an article.
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState<ArticleSortOrder>('edited')
  const online = useOnline()
  const article = articles.find(({ id }) => id === selectedArticleId)

  if (article && client) {
    return (
      <ArticleEditorPage
        key={article.id}
        article={article}
        bodyAccessory={bodyAccessory}
        onRequest={onRequest}
        client={client}
        editorExtensions={editorExtensions}
        error={error}
        articleNotice={articleNotice}
        exportScreen={exportScreen}
        onLoginAgain={() => {
          window.location.reload()
        }}
        onBack={() => {
          setSelectedArticleId(undefined)
        }}
        onOpenSettings={onOpenSettings}
        onViewChange={onViewChange}
        outlineRenderer={outlineRenderer}
        premisePanel={premisePanel}
        requiresAuthentication={requiresAuthentication}
        sourcesPanel={sourcesPanel}
        syncStatus={statuses[article.id] ?? client.getStatus(article.id)}
        syncedAt={client.getSyncedAt(article.id)}
      />
    )
  }

  return (
    <ArticleListView
      articles={articles}
      canCreate={ready && client !== undefined}
      error={error}
      onCreateArticle={() => {
        const createdArticle = onCreateArticle()
        if (createdArticle) setSelectedArticleId(createdArticle.id)
      }}
      onLoginAgain={() => {
        window.location.reload()
      }}
      onOpenArticle={setSelectedArticleId}
      onOpenSettings={onOpenSettings}
      onSearchQueryChange={setSearchQuery}
      onSortOrderChange={setSortOrder}
      offline={!online}
      readArticleBody={(id) =>
        client?.openDocument(id).map(readBody).unwrapOr('') ?? ''
      }
      requiresAuthentication={requiresAuthentication}
      searchQuery={searchQuery}
      sortOrder={sortOrder}
      statuses={statuses}
    />
  )
}
