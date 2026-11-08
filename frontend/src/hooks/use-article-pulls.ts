import { useCallback, useEffect, useRef, useState } from 'react'

import {
  type ArticlePull,
  type ExportDestination,
  getArticlePulls,
} from '#lib/article-export-api'

export type ArticlePulls = {
  read: (
    destinationId: string | undefined,
    articleId: string,
  ) => ArticlePull | undefined
  reload: () => void
}

export function useArticlePulls(
  destinations: ExportDestination[] | undefined,
): ArticlePulls {
  const [pulls, setPulls] = useState<Record<string, ArticlePull[]>>({})
  const latestReload = useRef(0)

  const reload = useCallback(() => {
    latestReload.current += 1
    const currentReload = latestReload.current
    for (const { id } of destinations ?? []) {
      void getArticlePulls(fetch, id).match(
        ({ pulls: destinationPulls }) => {
          // A read from before a publish must not overwrite the one after it.
          if (latestReload.current !== currentReload) return
          setPulls((previous) => ({ ...previous, [id]: destinationPulls }))
        },
        // Publishing works without the status, so a failed read only leaves it out.
        () => {},
      )
    }
  }, [destinations])

  useEffect(reload, [reload])

  return {
    read: (destinationId, articleId) =>
      destinationId === undefined
        ? undefined
        : pulls[destinationId]?.find(
            ({ article_id }) => article_id === articleId,
          ),
    reload,
  }
}
