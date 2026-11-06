import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { Button } from '@fohte/ui/button'
import { List, ListItem } from '@fohte/ui/list'
import { Popover, PopoverContent } from '@fohte/ui/popover'
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
import {
  OutlineMemoDropGap,
  type OutlineMemoGapTarget,
} from '#components/outline-memo-drop-gap'
import { memoIdFrom } from '#outline/memo-drag'

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
  onAdoptMemo?: ((memoId: string, markerIndex: number) => void) | undefined
  onInsertMemo?: (memoId: string, beforeFrom?: number) => void
  onSelect: (from: number) => void
  onMove: (input: MoveBlockInput) => void
}

type FlatHeading = ReturnType<typeof flattenHeadingTreeWithDepth>[number]

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
  dropTarget,
  onMemoDropTargetChange,
  openMenu,
  onSelect,
  onMove,
  onAdoptMemo,
}: {
  heading: Heading
  depth: number
  bodyLength: number
  allHeadings: FlatHeading[]
  active: boolean
  dropTarget: OutlineDropTarget | undefined
  onMemoDropTargetChange: (target: OutlineDropTarget | undefined) => void
  openMenu: boolean
  onSelect: () => void
  onMove: (input: MoveBlockInput) => void
  onAdoptMemo?: ((memoId: string, markerIndex: number) => void) | undefined
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLButtonElement>(null)
  const [localDrop, setLocalDrop] =
    useState<Extract<OutlineDropTarget, { kind: 'move' }>>()
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
  return (
    <div
      className={`relative ${
        isTarget && target.placement === 'before'
          ? 'border-t-2 border-primary'
          : isTarget && target.placement === 'after'
            ? 'border-b-2 border-primary'
            : isTarget || isMemoTarget
              ? 'rounded bg-accent/50'
              : ''
      }`}
      data-drop-placement={isTarget ? target.placement : undefined}
      data-memo-drop-target={isMemoTarget ? 'heading' : undefined}
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
          <PopoverContent
            className="flex min-w-36 flex-col gap-1 p-1"
            onClick={(event) => {
              event.stopPropagation()
            }}
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
  onAdoptMemo,
  onInsertMemo,
  onSelect,
  onMove,
}: OutlineViewProps) {
  const flattened = useMemo(
    () => flattenHeadingTreeWithDepth(headings),
    [headings],
  )
  const [localGapDropTarget, setLocalGapDropTarget] =
    useState<OutlineDropTarget>()
  const memoDropTarget =
    dropTarget?.kind === 'memo-heading' ||
    dropTarget?.kind === 'memo-gap' ||
    dropTarget?.kind === 'block-gap'
      ? dropTarget
      : localGapDropTarget
  const handleMemoGapDragChange = useCallback(
    (target: OutlineMemoGapTarget | undefined) => {
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
    (memoDropTarget?.kind === 'memo-gap' ||
      memoDropTarget?.kind === 'block-gap') &&
    memoDropTarget.beforeFrom === beforeFrom

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
        <>
          <p className="text-sm text-muted-foreground">No headings yet.</p>
          <OutlineMemoDropGap
            active={isGapActive()}
            bodyLength={bodyLength}
            onDragChange={handleMemoGapDragChange}
            onInsertMemo={onInsertMemo}
            onMove={onMove}
          />
        </>
      ) : (
        <List aria-label="Headings" role="listbox">
          {flattened.map(({ heading, depth }) => (
            <Fragment key={heading.from}>
              <OutlineMemoDropGap
                active={isGapActive(heading.from)}
                beforeFrom={heading.from}
                bodyLength={bodyLength}
                onDragChange={handleMemoGapDragChange}
                onInsertMemo={onInsertMemo}
                onMove={onMove}
              />
              <OutlineRow
                active={heading.from === activeFrom}
                allHeadings={flattened}
                bodyLength={bodyLength}
                depth={depth}
                dropTarget={
                  dropTarget?.kind === 'move' ? dropTarget : memoDropTarget
                }
                heading={heading}
                onAdoptMemo={onAdoptMemo}
                onMemoDropTargetChange={setLocalGapDropTarget}
                onMove={onMove}
                onSelect={() => {
                  onSelect(heading.from)
                }}
                openMenu={heading.from === openMenuFrom}
              />
            </Fragment>
          ))}
          <OutlineMemoDropGap
            active={isGapActive()}
            bodyLength={bodyLength}
            onDragChange={handleMemoGapDragChange}
            onInsertMemo={onInsertMemo}
            onMove={onMove}
          />
        </List>
      )}
    </section>
  )
}
