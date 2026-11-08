import { List } from '@fohte/ui/list'
import { Fragment, useCallback, useMemo, useState } from 'react'

import type { MoveBlockInput } from '#article/index'
import { flattenHeadingTreeWithDepth } from '#article/index'
import type { Heading } from '#article/types'
import {
  OutlineDropGap,
  type OutlineGapDropTarget,
} from '#components/outline-drop-gap'
import type { OutlineHeadingEditing } from '#components/outline-heading-input'
import {
  headingLevel,
  OutlineProposalRow,
  proposalHandlers,
} from '#components/outline-proposal-row'
import { OutlineRow } from '#components/outline-row'
import {
  type OutlineDropTarget,
  outlineViewEntries,
} from '#components/outline-view-utils'
import type { OutlineProposalState } from '#proposals/outline'

export interface OutlineViewProps {
  headings: Heading[]
  bodyLength: number
  activeFrom?: number
  /** The row being edited from the keyboard, identified by the heading's `from`. */
  editing?: (OutlineHeadingEditing & { from: number }) | undefined
  openMenuFrom?: number
  dropTarget?: OutlineDropTarget
  error?: string
  /** Adopted memo counts keyed by the heading's `from`. */
  memoCounts?: Readonly<Record<number, number>> | undefined
  /** Leftover move conflict counts keyed by the heading's `from`. */
  moveConflictCounts?: Readonly<Record<number, number>> | undefined
  onAdoptMemo?: ((memoId: string, markerIndex: number) => void) | undefined
  onInsertMemo?: (memoId: string, beforeFrom?: number) => void
  proposalState?: OutlineProposalState
  onSelect: (from: number) => void
  onMove: (input: MoveBlockInput) => void
  onProposalAccept?: (id: string) => void
  onProposalReject?: (id: string) => void
}

export function OutlineView({
  headings,
  bodyLength,
  activeFrom,
  editing,
  openMenuFrom,
  dropTarget,
  error,
  memoCounts,
  moveConflictCounts,
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
      <h2 className="flex justify-between px-2 text-xs font-bold tracking-wide text-muted-foreground">
        構成
        {suggestions.length > 0 ? (
          <span className="font-mono text-2xs font-normal">
            修正案 {suggestions.length}
          </span>
        ) : null}
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
                  editing={
                    editing?.from === entry.heading.from ? editing : undefined
                  }
                  heading={entry.heading}
                  memoCount={memoCounts?.[entry.heading.from] ?? 0}
                  moveConflictCount={
                    moveConflictCounts?.[entry.heading.from] ?? 0
                  }
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
