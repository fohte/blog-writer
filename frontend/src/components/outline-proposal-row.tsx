import { Button } from '@fohte/ui/button'
import type { ReactNode } from 'react'

import { cn } from '#lib/utils'
import type { OutlineSuggestion } from '#proposals/outline'

export function proposalHandlers(
  onProposalAccept?: (id: string) => void,
  onProposalReject?: (id: string) => void,
) {
  return {
    ...(onProposalAccept === undefined ? {} : { onProposalAccept }),
    ...(onProposalReject === undefined ? {} : { onProposalReject }),
  }
}

export function headingLevel(markdown: string): number {
  const prefix = /^#{1,6}(?=[ \t]|$)/u.exec(markdown)?.[0]
  return prefix?.length ?? 1
}

function headingText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}[ \t]*/u, '')
    .replace(/[ \t]+#+[ \t]*$/u, '')
    .trim()
}

export function outlineIndent(depth: number): string {
  return `${String(0.5 + depth * 1.25)}rem`
}

const proposalKinds = {
  addition: { symbol: '+', label: '追加案' },
  rename: { symbol: '~', label: '改名案' },
  deletion: { symbol: '-', label: '削除案' },
}

function proposalKind(proposal: OutlineSuggestion) {
  if (proposal.from === proposal.to) return proposalKinds.addition
  return proposal.replacement.trim().length === 0
    ? proposalKinds.deletion
    : proposalKinds.rename
}

export function OutlineProposalRow({
  depth,
  level,
  original,
  proposal,
  leading,
  trailing,
  selected = false,
  onSelect,
  onProposalAccept,
  onProposalReject,
}: {
  depth: number
  level: number
  original?: string | undefined
  proposal: OutlineSuggestion
  leading?: ReactNode
  trailing?: ReactNode
  selected?: boolean
  onSelect?: (() => void) | undefined
  onProposalAccept?: ((id: string) => void) | undefined
  onProposalReject?: ((id: string) => void) | undefined
}) {
  const { symbol, label } = proposalKind(proposal)
  const replacement = headingText(proposal.replacement)
  const showOriginal = original !== undefined && original !== replacement

  return (
    <div
      aria-label={original ?? replacement}
      aria-selected={selected}
      className={cn(
        'flex min-h-8 w-full items-center gap-2 border border-dashed border-tint-green-foreground py-1 pe-2 text-left text-sm pointer-coarse:min-h-11',
        selected && 'bg-accent',
        original === undefined && 'text-tint-green-foreground',
      )}
      onClick={onSelect}
      onMouseDown={(event) => {
        event.preventDefault()
      }}
      role="option"
      style={{ paddingInlineStart: outlineIndent(depth) }}
    >
      {leading}
      <span
        aria-hidden="true"
        className="font-mono text-xs text-tint-green-foreground"
      >
        {symbol}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'font-mono text-xs',
          original !== undefined && 'text-primary',
        )}
      >
        {'#'.repeat(level)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        {showOriginal ? (
          <del className="truncate text-tint-red-foreground">{original}</del>
        ) : null}
        {replacement.length > 0 ? (
          <ins className="truncate text-tint-green-foreground no-underline">
            {replacement}
          </ins>
        ) : null}
      </span>
      {trailing}
      {onProposalAccept ? (
        <Button
          aria-label={`${label}を採用`}
          onClick={(event) => {
            event.stopPropagation()
            onProposalAccept(proposal.id)
          }}
          size="icon-xs"
          type="button"
          variant="outline"
        >
          ✓
        </Button>
      ) : null}
      {onProposalReject ? (
        <Button
          aria-label={`${label}を却下`}
          className="text-muted-foreground"
          onClick={(event) => {
            event.stopPropagation()
            onProposalReject(proposal.id)
          }}
          size="icon-xs"
          type="button"
          variant="outline"
        >
          ✕
        </Button>
      ) : null}
    </div>
  )
}
