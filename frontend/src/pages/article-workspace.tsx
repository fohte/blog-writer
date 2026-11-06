import { useState } from 'react'

import type { ArticleEditorIntegrationProps } from '#components/article-editor-view'
import { ArticleListView } from '#components/article-list-view'
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
  editorExtensions,
  headerActions,
  onViewChange,
  outlineAccessory,
  premiseAccessory,
  sourcesPanel,
}: ArticleWorkspaceProps) {
  const [selectedArticleId, setSelectedArticleId] = useState<string>()
  const article = articles.find(({ id }) => id === selectedArticleId)

  if (article && client) {
    return (
      <ArticleEditorPage
        article={article}
        bodyAccessory={bodyAccessory}
        client={client}
        editorExtensions={editorExtensions}
        headerActions={headerActions}
        onBack={() => {
          setSelectedArticleId(undefined)
        }}
        onViewChange={onViewChange}
        outlineAccessory={outlineAccessory}
        premiseAccessory={premiseAccessory}
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
