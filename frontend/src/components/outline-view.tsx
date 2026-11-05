import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { Button } from '@fohte/ui/button'
import { List, ListItem } from '@fohte/ui/list'
import { Popover, PopoverContent } from '@fohte/ui/popover'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { MoveBlockInput } from '#article/index'
import type { Heading } from '#article/types'

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
        <Popover anchor={handleRef} onOpenChange={setMenuOpen} open={menuOpen}>
          <button
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={`Move ${heading.text || 'heading'}`}
            className="cursor-grab touch-none select-none rounded p-1 text-muted-foreground hover:bg-accent active:cursor-grabbing [-webkit-touch-callout:none] [-webkit-user-select:none]"
            onClick={(event) => {
              event.stopPropagation()
              setMenuOpen((isOpen) => !isOpen)
            }}
            onMouseDown={(event) => {
              event.stopPropagation()
            }}
            ref={handleRef}
            type="button"
          >
            ⠿
          </button>
          <PopoverContent
            className="flex min-w-36 flex-col gap-1 p-1"
            role="menu"
          >
            <Button
              className="w-full justify-start"
              disabled={!previousHeading}
              onClick={() => {
                if (previousHeading) {
                  submitMove({
                    from: heading.from,
                    destination: previousHeading.from,
                  })
                }
              }}
              role="menuitem"
              size="sm"
              variant="ghost"
            >
              Move up
            </Button>
            <Button
              className="w-full justify-start"
              disabled={!nextHeading}
              onClick={() => {
                if (nextHeading) {
                  submitMove({
                    from: heading.from,
                    destination: sectionEnd(
                      allHeadings,
                      nextHeading.from,
                      bodyLength,
                    ),
                  })
                }
              }}
              role="menuitem"
              size="sm"
              variant="ghost"
            >
              Move down
            </Button>
            <Button
              className="w-full justify-start"
              disabled={!previousHeading}
              onClick={() => {
                if (previousHeading) {
                  submitMove({
                    from: heading.from,
                    destination: heading.from,
                    childOf: previousHeading.from,
                  })
                }
              }}
              role="menuitem"
              size="sm"
              variant="ghost"
            >
              Make child
            </Button>
          </PopoverContent>
        </Popover>
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
  onSelect,
  onMove,
}: OutlineViewProps) {
  const flattened = useMemo(() => flattenHeadings(headings), [headings])

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
              openMenu={heading.from === openMenuFrom}
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
