import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { List, ListItem } from '@fohte/ui/list'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { MoveBlockInput } from '#article/index'
import type { Heading } from '#article/types'
import { BlockMoveMenu } from '#components/block-move-menu'
import { stopButtonClickPropagation } from '#components/outline-view/stop-button-click-propagation'
import { SuggestionDiff } from '#components/suggestion-diff'
import type {
  OutlineProposalState,
  OutlineSuggestion,
} from '#proposals/outline'

type OutlineDropTarget = {
  from: number
  placement: 'before' | 'after' | 'child'
}

export interface OutlineViewProps {
  headings: Heading[]
  bodyLength: number
  activeFrom?: number
  openMenuFrom?: number
  dropTarget?: OutlineDropTarget
  error?: string
  proposalState?: OutlineProposalState
  onSelect: (from: number) => void
  onMove: (input: MoveBlockInput) => void
  onProposalAccept?: (id: string) => void
  onProposalReject?: (id: string) => void
}

type FlatHeading = { heading: Heading; depth: number }

function flattenHeadings(headings: Heading[], depth = 0): FlatHeading[] {
  return headings.flatMap((heading) => [
    { heading, depth },
    ...flattenHeadings(heading.children, depth + 1),
  ])
}

function sectionEnd(headings: FlatHeading[], from: number, bodyLength: number) {
  const index = headings.findIndex(({ heading }) => heading.from === from)
  const current = headings[index]?.heading
  if (!current) return bodyLength
  return (
    headings
      .slice(index + 1)
      .find(({ heading }) => heading.level <= current.level)?.heading.from ??
    bodyLength
  )
}

function siblingHeading(
  headings: FlatHeading[],
  from: number,
  direction: 'previous' | 'next',
): Heading | undefined {
  const index = headings.findIndex(({ heading }) => heading.from === from)
  const current = headings[index]
  if (!current) return undefined
  const step = direction === 'previous' ? -1 : 1
  for (
    let candidateIndex = index + step;
    candidateIndex >= 0;
    candidateIndex += step
  ) {
    const candidate = headings[candidateIndex]
    if (!candidate || candidate.depth < current.depth) return undefined
    if (candidate.depth === current.depth) return candidate.heading
  }
  return undefined
}

function sourceFrom(source: { data: Record<string, unknown> }) {
  return source.data['kind'] === 'block' &&
    typeof source.data['from'] === 'number'
    ? source.data['from']
    : undefined
}

function proposalHandlers(
  onProposalAccept?: (id: string) => void,
  onProposalReject?: (id: string) => void,
) {
  return {
    ...(onProposalAccept === undefined ? {} : { onProposalAccept }),
    ...(onProposalReject === undefined ? {} : { onProposalReject }),
  }
}

