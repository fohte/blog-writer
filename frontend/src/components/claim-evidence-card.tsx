import { Button } from '@fohte/ui/button'

import type { EvidenceVerdict, Source } from '#article/types'
import { getSourceHost } from '#research/source-format'

type ClaimEvidenceCardProps = {
  source: Source | null
  quote: string
  verdict: EvidenceVerdict
  checkedAt: string
  edited?: boolean
  onRemove?: () => void
}

const verdictLabels: Record<EvidenceVerdict, string | undefined> = {
  supported: undefined,
  insufficient: '不足',
  outdated: '古い',
  contradicted: '矛盾',
}

function getStatusLabel(verdict: EvidenceVerdict, edited: boolean): string {
  const verdictLabel = verdictLabels[verdict]
  if (!edited && verdictLabel === undefined) return '根拠あり'
  return [
    '要確認',
    ...(verdictLabel === undefined ? [] : [verdictLabel]),
    ...(edited ? ['確認後に編集'] : []),
  ].join(' · ')
}

export function ClaimEvidenceCard({
  source,
  quote,
  verdict,
  checkedAt,
  edited = false,
  onRemove,
}: ClaimEvidenceCardProps) {
  const host =
    source?.url === null || source?.url === undefined
      ? undefined
      : getSourceHost(source.url)
  const origin = [
    ...(host === undefined ? [] : [host]),
    source === null || source.publishedAt === null
      ? '公開日不明'
      : `公開 ${source.publishedAt}`,
  ].join(' · ')
  return (
    <section
      aria-label="この文の根拠"
      className="cm-evidence-card flex w-96 max-w-full flex-col gap-2.5 border border-muted-foreground bg-card p-3.5 text-sm leading-relaxed text-card-foreground shadow-md"
    >
      <div className="flex items-center gap-2.5">
        <span className="border border-muted-foreground px-1.5 font-mono text-xs">
          {getStatusLabel(verdict, edited)}
        </span>
        <span className="flex-1" />
        <span className="font-mono text-xs text-muted-foreground">
          確認 {checkedAt.slice(0, 10)}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {source?.url !== null && source?.url !== undefined ? (
          <a
            className="font-semibold underline-offset-4 hover:underline"
            href={source.url}
            rel="noreferrer"
            target="_blank"
          >
            {source.title}
          </a>
        ) : (
          <span className="font-semibold">{source?.title ?? '資料なし'}</span>
        )}
        {source ? (
          <span className="font-mono text-xs text-muted-foreground">
            {origin}
          </span>
        ) : null}
      </div>
      <blockquote className="border border-border px-2.5 py-2 text-muted-foreground">
        {quote ? `“${quote}”` : '引用箇所はありません。'}
      </blockquote>
      {source ? (
        <p className="whitespace-pre-wrap text-muted-foreground">
          要約: {source.summary || 'ありません。'}
        </p>
      ) : null}
      {onRemove ? (
        <Button
          className="self-start text-xs text-muted-foreground underline underline-offset-3"
          onClick={onRemove}
          type="button"
          variant="plain"
        >
          根拠を外す
        </Button>
      ) : null}
    </section>
  )
}
