import { useEffect, useState } from 'react'

import { SyncStatus } from '#components/sync-status'
import type { Article, SyncClientApi, SyncState } from '#lib/sync-client'
import { createSyncClient } from '#lib/sync-client'

type SyncClient = SyncClientApi

export function App() {
  const [client, setClient] = useState<SyncClient>()
  const [articles, setArticles] = useState<Article[]>([])
  const [statuses, setStatuses] = useState<Record<string, SyncState>>({})
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true
    let syncClient: SyncClient | undefined
    let unsubscribe = () => {}

    createSyncClient().match(
      (createdClient) => {
        syncClient = createdClient
        if (!active) return
        setClient(createdClient)
        const refresh = () => {
          const nextArticles = createdClient.listArticles()
          setArticles(nextArticles)
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

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Blog Writer</h1>
        <p className="text-muted-foreground">
          Your articles are saved on this device and sync when connected.
        </p>
      </header>

      <section
        aria-labelledby="articles-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold" id="articles-heading">
            Articles
          </h2>
          <button
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
            disabled={!ready || !client}
            onClick={createArticle}
            type="button"
          >
            New article
          </button>
        </div>

        {error !== undefined ? <p role="alert">{error}</p> : null}

        {articles.length === 0 ? (
          <p className="text-muted-foreground">No articles yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {articles.map(({ id, createdAt }) => (
              <li
                className="flex items-center justify-between gap-4 p-4"
                key={id}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-medium">{id}</span>
                  <time
                    className="text-sm text-muted-foreground"
                    dateTime={new Date(createdAt).toISOString()}
                  >
                    {new Date(createdAt).toLocaleString()}
                  </time>
                </div>
                <SyncStatus state={statuses[id] ?? 'saved'} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
