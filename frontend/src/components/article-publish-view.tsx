import { Button } from '@fohte/ui/button'
import { Input } from '@fohte/ui/input'
import { Panel } from '@fohte/ui/panel'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@fohte/ui/select'
import { Textarea } from '@fohte/ui/textarea'

import { isValidArticleSlug } from '#article/export'
import { TextDiffView } from '#components/text-diff-view'
import type { ExportDestination } from '#lib/article-export-api'

export type ArticlePublishViewProps = {
  destinations?: ExportDestination[] | undefined
  selectedDestinationId?: string | undefined
  slug: string
  frontmatter: string
  diff?: { original: string; modified: string } | undefined
  busy?: boolean | undefined
  canPublish?: boolean | undefined
  error?: string | undefined
  publishedUrl?: string | undefined
  onDestinationChange: (destinationId: string) => void
  onSlugChange: (slug: string) => void
  onFrontmatterChange: (frontmatter: string) => void
  onShowDiff: () => void
  onPublish: () => void
}

export function ArticlePublishView({
  destinations = [],
  selectedDestinationId,
  slug,
  frontmatter,
  diff,
  busy = false,
  canPublish = false,
  error,
  publishedUrl,
  onDestinationChange,
  onSlugChange,
  onFrontmatterChange,
  onShowDiff,
  onPublish,
}: ArticlePublishViewProps) {
  if (destinations.length === 0) {
    if (error === undefined) return null
    return (
      <section aria-label="PR を作成" className="flex flex-col gap-3">
        <h2 className="font-semibold">PR を作成</h2>
        <Panel
          aria-live="assertive"
          className="rounded-md border-destructive/40 bg-destructive/10 text-sm text-destructive"
          padding="sm"
          role="alert"
        >
          {error}
        </Panel>
      </section>
    )
  }

  return (
    <section aria-label="PR を作成" className="flex flex-col gap-3">
      <h2 className="font-semibold">PR を作成</h2>
      <label className="flex flex-col gap-1 text-sm">
        公開先
        <Select
          disabled={busy}
          onValueChange={(value) => {
            if (value !== null) onDestinationChange(value)
          }}
          value={selectedDestinationId ?? null}
        >
          <SelectTrigger aria-label="公開先">
            <SelectValue placeholder="公開先を選択" />
          </SelectTrigger>
          <SelectContent>
            {destinations.map(({ id }) => (
              <SelectItem key={id} value={id}>
                {id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <Input
        aria-label="公開 slug"
        autoComplete="off"
        disabled={busy}
        onChange={(event) => {
          onSlugChange(event.currentTarget.value)
        }}
        placeholder="example-post"
        value={slug}
      />
      <Textarea
        aria-label="frontmatter"
        disabled={busy}
        onChange={(event) => {
          onFrontmatterChange(event.currentTarget.value)
        }}
        rows={5}
        value={frontmatter}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={
            busy || selectedDestinationId == null || !isValidArticleSlug(slug)
          }
          onClick={onShowDiff}
          type="button"
          variant="outline"
        >
          差分を見る
        </Button>
        {diff !== undefined ? (
          <Button
            disabled={busy || !canPublish}
            onClick={onPublish}
            type="button"
          >
            PR を作成
          </Button>
        ) : null}
      </div>
      {diff !== undefined ? (
        <TextDiffView
          modified={diff.modified}
          modifiedLabel="公開する内容"
          original={diff.original}
          originalLabel="公開先の内容"
        />
      ) : null}
      {busy ? (
        <p aria-live="polite" className="text-muted-foreground" role="status">
          公開先を確認しています…
        </p>
      ) : null}
      {publishedUrl !== undefined ? (
        <Panel className="rounded-md p-3">
          <a href={publishedUrl} rel="noreferrer" target="_blank">
            PR を開く
          </a>
        </Panel>
      ) : null}
      {error !== undefined && error.length > 0 ? (
        <Panel
          aria-live="assertive"
          className="rounded-md border-destructive/40 bg-destructive/10 text-sm text-destructive"
          padding="sm"
          role="alert"
        >
          {error}
        </Panel>
      ) : null}
    </section>
  )
}
