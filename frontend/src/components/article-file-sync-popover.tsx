import type { ResultAsync } from 'neverthrow'
import { useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'

import { readBody } from '#article/body'
import type { ArticleEditorContext } from '#components/article-editor-view'
import { ArticleFileSyncView } from '#components/article-file-sync-view'
import {
  type ArticleFileSyncResponse,
  type ArticleFileSyncStatus,
  getArticleFileSync,
  overwriteArticleFileSync,
  resumeArticleFileSync,
  setArticleFileSync,
} from '#lib/file-sync-api'
import { normalizeLineEndings } from '#lib/normalize-line-endings'

type ArticleFileSyncPopoverProps = {
  articleId: string
  doc: Y.Doc
  initialPath?: string | undefined
  initialStatus: ArticleFileSyncStatus
  replaceBody: ArticleEditorContext['replaceBody']
  defaultOpen?: boolean | undefined
  initialResponse?: ArticleFileSyncResponse | undefined
  initialError?: string | undefined
}

export function ArticleFileSyncPopover({
  articleId,
  doc,
  initialPath,
  initialStatus,
  replaceBody,
  defaultOpen = false,
  initialResponse,
  initialError,
}: ArticleFileSyncPopoverProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [busy, setBusy] = useState(false)
  const [response, setResponse] = useState(initialResponse)
  const [path, setPath] = useState(initialResponse?.path ?? initialPath ?? '')
  const [error, setError] = useState(initialError)
  const [body, setBody] = useState(() => readBody(doc))
  const status = response?.status ?? initialStatus
  const lastIndexState = useRef({ path: initialPath, status: initialStatus })

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

  useEffect(() => {
    setPath(initialPath ?? '')
  }, [initialPath])

  useEffect(() => {
    const previous = lastIndexState.current
    if (previous.path !== initialPath || previous.status !== initialStatus) {
      setResponse((current) =>
        current !== undefined &&
        current.path === initialPath &&
        current.status === initialStatus
          ? current
          : undefined,
      )
      lastIndexState.current = { path: initialPath, status: initialStatus }
    }
  }, [initialPath, initialStatus])

  async function runRequest(
    makeRequest: () => ResultAsync<ArticleFileSyncResponse, Error>,
    options: {
      clearResponse?: boolean
      beforeRequest?: () => Error | undefined
    } = {},
  ) {
    setBusy(true)
    setError(undefined)
    if (options.clearResponse === true) setResponse(undefined)

    const beforeRequestError = options.beforeRequest?.()
    if (beforeRequestError) {
      setError(beforeRequestError.message)
      setBusy(false)
      return
    }

    await makeRequest().match(
      (nextResponse) => {
        setResponse(nextResponse)
        setPath(nextResponse.path ?? '')
      },
      (requestError) => {
        setError(requestError.message)
      },
    )
    setBusy(false)
  }

  function loadFileState() {
    return runRequest(() => getArticleFileSync(fetch, articleId), {
      clearResponse: true,
    })
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) void loadFileState()
  }

  function handleSetPath() {
    return runRequest(() => setArticleFileSync(fetch, articleId, path), {
      clearResponse: true,
    })
  }

  function handleImport() {
    const currentResponse = response
    const content = currentResponse?.content
    const contentHash = currentResponse?.content_hash
    if (content == null || contentHash == null) return

    return runRequest(
      () => resumeArticleFileSync(fetch, articleId, contentHash),
      {
        beforeRequest: () => {
          const replaceResult = replaceBody(normalizeLineEndings(content))
          return replaceResult.isErr() ? replaceResult.error : undefined
        },
      },
    )
  }

  function handleOverwrite() {
    return runRequest(() => overwriteArticleFileSync(fetch, articleId))
  }

  return (
    <ArticleFileSyncView
      body={body}
      content={response?.content}
      contentHash={response?.content_hash}
      error={error}
      onImport={() => {
        void handleImport()
      }}
      onOpenChange={handleOpenChange}
      onOverwrite={() => {
        void handleOverwrite()
      }}
      onPathChange={setPath}
      onSetPath={() => {
        void handleSetPath()
      }}
      open={open}
      path={path}
      status={status}
      busy={busy}
    />
  )
}
