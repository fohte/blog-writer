import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { List } from '@fohte/ui/list'
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { MoveBlockInput } from '#article/index'
import { flattenHeadingTreeWithDepth } from '#article/index'
import type { Heading } from '#article/types'
import { BlockMoveMenu } from '#components/block-move-menu'
import {
  OutlineDropGap,
  type OutlineGapDropTarget,
} from '#components/outline-drop-gap'
import {
  headingLevel,
  outlineIndent,
  OutlineProposalRow,
  proposalHandlers,
} from '#components/outline-proposal-row'
import {
  type FlatHeading,
  outlineViewEntries,
  sectionEnd,
  siblingHeading,
} from '#components/outline-view-utils'
import { useCoarsePointer } from '#hooks/use-coarse-pointer'
import { cn } from '#lib/utils'
import { memoIdFrom } from '#outline/memo-drag'
import type {
  OutlineProposalState,
  OutlineSuggestion,
} from '#proposals/outline'

type OutlineDropTarget =
  | { kind: 'move'; from: number; placement: 'before' | 'after' | 'child' }
  | { kind: 'memo-heading'; from: number }
  | { kind: 'memo-gap'; beforeFrom?: number }
  | { kind: 'block-gap'; beforeFrom?: number }

export interface OutlineViewProps {
  headings: Heading[]
  bodyLength: number
  activeFrom?: number
  openMenuFrom?: number
  dropTarget?: OutlineDropTarget
  error?: string
  /** Adopted memo counts keyed by the heading's `from`. */
  memoCounts?: Readonly<Record<number, number>> | undefined
  onAdoptMemo?: ((memoId: string, markerIndex: number) => void) | undefined
  onInsertMemo?: (memoId: string, beforeFrom?: number) => void
  proposalState?: OutlineProposalState
  onSelect: (from: number) => void
  onMove: (input: MoveBlockInput) => void
  onProposalAccept?: (id: string) => void
  onProposalReject?: (id: string) => void
}

function blockFrom(source: { data: Record<string, unknown> }) {
  return source.data['kind'] === 'block' &&
    typeof source.data['from'] === 'number'
    ? source.data['from']
    : undefined
}

