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

function normalizeLineEndings(value: string) {
  return value.replaceAll('\r\n', '\n')
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

  async function loadFileState() {
    setBusy(true)
    setError(undefined)
    setResponse(undefined)
    await getArticleFileSync(fetch, articleId).match(
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

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) void loadFileState()
  }

  async function handleSetPath() {
    setBusy(true)
    setError(undefined)
    setResponse(undefined)
    await setArticleFileSync(fetch, articleId, path).match(
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

  async function handleImport() {
    const currentResponse = response
    if (
      currentResponse?.content == null ||
      currentResponse.content_hash == null
    )
      return

    setBusy(true)
    setError(undefined)
    const replacement = normalizeLineEndings(currentResponse.content)
    const replaceResult = replaceBody(replacement)
    if (replaceResult.isErr()) {
      setError(replaceResult.error.message)
      setBusy(false)
      return
    }

    await resumeArticleFileSync(
      fetch,
      articleId,
      currentResponse.content_hash,
    ).match(
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

  async function handleOverwrite() {
    setBusy(true)
    setError(undefined)
    await overwriteArticleFileSync(fetch, articleId).match(
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
