import { useEffect, useState } from 'react'
import * as Y from 'yjs'

import {
  type ArticleEditorIntegrationProps,
  ArticleEditorView,
} from '#components/article-editor-view'
import type { Article, SyncClientApi } from '#lib/sync-client'

type ArticleEditorPageProps = {
  article: Article
  client: SyncClientApi
  onBack: () => void
} & ArticleEditorIntegrationProps

export function ArticleEditorPage({
  article,
  client,
  onBack,
  bodyAccessory,
  editorExtensions,
  headerActions,
  onViewChange,
  outlineAccessory,
  premiseAccessory,
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
      bodyAccessory={bodyAccessory}
      doc={doc}
      editorExtensions={editorExtensions}
      headerActions={headerActions}
      onBack={onBack}
      onViewChange={onViewChange}
      outlineAccessory={outlineAccessory}
      premiseAccessory={premiseAccessory}
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
