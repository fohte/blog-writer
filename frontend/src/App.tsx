import { useState } from 'react'

import type { ArticleEditorContext } from '#components/article-editor-view'
import { ArticleExportPopover } from '#components/article-export-popover'
import { LlmSettingsScreen } from '#components/llm-settings-screen'
import { useSyncClient } from '#lib/use-sync-client'
import { ArticleWorkspace } from '#pages/article-workspace'

export function App() {
  const [showSettings, setShowSettings] = useState(false)
  const {
    articles,
    statuses,
    client,
    canCreate,
    error,
    requiresAuthentication,
    createArticle,
  } = useSyncClient()

  if (showSettings) {
    return (
      <LlmSettingsScreen
        onBack={() => {
          setShowSettings(false)
        }}
      />
    )
  }

  return (
    <ArticleWorkspace
      articles={articles}
      client={client}
      error={error}
      headerActions={({ articleId, doc }: ArticleEditorContext) => (
        <ArticleExportPopover
          articleId={articleId}
          articleTitle={
            articles.find((article) => article.id === articleId)?.title ?? ''
          }
          doc={doc}
        />
      )}
      onCreateArticle={createArticle}
      onOpenSettings={() => {
        setShowSettings(true)
      }}
      ready={canCreate}
      requiresAuthentication={requiresAuthentication}
      statuses={statuses}
    />
  )
}
