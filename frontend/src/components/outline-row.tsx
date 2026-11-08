import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { useEffect, useRef, useState } from 'react'

import type { MoveBlockInput } from '#article/index'
import type { Heading } from '#article/types'
import { BlockMoveMenu } from '#components/block-move-menu'
import {
  type OutlineHeadingEditing,
  OutlineHeadingInput,
} from '#components/outline-heading-input'
import {
  outlineIndent,
  OutlineProposalRow,
  proposalHandlers,
} from '#components/outline-proposal-row'
import { OutlineRowBadges } from '#components/outline-row-badges'
import {
  blockFrom,
  type FlatHeading,
  type OutlineDropTarget,
  sectionEnd,
  siblingHeading,
} from '#components/outline-view-utils'
import { useCoarsePointer } from '#hooks/use-coarse-pointer'
import { cn } from '#lib/utils'
import { memoIdFrom } from '#outline/memo-drag'
import type { OutlineSuggestion } from '#proposals/outline'

export function OutlineRow({
  heading,
  depth,
  bodyLength,
  allHeadings,
  active,
  editing,
  memoCount,
  moveConflictCount,
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
  editing?: OutlineHeadingEditing | undefined
  memoCount: number
  moveConflictCount: number
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
  const badges = (
    <OutlineRowBadges
      memoCount={memoCount}
      moveConflictCount={moveConflictCount}
    />
  )

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
      {proposal && !editing ? (
        <OutlineProposalRow
          depth={depth}
          leading={handle}
          level={heading.level}
          onSelect={onSelect}
          original={text}
          proposal={proposal}
          selected={active}
          trailing={badges}
          {...proposalHandlers(onProposalAccept, onProposalReject)}
        />
      ) : (
        <div
          aria-label={heading.text}
          aria-selected={active || editing !== undefined}
          className={cn(
            'flex min-h-8 w-full items-center gap-2 py-1 pe-2 text-left text-sm hover:bg-accent/50 pointer-coarse:min-h-11',
            (active || editing !== undefined) && 'bg-accent hover:bg-accent',
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
          {editing ? (
            <OutlineHeadingInput editing={editing} text={heading.text} />
          ) : (
            <span className="min-w-0 flex-1 truncate">{text}</span>
          )}
          {badges}
        </div>
      )}
    </div>
  )
}
