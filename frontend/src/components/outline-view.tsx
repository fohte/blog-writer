import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { List, ListItem } from '@fohte/ui/list'
import { useEffect, useRef, useState } from 'react'

import type { MoveBlockInput } from '#article/index'
import type { Heading } from '#article/types'

export type OutlineDropTarget = {
  from: number
  placement: 'before' | 'after' | 'child'
}

export interface OutlineViewProps {
  headings: Heading[]
  bodyLength: number
  activeFrom?: number
  dropTarget?: OutlineDropTarget
  error?: string
  onSelect: (from: number) => void
  onMove: (input: MoveBlockInput) => void
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

function sourceFrom(source: { data: Record<string, unknown> }) {
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
  dropTarget,
  onSelect,
  onMove,
}: {
  heading: Heading
  depth: number
  bodyLength: number
  allHeadings: FlatHeading[]
  active: boolean
  dropTarget: OutlineDropTarget | undefined
  onSelect: () => void
  onMove: (input: MoveBlockInput) => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLButtonElement>(null)
  const [localDrop, setLocalDrop] = useState<OutlineDropTarget>()

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
          style={{ paddingInlineStart: `${String(depth)}rem` }}
        >
          {heading.text || 'Untitled heading'}
        </span>
        <button
          aria-label={`Move ${heading.text || 'heading'}`}
          className="cursor-grab rounded p-1 text-muted-foreground hover:bg-accent active:cursor-grabbing"
          onClick={(event) => {
            event.stopPropagation()
          }}
          ref={handleRef}
          type="button"
        >
          ⠿
        </button>
      </ListItem>
    </div>
  )
}

export function OutlineView({
  headings,
  bodyLength,
  activeFrom,
  dropTarget,
  error,
  onSelect,
  onMove,
}: OutlineViewProps) {
  const flattened = flattenHeadings(headings)

  return (
    <section
      aria-label="Article outline"
      className="flex min-w-0 flex-col gap-2"
    >
      <h2 className="text-sm font-semibold">Outline</h2>
      {error !== undefined && error.length > 0 ? (
        <p role="alert">{error}</p>
      ) : null}
      {flattened.length === 0 ? (
        <p className="text-sm text-muted-foreground">No headings yet.</p>
      ) : (
        <List aria-label="Headings" role="listbox">
          {flattened.map(({ heading, depth }) => (
            <OutlineRow
              active={heading.from === activeFrom}
              allHeadings={flattened}
              bodyLength={bodyLength}
              depth={depth}
              dropTarget={dropTarget}
              heading={heading}
              key={heading.from}
              onMove={onMove}
              onSelect={() => {
                onSelect(heading.from)
              }}
            />
          ))}
        </List>
      )}
    </section>
  )
}
