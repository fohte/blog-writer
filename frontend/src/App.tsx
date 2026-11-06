import { useEffect, useState } from 'react'

import type { ArticleEditorContext } from '#components/article-editor-view'
import { ArticleExportPopover } from '#components/article-export-popover'
import { ArticleFileSyncPopover } from '#components/article-file-sync-popover'
import { LlmSettingsScreen } from '#components/llm-settings-screen'
import {
  type FileSyncConfiguration,
  getFileSyncConfiguration,
} from '#lib/file-sync-api'
import { useSyncClient } from '#lib/use-sync-client'
import { ArticleWorkspace } from '#pages/article-workspace'

export function App() {
  const [showSettings, setShowSettings] = useState(false)
  const [fileSyncConfiguration, setFileSyncConfiguration] =
    useState<FileSyncConfiguration>()
  const {
    articles,
    statuses,
    client,
    canCreate,
    error,
    requiresAuthentication,
    createArticle,
  } = useSyncClient()

  useEffect(() => {
    let active = true
    void getFileSyncConfiguration(fetch).match(
      (configuration) => {
        if (active) {
          setFileSyncConfiguration(configuration)
        }
      },
      () => {},
    )
    return () => {
      active = false
    }
  }, [])

  if (showSettings) {
    return (
      <LlmSettingsScreen
        fileSyncDirectory={
          fileSyncConfiguration?.enabled === true
            ? (fileSyncConfiguration.directory ?? '')
            : undefined
        }
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
      headerActions={(context: ArticleEditorContext) => {
        const article = articles.find(({ id }) => id === context.articleId)
        return (
          <>
            <ArticleExportPopover
              articleId={context.articleId}
              articleTitle={article?.title ?? ''}
              doc={context.doc}
            />
            {fileSyncConfiguration?.enabled === true ? (
              <ArticleFileSyncPopover
                articleId={context.articleId}
                doc={context.doc}
                initialPath={article?.syncFilePath}
                initialStatus={article?.syncFileStatus ?? 'unset'}
                replaceBody={context.replaceBody}
              />
            ) : null}
          </>
        )
      }}
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
