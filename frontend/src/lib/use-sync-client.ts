import type { Result } from 'neverthrow'
import { useEffect, useState } from 'react'

import type { Article, SyncClientApi, SyncState } from '#lib/sync-client'
import { createSyncClient } from '#lib/sync-client'
import type { SyncClientError } from '#lib/sync-client-errors'

export function useSyncClient() {
  const [client, setClient] = useState<SyncClientApi>()
  const [articles, setArticles] = useState<Article[]>([])
  const [statuses, setStatuses] = useState<Record<string, SyncState>>({})
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string>()
  const [requiresAuthentication, setRequiresAuthentication] = useState(false)

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
          setRequiresAuthentication(createdClient.requiresAuthentication())
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
    return client?.createArticle().match(
      (article) => article,
      (createError) => {
        setError(createError.message)
        return undefined
      },
    )
  }

  const runArticleAction = (
    action: (syncClient: SyncClientApi) => Result<unknown, SyncClientError>,
  ) => {
    if (!client) return
    action(client).match(
      () => undefined,
      (actionError) => {
        setError(actionError.message)
      },
    )
  }

  return {
    articles,
    statuses,
    client,
    ready,
    error,
    requiresAuthentication,
    canCreate: client !== undefined && ready,
    createArticle,
    duplicateArticle: (id: string) => {
      runArticleAction((syncClient) => syncClient.duplicateArticle(id))
    },
    trashArticle: (id: string) => {
      runArticleAction((syncClient) => syncClient.trashArticle(id))
    },
    restoreArticle: (id: string) => {
      runArticleAction((syncClient) => syncClient.restoreArticle(id))
    },
  }
}
