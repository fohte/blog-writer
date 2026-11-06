import { ListItem } from '@fohte/ui/list'

import { SuggestionDiff } from '#components/suggestion-diff'
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

export function proposalDiffActions(
  proposal: OutlineSuggestion,
  onProposalAccept?: (id: string) => void,
  onProposalReject?: (id: string) => void,
) {
  return {
    ...(onProposalAccept === undefined
      ? {}
      : {
          onAccept: () => {
            onProposalAccept(proposal.id)
          },
        }),
    ...(onProposalReject === undefined
      ? {}
      : {
          onReject: () => {
            onProposalReject(proposal.id)
          },
        }),
  }
}

export function headingLevel(markdown: string): number {
  const prefix = /^#{1,6}(?=[ \t]|$)/u.exec(markdown)?.[0]
  return prefix?.length ?? 1
}

export function headingText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}[ \t]*/u, '')
    .replace(/[ \t]+#+[ \t]*$/u, '')
    .trim()
}

export function OutlineProposalRow({
  depth,
  proposal,
  onProposalAccept,
  onProposalReject,
}: {
  depth: number
  proposal: OutlineSuggestion
  onProposalAccept?: (id: string) => void
  onProposalReject?: (id: string) => void
}) {
  return (
    <ListItem
      aria-label={headingText(proposal.replacement)}
      indent={0}
      selected={false}
    >
      <span
        className="min-w-0 flex-1 truncate"
        style={{ paddingInlineStart: `${String(depth)}rem` }}
      >
        <SuggestionDiff
          focused
          inline
          original=""
          replacement={headingText(proposal.replacement)}
          {...proposalDiffActions(proposal, onProposalAccept, onProposalReject)}
        />
      </span>
    </ListItem>
  )
}
