import { useEffect, useState } from 'react'

import type { ArticleEditorContext } from '#components/article-editor-view'
import { ArticleFileSyncBannerView } from '#components/article-file-sync-banner-view'
import { useArticleFileSync } from '#hooks/use-article-file-sync'
import type { ArticleFileSyncStatus } from '#lib/file-sync-api'

type ArticleFileSyncBannerProps = {
  context: ArticleEditorContext
  initialPath?: string | undefined
  initialStatus: ArticleFileSyncStatus
}

export function ArticleFileSyncBanner({
  context,
  initialPath,
  initialStatus,
}: ArticleFileSyncBannerProps) {
  const { articleId, doc, history, view, replaceBody, openExport } = context
  const sync = useArticleFileSync({
    articleId,
    initialPath,
    initialStatus,
    replaceBody,
    active: initialStatus === 'external_changed',
  })
  const [imported, setImported] = useState(false)

  useEffect(() => {
    if (!imported) return
    // The undo offer only applies while the imported text is the latest change.
    const body = doc.getText('body')
    const dismiss = () => {
      setImported(false)
    }
    body.observe(dismiss)
    return () => {
      body.unobserve(dismiss)
    }
  }, [doc, imported])

  const state = imported
    ? 'imported'
    : sync.status !== 'external_changed'
      ? undefined
      : sync.content === null
        ? 'missing'
        : 'external_changed'
  if (state === undefined) return null

  return (
    <ArticleFileSyncBannerView
      busy={sync.busy}
      canImport={sync.contentHash != null}
      error={sync.error}
      onChangePath={() => {
        openExport('sync')
      }}
      onImport={() => {
        void sync.importFile().then((succeeded) => {
          setImported(succeeded)
        })
      }}
      onOverwrite={() => {
        void sync.overwrite()
      }}
      onShowDiff={() => {
        openExport('sync')
      }}
      onUndo={() => {
        if (view)
          history.undo(view).match(
            () => {},
            () => {},
          )
        setImported(false)
      }}
      path={sync.path}
      state={state}
    />
  )
}
