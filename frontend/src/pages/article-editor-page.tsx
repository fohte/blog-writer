import { useEffect, useState } from 'react'
import * as Y from 'yjs'

import {
  type ArticleEditorIntegrationProps,
  ArticleEditorView,
} from '#components/article-editor-view'
import { fetchOgp } from '#lib/ogp-api'
import type { Article, SyncClientApi, SyncState } from '#lib/sync-client'

type ArticleEditorPageProps = {
  article: Article
  client: SyncClientApi
  onBack: () => void
  onOpenSettings: () => void
  error?: string | undefined
  syncStatus?: SyncState | undefined
  syncedAt?: number | undefined
  requiresAuthentication: boolean
  onLoginAgain: () => void
} & ArticleEditorIntegrationProps

export function ArticleEditorPage({
  article,
  client,
  onBack,
  onOpenSettings,
  error: syncError,
  syncStatus,
  syncedAt,
  requiresAuthentication,
  onLoginAgain,
  bodyAccessory,
  onRequest,
  editorExtensions,
  articleNotice,
  exportScreen,
  onViewChange,
  outlineRenderer,
  premisePanel,
  sourcesPanel,
}: ArticleEditorPageProps) {
  const [doc, setDoc] = useState<Y.Doc>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    setDoc(undefined)
    setError(undefined)
    client.openDocument(article.id).match(
      (openedDoc) => {
        setDoc(openedDoc)
      },
      (openError) => {
        setError(openError.message)
      },
    )
  }, [article.id, client])

  return (
    <ArticleEditorView
      key={article.id}
      articleId={article.id}
      bodyAccessory={bodyAccessory}
      onRequest={onRequest}
      doc={doc}
      editorExtensions={editorExtensions}
      fetchOgp={(url) => fetchOgp(fetch, url)}
      articleNotice={articleNotice}
      exportScreen={exportScreen}
      onBack={onBack}
      onOpenSettings={onOpenSettings}
      onViewChange={onViewChange}
      onLoginAgain={onLoginAgain}
      outlineRenderer={outlineRenderer}
      premisePanel={premisePanel}
      onTitleChange={(title) => {
        client.updateArticleTitle(article.id, title).match(
          () => {
            setError(undefined)
          },
          (updateError) => {
            setError(updateError.message)
          },
        )
      }}
      sourcesPanel={sourcesPanel}
      syncError={syncError}
      syncStatus={syncStatus}
      syncedAt={syncedAt}
      requiresAuthentication={requiresAuthentication}
      status={
        error === undefined
          ? doc === undefined
            ? { kind: 'loading' }
            : undefined
          : { kind: 'error', message: error }
      }
      title={article.title}
    />
  )
}
