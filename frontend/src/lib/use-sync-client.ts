import { useEffect, useState } from 'react'

import type { Article, SyncClientApi, SyncState } from '#lib/sync-client'
import { createSyncClient } from '#lib/sync-client'

export function useSyncClient() {
  const [client, setClient] = useState<SyncClientApi>()
  const [articles, setArticles] = useState<Article[]>([])
  const [statuses, setStatuses] = useState<Record<string, SyncState>>({})
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true
    let syncClient: SyncClientApi | undefined
    let unsubscribe = () => {}

    createSyncClient().match(
      (createdClient) => {
        syncClient = createdClient
        if (!active) return
        setClient(createdClient)
        const refresh = () => {
          const nextArticles = createdClient.listArticles()
          setArticles(nextArticles)
          setError(createdClient.getError()?.message)
          setStatuses(
            Object.fromEntries(
              nextArticles.map(({ id }) => [
                id,
                createdClient.getStatus(id) ?? 'saved',
              ]),
            ),
          )
        }
        unsubscribe = createdClient.subscribe(refresh)
        refresh()
        void createdClient.start().match(
          () => {
            if (!active) return
            refresh()
            setReady(true)
          },
          (startError) => {
            if (!active) return
            setError(startError.message)
            setReady(true)
          },
        )
      },
      (createError) => {
        setError(createError.message)
        setReady(true)
      },
    )

    return () => {
      active = false
      unsubscribe()
      syncClient?.destroy()
    }
  }, [])

  const createArticle = () => {
    client?.createArticle().match(
      () => {},
      (createError) => {
        setError(createError.message)
      },
    )
  }

  return {
    articles,
    statuses,
    ready,
    error,
    canCreate: client !== undefined && ready,
    createArticle,
  }
}
