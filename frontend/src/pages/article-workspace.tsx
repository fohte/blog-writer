import type { ReactNode } from 'react'
import { useState } from 'react'

import { ArticleListView } from '#components/article-list-view'
import type { Article, SyncClientApi, SyncState } from '#lib/sync-client'
import { ArticleEditorPage } from '#pages/article-editor-page'

export interface ArticleWorkspaceProps {
  articles: Article[]
  statuses: Record<string, SyncState>
  client?: SyncClientApi | undefined
  error?: string | undefined
  ready: boolean
  requiresAuthentication: boolean
  onCreateArticle: () => Article | undefined
  onOpenSettings: () => void
  sourcesPanel?: ReactNode | undefined
}

export function ArticleWorkspace({
  articles,
  statuses,
  client,
  error,
  ready,
  requiresAuthentication,
  onCreateArticle,
  onOpenSettings,
  sourcesPanel,
}: ArticleWorkspaceProps) {
  const [selectedArticleId, setSelectedArticleId] = useState<string>()
  const article = articles.find(({ id }) => id === selectedArticleId)

  if (article && client) {
    return (
      <ArticleEditorPage
        article={article}
        client={client}
        onBack={() => {
          setSelectedArticleId(undefined)
        }}
        sourcesPanel={sourcesPanel}
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
      requiresAuthentication={requiresAuthentication}
      statuses={statuses}
    />
  )
}