function proposalDiffActions(
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

function OutlineRow({
  heading,
  depth,
  bodyLength,
  allHeadings,
  active,
  dropTarget,
  openMenu,
  onSelect,
  onMove,
  proposal,
  onProposalAccept,
  onProposalReject,
}: {
  heading: Heading
  depth: number
  bodyLength: number
  allHeadings: FlatHeading[]
  active: boolean
  dropTarget: OutlineDropTarget | undefined
  openMenu: boolean
  onSelect: () => void
  onMove: (input: MoveBlockInput) => void
  proposal?: OutlineSuggestion
  onProposalAccept?: (id: string) => void
  onProposalReject?: (id: string) => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLButtonElement>(null)
  const [localDrop, setLocalDrop] = useState<OutlineDropTarget>()
  const [menuOpen, setMenuOpen] = useState(openMenu)
  const previousHeading = siblingHeading(allHeadings, heading.from, 'previous')
  const nextHeading = siblingHeading(allHeadings, heading.from, 'next')

  const submitMove = (input: MoveBlockInput) => {
    onMove(input)
    setMenuOpen(false)
  }

  useEffect(() => {
    const row = rowRef.current
    const handle = handleRef.current
    if (!row || !handle) return

    const cleanupDraggable = draggable({
      element: handle,
      getInitialData: () => ({ kind: 'block', from: heading.from }),
    })
    const cleanupDropTarget = dropTargetForElements({
      element: row,
      canDrop: ({ source }) => sourceFrom(source) !== undefined,
      getData: ({ input, element }) => {
        const bounds = element.getBoundingClientRect()
        const ratio = (input.clientY - bounds.top) / bounds.height
        const placement =
          ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'child'
        const destination = sectionEnd(allHeadings, heading.from, bodyLength)
        return {
          kind: 'outline-target',
          from: heading.from,
          placement,
          destination: placement === 'before' ? heading.from : destination,
          ...(placement === 'child' ? { childOf: heading.from } : {}),
        }
      },
      onDragEnter: ({ self }) => {
        const placement = self.data['placement']
        if (
          placement === 'before' ||
          placement === 'after' ||
          placement === 'child'
        ) {
          setLocalDrop({ from: heading.from, placement })
        }
      },
      onDrag: ({ self }) => {
        const placement = self.data['placement']
        if (
          placement === 'before' ||
          placement === 'after' ||
          placement === 'child'
        ) {
          setLocalDrop({ from: heading.from, placement })
        }
      },
      onDragLeave: () => {
        setLocalDrop(undefined)
      },
      onDrop: ({ self, source }) => {
        setLocalDrop(undefined)
        const from = sourceFrom(source)
        const destination = self.data['destination']
        const childOf = self.data['childOf']
        if (from === undefined || typeof destination !== 'number') return
        if (from === heading.from) return
        onMove({
          from,
          destination,
          ...(typeof childOf === 'number' ? { childOf } : {}),
        })
      },
    })

    return () => {
      cleanupDropTarget()
      cleanupDraggable()
    }
  }, [allHeadings, bodyLength, heading.from, onMove])

  const target = dropTarget ?? localDrop
  const isTarget = target?.from === heading.from
  return (
    <div
      className={`relative ${
        isTarget && target.placement === 'before'
          ? 'border-t-2 border-primary'
          : isTarget && target.placement === 'after'
            ? 'border-b-2 border-primary'
            : isTarget
              ? 'rounded bg-accent/50'
              : ''
      }`}
      data-drop-placement={isTarget ? target.placement : undefined}
      ref={rowRef}
    >
      <ListItem
        aria-label={heading.text}
        indent={0}
        onSelect={onSelect}
        selected={active}
      >
        <span
          className="min-w-0 flex-1 truncate"
          onClick={stopButtonClickPropagation}
          style={{ paddingInlineStart: `${String(depth)}rem` }}
        >
          {proposal ? (
            <SuggestionDiff
              focused
              inline
              original={heading.text || 'Untitled heading'}
              replacement={headingText(proposal.replacement)}
              {...proposalDiffActions(
                proposal,
                onProposalAccept,
                onProposalReject,
              )}
            />
          ) : (
            heading.text || 'Untitled heading'
          )}
        </span>
        <button
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={`Move ${heading.text || 'heading'}`}
          className="cursor-grab touch-none select-none rounded text-muted-foreground hover:bg-accent active:cursor-grabbing [-webkit-touch-callout:none] [-webkit-user-select:none]"
          onClick={(event) => {
            event.stopPropagation()
            setMenuOpen((isOpen) => !isOpen)
          }}
          onMouseDown={(event) => {
            event.stopPropagation()
          }}
          ref={handleRef}
          style={{ height: '44px', minWidth: '44px', width: '44px' }}
          type="button"
        >
          ⠿
        </button>
        <BlockMoveMenu
          actions={[
            {
              label: 'Move up',
              input: previousHeading
                ? { from: heading.from, destination: previousHeading.from }
                : undefined,
            },
            {
              label: 'Move down',
              input: nextHeading
                ? {
                    from: heading.from,
                    destination: sectionEnd(
                      allHeadings,
                      nextHeading.from,
                      bodyLength,
                    ),
                  }
                : undefined,
            },
            {
              label: 'Make child',
              input: previousHeading
                ? {
                    from: heading.from,
                    destination: heading.from,
                    childOf: previousHeading.from,
                  }
                : undefined,
            },
          ]}
          anchor={handleRef}
          onMove={submitMove}
          onOpenChange={setMenuOpen}
          open={menuOpen}
        />
      </ListItem>
    </div>
  )
}

export function OutlineView({
  headings,
  bodyLength,
  activeFrom,
  openMenuFrom,
  dropTarget,
  error,
  proposalState,
  onSelect,
  onMove,
  onProposalAccept,
  onProposalReject,
}: OutlineViewProps) {
  const flattened = useMemo(() => flattenHeadings(headings), [headings])
  const suggestions = proposalState?.suggestions ?? []
  const headingProposals = new Map(
    suggestions
      .filter((proposal) => proposal.from !== proposal.to)
      .map((proposal) => [proposal.anchorFrom ?? proposal.from, proposal]),
  )
  const additions = suggestions.filter(
    (proposal) => proposal.from === proposal.to,
  )
  const handlers = proposalHandlers(onProposalAccept, onProposalReject)
  const entries = [
    ...flattened.map(({ heading, depth }) => {
      const proposal = headingProposals.get(heading.from)
      return {
        kind: 'heading' as const,
        from: heading.from,
        heading,
        depth,
        ...(proposal === undefined ? {} : { proposal }),
      }
    }),
    ...additions.map((proposal) => ({
      kind: 'addition' as const,
      from: proposal.from,
      proposal,
      depth: headingLevel(proposal.replacement) - 1,
    })),
  ].sort((left, right) => left.from - right.from)

  return (
    <section
      aria-label="Article outline"
      className="flex min-w-0 flex-col gap-2"
    >
      <h2 className="text-sm font-semibold">Outline</h2>
      {error !== undefined && error.length > 0 ? (
        <p role="alert">{error}</p>
      ) : null}
      {proposalState?.generating === true ? (
        <SuggestionDiff generating original="" replacement="" />
      ) : null}
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No headings yet.</p>
      ) : (
        <List aria-label="Headings" role="listbox">
          {entries.map((entry) =>
            entry.kind === 'heading' ? (
              <OutlineRow
                active={entry.heading.from === activeFrom}
                allHeadings={flattened}
                bodyLength={bodyLength}
                depth={entry.depth}
                dropTarget={dropTarget}
                heading={entry.heading}
                key={`heading-${String(entry.from)}`}
                onMove={onMove}
                {...handlers}
                onSelect={() => {
                  onSelect(entry.heading.from)
                }}
                openMenu={openMenuFrom === entry.heading.from}
                {...(entry.proposal === undefined
                  ? {}
                  : { proposal: entry.proposal })}
              />
            ) : (
              <OutlineProposalRow
                depth={entry.depth}
                key={entry.proposal.id}
                {...handlers}
                proposal={entry.proposal}
              />
            ),
          )}
        </List>
      )}
    </section>
  )
}

function headingLevel(markdown: string): number {
  const prefix = /^#{1,6}(?=[ \t]|$)/u.exec(markdown)?.[0]
  return prefix?.length ?? 1
}

function headingText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}[ \t]*/u, '')
    .replace(/[ \t]+#+[ \t]*$/u, '')
    .trim()
}

function OutlineProposalRow({
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
