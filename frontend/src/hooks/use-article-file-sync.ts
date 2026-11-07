import type { ResultAsync } from 'neverthrow'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ArticleEditorContext } from '#components/article-editor-view'
import {
  type ArticleFileSyncResponse,
  type ArticleFileSyncStatus,
  getArticleFileSync,
  overwriteArticleFileSync,
  resumeArticleFileSync,
  setArticleFileSync,
} from '#lib/file-sync-api'
import { normalizeLineEndings } from '#lib/normalize-line-endings'

type UseArticleFileSyncOptions = {
  articleId: string
  initialPath?: string | undefined
  initialStatus: ArticleFileSyncStatus
  replaceBody: ArticleEditorContext['replaceBody']
  /** Loads the file while true, and reloads it when the indexed path or status changes to a state other than the last response. */
  active: boolean
}

type FileSyncRequestOptions = {
  clearError?: boolean | undefined
  clearResponse?: boolean | undefined
  beforeRequest?: (() => Error | undefined) | undefined
}

type FileSyncRequestOutcome =
  | { kind: 'success' }
  | { kind: 'precheck-failed'; error: Error }
  | { kind: 'request-failed'; error: Error }
  | { kind: 'superseded'; error?: Error }

type IndexState = { path: string | undefined; status: ArticleFileSyncStatus }

export function useArticleFileSync({
  articleId,
  initialPath,
  initialStatus,
  replaceBody,
  active,
}: UseArticleFileSyncOptions) {
  const [busy, setBusy] = useState(false)
  const [response, setResponse] = useState<ArticleFileSyncResponse>()
  const [path, setPath] = useState(initialPath ?? '')
  const [error, setError] = useState<string>()
  const loadedIndex = useRef<IndexState | undefined>(undefined)
  const requestSequence = useRef(0)

  const runRequest = useCallback(
    async (
      makeRequest: () => ResultAsync<ArticleFileSyncResponse, Error>,
      options: FileSyncRequestOptions = {},
    ): Promise<FileSyncRequestOutcome> => {
      const requestId = requestSequence.current + 1
      requestSequence.current = requestId
      setBusy(true)
      if (options.clearError !== false) setError(undefined)
      if (options.clearResponse === true) setResponse(undefined)

      const beforeRequestError = options.beforeRequest?.()
      if (beforeRequestError) {
        if (requestId === requestSequence.current) {
          setError(beforeRequestError.message)
          setBusy(false)
        }
        return { kind: 'precheck-failed', error: beforeRequestError }
      }

      const outcome = await makeRequest().match(
        (nextResponse) => {
          if (requestId !== requestSequence.current)
            return { kind: 'superseded' } as const
          setResponse(nextResponse)
          setPath(nextResponse.path ?? '')
          return { kind: 'success' } as const
        },
        (error) => {
          if (requestId !== requestSequence.current)
            return { kind: 'superseded', error } as const
          setError(error.message)
          return { kind: 'request-failed', error } as const
        },
      )
      if (requestId === requestSequence.current) setBusy(false)
      return outcome
    },
    [],
  )

  const loadFileState = useCallback(
    (options: Pick<FileSyncRequestOptions, 'clearError'> = {}) =>
      runRequest(() => getArticleFileSync(fetch, articleId), {
        clearError: options.clearError,
        clearResponse: true,
      }),
    [articleId, runRequest],
  )

  useEffect(() => {
    setPath(initialPath ?? '')
  }, [initialPath])

  useEffect(() => {
    if (!active) {
      loadedIndex.current = undefined
      return
    }
    const previous = loadedIndex.current
    if (
      previous !== undefined &&
      previous.path === initialPath &&
      previous.status === initialStatus
    )
      return
    loadedIndex.current = { path: initialPath, status: initialStatus }
    // The index catches up with this hook's own requests; reloading then would discard the file just read.
    const responseMatchesIndex =
      previous !== undefined &&
      (response?.path ?? undefined) === initialPath &&
      response?.status === initialStatus
    if (!responseMatchesIndex) void loadFileState()
  }, [active, initialPath, initialStatus, loadFileState, response])

  function setSyncPath() {
    return runRequest(() => setArticleFileSync(fetch, articleId, path), {
      clearResponse: true,
    })
  }

  async function importFile() {
    const content = response?.content
    const contentHash = response?.content_hash
    if (content == null || contentHash == null) return false

    const outcome = await runRequest(
      () => resumeArticleFileSync(fetch, articleId, contentHash),
      {
        beforeRequest: () => {
          const replaceResult = replaceBody(normalizeLineEndings(content))
          return replaceResult.isErr() ? replaceResult.error : undefined
        },
      },
    )
    if (
      outcome.kind === 'request-failed' ||
      (outcome.kind === 'superseded' && outcome.error !== undefined)
    ) {
      if (outcome.kind === 'superseded' && outcome.error)
        setError(outcome.error.message)
      await loadFileState({ clearError: false })
    }
    return outcome.kind === 'success'
  }

  function overwrite() {
    return runRequest(() => overwriteArticleFileSync(fetch, articleId))
  }

  return {
    status: response?.status ?? initialStatus,
    path,
    content: response?.content,
    contentHash: response?.content_hash,
    busy,
    error,
    setPath,
    setSyncPath,
    importFile,
    overwrite,
  }
}
