import { useEffect, useState } from 'react'
import type * as Y from 'yjs'

import { readBody } from '#article/body'
import type { ArticleEditorContext } from '#components/article-editor-view'
import { ArticleFileSyncView } from '#components/article-file-sync-view'
import { useArticleFileSync } from '#hooks/use-article-file-sync'
import type { ArticleFileSyncStatus } from '#lib/file-sync-api'

type ArticleFileSyncSectionProps = {
  articleId: string
  doc: Y.Doc
  initialPath?: string | undefined
  initialStatus: ArticleFileSyncStatus
  replaceBody: ArticleEditorContext['replaceBody']
}

export function ArticleFileSyncSection({
  articleId,
  doc,
  initialPath,
  initialStatus,
  replaceBody,
}: ArticleFileSyncSectionProps) {
  const sync = useArticleFileSync({
    articleId,
    initialPath,
    initialStatus,
    replaceBody,
    active: true,
  })
  const [body, setBody] = useState(() => readBody(doc))

  useEffect(() => {
    const articleBody = doc.getText('body')
    const updateBody = () => {
      setBody(articleBody.toJSON())
    }
    articleBody.observe(updateBody)
    updateBody()
    return () => {
      articleBody.unobserve(updateBody)
    }
  }, [doc])

  return (
    <ArticleFileSyncView
      body={body}
      busy={sync.busy}
      content={sync.content}
      contentHash={sync.contentHash}
      error={sync.error}
      onImport={() => {
        void sync.importFile()
      }}
      onOverwrite={() => {
        void sync.overwrite()
      }}
      onPathChange={sync.setPath}
      onSetPath={() => {
        void sync.setSyncPath()
      }}
      path={sync.path}
      status={sync.status}
    />
  )
}
