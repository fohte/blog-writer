import { Popover, PopoverContent, PopoverTrigger } from '@fohte/ui/popover'

import type { Finding, Source } from '#article/index'

type ResearchSourceCardProps = {
  source: Source
  finding: Finding
  open?: boolean | undefined
}

function getCheckedAt(source: Source): string | undefined {
  if (source.checkedAt === null || source.checkedAt.length === 0) {
    return undefined
  }
  const parsed = new Date(source.checkedAt)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed.toLocaleDateString('ja-JP', { timeZone: 'UTC' })
}

export function ResearchSourceCard({
  source,
  finding,
  open,
}: ResearchSourceCardProps) {
  const checkedAt = getCheckedAt(source)
  return (
    <Popover open={open}>
      <PopoverTrigger className="w-full py-2 text-left text-sm">
        {finding.text}
      </PopoverTrigger>
      <PopoverContent className="flex w-80 flex-col gap-3">
        <h3 className="font-semibold">{source.title}</h3>
        <blockquote className="border-l-2 border-border pl-3 text-sm text-muted-foreground">
          {finding.quote}
        </blockquote>
        <p className="whitespace-pre-wrap text-sm">{source.summary}</p>
        {checkedAt !== undefined ? (
          <p className="text-xs text-muted-foreground">確認日: {checkedAt}</p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
