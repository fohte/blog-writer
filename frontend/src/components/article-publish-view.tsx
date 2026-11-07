import { Button } from '@fohte/ui/button'
import { Input } from '@fohte/ui/input'
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
  destinations: ExportDestination[]
  selectedDestinationId?: string | undefined
  destinationUnavailable?: boolean | undefined
  slug: string
  frontmatter: string
  diff?: { original: string; modified: string } | undefined
  busyAction?: 'diff' | 'publish' | undefined
  canPublish?: boolean | undefined
  error?: string | undefined
  publishedUrl?: string | undefined
  onDestinationChange: (destinationId: string) => void
  onSlugChange: (slug: string) => void
  onFrontmatterChange: (frontmatter: string) => void
  onShowDiff: () => void
  onPublish: () => void
}

const formatLabels: Record<ExportDestination['format'], string> = {
  markdown: 'Markdown',
  mdx: 'MDX',
}

export function ArticlePublishView({
  destinations,
  selectedDestinationId,
  destinationUnavailable = false,
  slug,
  frontmatter,
  diff,
  busyAction,
  canPublish = false,
  error,
  publishedUrl,
  onDestinationChange,
  onSlugChange,
  onFrontmatterChange,
  onShowDiff,
  onPublish,
}: ArticlePublishViewProps) {
  const busy = busyAction !== undefined
  const selectedDestination = destinations.find(
    ({ id }) => id === selectedDestinationId,
  )

  return (
    <section aria-label="PR を作成" className="flex flex-col gap-5">
      {destinationUnavailable ? (
        <p className="text-sm text-muted-foreground-strong" role="status">
          保存済みの公開先は利用できません。公開先を選び直してください。
        </p>
      ) : null}
      <div className="flex flex-col gap-2 border border-border px-3.5 py-3 font-mono text-xs text-muted-foreground-strong">
        <label className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          公開先
          <Select
            disabled={busy}
            onValueChange={(value) => {
              if (value !== null) onDestinationChange(value)
            }}
            value={selectedDestinationId ?? null}
          >
            <SelectTrigger aria-label="公開先" className="min-w-48">
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
        {selectedDestination === undefined ? null : (
          <p>
            形式{' '}
            <span className="text-foreground">
              {formatLabels[selectedDestination.format]}
            </span>
          </p>
        )}
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-xs font-bold text-muted-foreground-strong">
          slug
          <Input
            autoComplete="off"
            className="font-mono font-normal text-foreground"
            disabled={busy}
            onChange={(event) => {
              onSlugChange(event.currentTarget.value)
            }}
            placeholder="example-post"
            value={slug}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-bold text-muted-foreground-strong">
          frontmatter
          <Textarea
            className="font-mono text-xs leading-relaxed font-normal text-foreground"
            disabled={busy}
            onChange={(event) => {
              onFrontmatterChange(event.currentTarget.value)
            }}
            rows={5}
            value={frontmatter}
          />
        </label>
      </div>
      {diff !== undefined ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-bold">
            公開先の現在のファイルとの差分
          </h2>
          <TextDiffView
            modified={diff.modified}
            modifiedLabel="公開する内容"
            original={diff.original}
            originalLabel="公開先の内容"
          />
        </section>
      ) : null}
      {busy ? (
        <p
          aria-live="polite"
          className="text-sm text-muted-foreground-strong"
          role="status"
        >
          {busyAction === 'publish'
            ? 'PR を作成しています…'
            : '公開先を確認しています…'}
        </p>
      ) : null}
      {error !== undefined && error.length > 0 ? (
        <p
          aria-live="assertive"
          className="text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <span className="flex-1 basis-75 text-sm leading-relaxed text-muted-foreground-strong">
          {publishedUrl !== undefined ? (
            <>
              PR を作成しました。{' '}
              <a
                className="text-primary underline-offset-4 hover:underline"
                href={publishedUrl}
                rel="noreferrer"
                target="_blank"
              >
                PR を開く
              </a>
            </>
          ) : diff === undefined ? (
            '作成する前に、公開先の現在のファイルとの差分を確認します。'
          ) : (
            '差分の確認後に公開先が変わっていたら、差分の確認からやり直します。'
          )}
        </span>
        <Button
          disabled={
            busy || selectedDestinationId == null || !isValidArticleSlug(slug)
          }
          onClick={onShowDiff}
          type="button"
          variant={diff === undefined ? 'solid' : 'outline'}
        >
          差分を見る
        </Button>
        {diff !== undefined ? (
          <Button
            disabled={busy || !canPublish}
            onClick={onPublish}
            type="button"
            variant="solid"
          >
            PR を作成
          </Button>
        ) : null}
      </div>
    </section>
  )
}
