import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import * as Y from 'yjs'

import { ArticleEditorView } from '#components/article-editor-view'
import type { Article, SyncClientApi } from '#lib/sync-client'

type ArticleEditorPageProps = {
  article: Article
  client: SyncClientApi
  onBack: () => void
  sourcesPanel?: ReactNode | undefined
}

export function ArticleEditorPage({
  article,
  client,
  onBack,
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
      doc={doc}
      onBack={onBack}
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