function OutlineRow({
  heading,
  depth,
  bodyLength,
  allHeadings,
  active,
  memoCount,
  dropTarget,
  onMemoDropTargetChange,
  openMenu,
  onSelect,
  onMove,
  onAdoptMemo,
  proposal,
  onProposalAccept,
  onProposalReject,
}: {
  heading: Heading
  depth: number
  bodyLength: number
  allHeadings: FlatHeading[]
  active: boolean
  memoCount: number
  dropTarget: OutlineDropTarget | undefined
  onMemoDropTargetChange: (target: OutlineDropTarget | undefined) => void
  openMenu: boolean
  onSelect: () => void
  onMove: (input: MoveBlockInput) => void
  onAdoptMemo?: ((memoId: string, markerIndex: number) => void) | undefined
  proposal?: OutlineSuggestion
  onProposalAccept?: (id: string) => void
  onProposalReject?: (id: string) => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLButtonElement>(null)
  const [localDrop, setLocalDrop] =
    useState<Extract<OutlineDropTarget, { kind: 'move' }>>()
  const [menuOpen, setMenuOpen] = useState(openMenu)
  const handleSize = useCoarsePointer() ? '44px' : '24px'
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
    const updateDropTarget = ({
      self,
    }: {
      self: { data: Record<string, unknown> }
    }) => {
      if (
        self.data['kind'] === 'memo-heading-target' &&
        typeof self.data['from'] === 'number'
      ) {
        onMemoDropTargetChange({
          kind: 'memo-heading',
          from: self.data['from'],
        })
        return
      }
      const placement = self.data['placement']
      if (
        placement === 'before' ||
        placement === 'after' ||
        placement === 'child'
      ) {
        setLocalDrop({ kind: 'move', from: heading.from, placement })
      }
    }
    const cleanupDropTarget = dropTargetForElements({
      element: row,
      canDrop: ({ source }) =>
        (memoIdFrom(source) !== undefined && onAdoptMemo !== undefined) ||
        blockFrom(source) !== undefined,
      getData: ({ input, element, source }) => {
        if (memoIdFrom(source) !== undefined) {
          return { kind: 'memo-heading-target', from: heading.from }
        }
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
      onDragEnter: updateDropTarget,
      onDrag: updateDropTarget,
      onDragLeave: () => {
        setLocalDrop(undefined)
        onMemoDropTargetChange(undefined)
      },
      onDrop: ({ self, source }) => {
        setLocalDrop(undefined)
        onMemoDropTargetChange(undefined)
        const memoId = memoIdFrom(source)
        if (
          memoId !== undefined &&
          self.data['kind'] === 'memo-heading-target'
        ) {
          onAdoptMemo?.(memoId, heading.from)
          return
        }
        const from = blockFrom(source)
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
  }, [
    allHeadings,
    bodyLength,
    heading.from,
    onAdoptMemo,
    onMemoDropTargetChange,
    onMove,
  ])

  const target = dropTarget?.kind === 'move' ? dropTarget : localDrop
  const isTarget = target?.from === heading.from
  const isMemoTarget =
    dropTarget?.kind === 'memo-heading' && dropTarget.from === heading.from
  const text = heading.text || '無題の見出し'
  const handle = (
    <>
      <button
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={`Move ${heading.text || 'heading'}`}
        className="flex shrink-0 cursor-grab touch-none items-center justify-center text-xs text-muted-foreground select-none hover:text-foreground active:cursor-grabbing [-webkit-touch-callout:none] [-webkit-user-select:none]"
        onClick={(event) => {
          event.stopPropagation()
          setMenuOpen((isOpen) => !isOpen)
        }}
        onMouseDown={(event) => {
          event.stopPropagation()
        }}
        ref={handleRef}
        style={{ height: handleSize, width: handleSize }}
        type="button"
      >
        ⋮⋮
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
    </>
  )
  const memoBadge =
    memoCount > 0 ? (
      <span
        className="font-mono text-xs text-muted-foreground"
        title="採用済みのメモ"
      >
        メモ {memoCount}
      </span>
    ) : null

  return (
    <div
      className={cn(
        'relative',
        isTarget &&
          target.placement === 'before' &&
          'border-t-2 border-primary',
        isTarget && target.placement === 'after' && 'border-b-2 border-primary',
        ((isTarget && target.placement === 'child') || isMemoTarget) &&
          'bg-accent/50',
      )}
      data-drop-placement={isTarget ? target.placement : undefined}
      data-memo-drop-target={isMemoTarget ? 'heading' : undefined}
      ref={rowRef}
    >
      {proposal ? (
        <OutlineProposalRow
          depth={depth}
          leading={handle}
          level={heading.level}
          onSelect={onSelect}
          original={text}
          proposal={proposal}
          selected={active}
          trailing={memoBadge}
          {...proposalHandlers(onProposalAccept, onProposalReject)}
        />
      ) : (
        <div
          aria-label={heading.text}
          aria-selected={active}
          className={cn(
            'flex min-h-8 w-full items-center gap-2 py-1 pe-2 text-left text-sm hover:bg-accent/50 pointer-coarse:min-h-11',
            active && 'bg-accent hover:bg-accent',
          )}
          onClick={onSelect}
          onMouseDown={(event) => {
            event.preventDefault()
          }}
          role="option"
          style={{ paddingInlineStart: outlineIndent(depth) }}
        >
          {handle}
          <span aria-hidden="true" className="font-mono text-xs text-primary">
            {'#'.repeat(heading.level)}
          </span>
          <span className="min-w-0 flex-1 truncate">{text}</span>
          {memoBadge}
        </div>
      )}
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
  memoCounts,
  onAdoptMemo,
  onInsertMemo,
  proposalState,
  onSelect,
  onMove,
  onProposalAccept,
  onProposalReject,
}: OutlineViewProps) {
  const flattened = useMemo(
    () => flattenHeadingTreeWithDepth(headings),
    [headings],
  )
  const [localGapDropTarget, setLocalGapDropTarget] =
    useState<OutlineDropTarget>()
  const gapDropTarget =
    dropTarget?.kind === 'memo-heading' ||
    dropTarget?.kind === 'memo-gap' ||
    dropTarget?.kind === 'block-gap'
      ? dropTarget
      : localGapDropTarget
  const handleGapDragChange = useCallback(
    (target: OutlineGapDropTarget | undefined) => {
      setLocalGapDropTarget(
        target === undefined
          ? undefined
          : {
              kind: target.kind === 'memo' ? 'memo-gap' : 'block-gap',
              ...(target.beforeFrom === undefined
                ? {}
                : { beforeFrom: target.beforeFrom }),
            },
      )
    },
    [],
  )
  const isGapActive = (beforeFrom?: number) =>
    (gapDropTarget?.kind === 'memo-gap' ||
      gapDropTarget?.kind === 'block-gap') &&
    gapDropTarget.beforeFrom === beforeFrom
  const suggestions = proposalState?.suggestions ?? []
  const handlers = proposalHandlers(onProposalAccept, onProposalReject)
  const entries = outlineViewEntries(flattened, suggestions)

  return (
    <section
      aria-label="Article outline"
      className="flex min-w-0 flex-col gap-2"
    >
      <h2 className="px-2 text-xs font-bold tracking-wide text-muted-foreground">
        構成
      </h2>
      {error !== undefined && error.length > 0 ? (
        <p className="px-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {proposalState?.generating === true ? (
        <p
          aria-live="polite"
          className="px-2 text-xs text-muted-foreground"
          role="status"
        >
          構成の修正案を作成中…
        </p>
      ) : null}
      {entries.length === 0 ? (
        <>
          <p className="px-2 text-sm text-muted-foreground">
            本文に見出しを書くと、ここに並びます。
          </p>
          <OutlineDropGap
            active={isGapActive()}
            bodyLength={bodyLength}
            onDragChange={handleGapDragChange}
            onInsertMemo={onInsertMemo}
            onMove={onMove}
          />
        </>
      ) : (
        <List aria-label="Headings" role="listbox">
          {entries.map((entry) =>
            entry.kind === 'heading' ? (
              <Fragment key={`heading-${String(entry.from)}`}>
                <OutlineDropGap
                  active={isGapActive(entry.heading.from)}
                  beforeFrom={entry.heading.from}
                  bodyLength={bodyLength}
                  onDragChange={handleGapDragChange}
                  onInsertMemo={onInsertMemo}
                  onMove={onMove}
                />
                <OutlineRow
                  active={entry.heading.from === activeFrom}
                  allHeadings={flattened}
                  bodyLength={bodyLength}
                  depth={entry.depth}
                  dropTarget={
                    dropTarget?.kind === 'move' ? dropTarget : gapDropTarget
                  }
                  heading={entry.heading}
                  memoCount={memoCounts?.[entry.heading.from] ?? 0}
                  onAdoptMemo={onAdoptMemo}
                  onMemoDropTargetChange={setLocalGapDropTarget}
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
              </Fragment>
            ) : (
              <OutlineProposalRow
                depth={entry.depth}
                key={entry.proposal.id}
                level={headingLevel(entry.proposal.replacement)}
                {...handlers}
                proposal={entry.proposal}
              />
            ),
          )}
          <OutlineDropGap
            active={isGapActive()}
            bodyLength={bodyLength}
            onDragChange={handleGapDragChange}
            onInsertMemo={onInsertMemo}
            onMove={onMove}
          />
        </List>
      )}
      {suggestions.length > 0 ? (
        <p className="px-2 text-xs leading-relaxed text-muted-foreground">
          緑の破線は構成の修正案です。本文には入っていません。入力が止まったときだけ更新されます。
        </p>
      ) : null}
    </section>
  )
}
