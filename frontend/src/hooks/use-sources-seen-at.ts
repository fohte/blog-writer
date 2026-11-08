import { Result } from 'neverthrow'
import { useEffect, useState } from 'react'

const storageKey = (articleId: string) =>
  `blog-writer.sources-seen-at.${articleId}`

const ignore = () => undefined

const readSeenAt = Result.fromThrowable((articleId: string) =>
  window.localStorage.getItem(storageKey(articleId)),
)

const rememberSeen = (articleId: string) => {
  Result.fromThrowable(() => {
    window.localStorage.setItem(storageKey(articleId), new Date().toISOString())
  })().match(ignore, ignore)
}

/**
 * Returns when this device last left the sources tab. The value stays fixed
 * while the tab is open so that the marks do not vanish under the reader.
 */
export function useSourcesSeenAt(articleId: string, visible: boolean) {
  const [view, setView] = useState<{
    articleId: string | null
    seenAt: string | null
  }>({ articleId: null, seenAt: null })

  // Read during render: an effect would lose the value to StrictMode's replay,
  // whose cleanup has already overwritten it.
  const openArticleId = visible ? articleId : null
  if (view.articleId !== openArticleId) {
    setView({
      articleId: openArticleId,
      seenAt:
        openArticleId === null
          ? view.seenAt
          : readSeenAt(openArticleId).unwrapOr(new Date().toISOString()),
    })
  }

  useEffect(() => {
    if (!visible) return
    const remember = () => {
      rememberSeen(articleId)
    }
    // Closing the page runs no effect cleanup.
    window.addEventListener('pagehide', remember)
    return () => {
      window.removeEventListener('pagehide', remember)
      remember()
    }
  }, [articleId, visible])

  return view.seenAt
}
