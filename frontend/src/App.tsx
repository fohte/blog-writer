import { Button } from '@fohte/ui/button'
import { List } from '@fohte/ui/list'
import { Panel } from '@fohte/ui/panel'

import { ReauthenticationPrompt } from '#components/reauthentication-prompt'
import { SyncStatus } from '#components/sync-status'
import { useSyncClient } from '#lib/use-sync-client'

export function App() {
  const {
    articles,
    statuses,
    canCreate,
    error,
    requiresAuthentication,
    createArticle,
  } = useSyncClient()

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
          <Button disabled={!canCreate} onClick={createArticle} type="button">
            New article
          </Button>
        </div>

        {error !== undefined ? <p role="alert">{error}</p> : null}

        {requiresAuthentication ? (
          <ReauthenticationPrompt
            onLoginAgain={() => {
              window.location.reload()
            }}
          />
        ) : null}

        {articles.length === 0 ? (
          <p className="text-muted-foreground">No articles yet.</p>
        ) : (
          <Panel className="overflow-hidden rounded-lg" padding="none">
            <List aria-label="Articles">
              {articles.map(({ id, createdAt }) => (
                <div
                  className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0"
                  key={id}
                  role="listitem"
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
                </div>
              ))}
            </List>
          </Panel>
        )}
      </section>
    </main>
  )
}
