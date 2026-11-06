import { Button } from '@fohte/ui/button'
import { List, ListItem } from '@fohte/ui/list'
import { Panel } from '@fohte/ui/panel'

import { ReauthenticationPrompt } from '#components/reauthentication-prompt'
import { SyncStatus } from '#components/sync-status'
import type { Article, SyncState } from '#lib/sync-client'

export interface ArticleListViewProps {
  articles: Article[]
  statuses: Record<string, SyncState>
  error?: string | undefined
  requiresAuthentication: boolean
  canCreate: boolean
  onCreateArticle: () => void
  onOpenArticle: (id: string) => void
  onOpenSettings: () => void
  onLoginAgain: () => void
}

export function ArticleListView({
  articles,
  statuses,
  error,
  requiresAuthentication,
  canCreate,
  onCreateArticle,
  onOpenArticle,
  onOpenSettings,
  onLoginAgain,
}: ArticleListViewProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold">Blog Writer</h1>
          <p className="text-muted-foreground">
            Your articles are saved on this device and sync when connected.
          </p>
        </div>
        <Button onClick={onOpenSettings} type="button" variant="outline">
          Settings
        </Button>
      </header>

      <section
        aria-labelledby="articles-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold" id="articles-heading">
            Articles
          </h2>
          <Button disabled={!canCreate} onClick={onCreateArticle} type="button">
            New article
          </Button>
        </div>

        {error !== undefined ? <p role="alert">{error}</p> : null}

        {requiresAuthentication ? (
          <ReauthenticationPrompt onLoginAgain={onLoginAgain} />
        ) : null}

        {articles.length === 0 ? (
          <p className="text-muted-foreground">No articles yet.</p>
        ) : (
          <Panel className="overflow-hidden rounded-lg" padding="none">
            <List aria-label="Articles">
              {articles.map(({ id, title, createdAt }) => (
                <div
                  className="border-b border-border last:border-b-0"
                  key={id}
                >
                  <ListItem
                    aria-label={title}
                    onSelect={() => {
                      onOpenArticle(id)
                    }}
                  >
                    <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                      <span className="truncate font-medium">{title}</span>
                      <time
                        className="text-sm text-muted-foreground"
                        dateTime={new Date(createdAt).toISOString()}
                      >
                        {new Date(createdAt).toLocaleString()}
                      </time>
                    </div>
                    <SyncStatus state={statuses[id] ?? 'saved'} />
                  </ListItem>
                </div>
              ))}
            </List>
          </Panel>
        )}
      </section>
    </main>
  )
}
