import type { EvidenceVerdict, Source } from '#article/types'

export type ClaimEvidenceCardProps = {
  source: Source
  quote: string
  verdict: EvidenceVerdict
  checkedAt: string
  publishedAt: string | null
  edited?: boolean
  open?: boolean
  onRemove?: () => void
  showMarker?: boolean
}

const verdictLabels: Record<EvidenceVerdict, string> = {
  supported: '裏付けあり',
  insufficient: '不足',
  outdated: '古い',
  contradicted: '矛盾',
}

export function ClaimEvidenceCard({
  source,
  quote,
  verdict,
  checkedAt,
  publishedAt,
  edited = false,
  open = true,
  onRemove,
  showMarker = true,
}: ClaimEvidenceCardProps) {
  const markerColor =
    edited || verdict !== 'supported'
      ? 'var(--tint-orange-foreground)'
      : 'var(--tint-green-foreground)'
  const markerClass =
    edited || verdict !== 'supported'
      ? 'cm-evidence-marker cm-evidence-edited'
      : 'cm-evidence-marker cm-evidence-supported'
  return (
    <div className="flex flex-col gap-2">
      {showMarker ? (
        <span
          aria-label="根拠の状態"
          className={`self-start ${markerClass}`}
          role="img"
          style={{ color: markerColor }}
        >
          ●
        </span>
      ) : null}
      <section
        aria-label="根拠"
        className="cm-evidence-card flex w-80 flex-col gap-3 rounded-md border bg-popover p-3 text-popover-foreground shadow-md"
        hidden={!open}
      >
        <h3 className="font-semibold">{source.title}</h3>
        <p className="text-sm text-muted-foreground">
          {edited ? '確認後に編集' : verdictLabels[verdict]}
        </p>
        <blockquote className="border-l-2 border-border pl-3 text-sm text-muted-foreground">
          {quote || '引用箇所はありません。'}
        </blockquote>
        <p className="whitespace-pre-wrap text-sm">
          {source.summary || '要約はありません。'}
        </p>
        <p className="text-xs text-muted-foreground">
          確認日: {checkedAt.slice(0, 10)}
        </p>
        <p className="text-xs text-muted-foreground">
          公開日: {publishedAt ?? '不明'}
        </p>
        {source.url !== null ? (
          <a href={source.url} rel="noreferrer" target="_blank">
            資料を開く
          </a>
        ) : null}
        {onRemove ? (
          <button className="self-start text-sm underline" onClick={onRemove}>
            外す
          </button>
        ) : null}
      </section>
    </div>
  )
}
