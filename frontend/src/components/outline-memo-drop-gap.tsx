import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { useEffect, useRef } from 'react'

import type { MoveBlockInput } from '#article/index'
import { memoIdFrom } from '#outline/memo-drag'

export type OutlineMemoGapTarget = {
  kind: 'block' | 'memo'
  beforeFrom?: number
}

type OutlineMemoDropGapProps = {
  beforeFrom?: number
  bodyLength: number
  active: boolean
  onDragChange: (target: OutlineMemoGapTarget | undefined) => void
  onInsertMemo?: ((memoId: string, beforeFrom?: number) => void) | undefined
  onMove: (input: MoveBlockInput) => void
}

export function OutlineMemoDropGap({
  beforeFrom,
  bodyLength,
  active,
  onDragChange,
  onInsertMemo,
  onMove,
}: OutlineMemoDropGapProps) {
  const gapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = gapRef.current
    if (!element) return

    const updateDropTarget = ({
      source,
    }: {
      source: { data: Record<string, unknown> }
    }) => {
      const kind =
        memoIdFrom(source) !== undefined
          ? 'memo'
          : source.data['kind'] === 'block'
            ? 'block'
            : undefined
      if (kind === undefined) return
      onDragChange({
        kind,
        ...(beforeFrom === undefined ? {} : { beforeFrom }),
      })
    }
    return dropTargetForElements({
      element,
      canDrop: ({ source }) =>
        (memoIdFrom(source) !== undefined && onInsertMemo !== undefined) ||
        (source.data['kind'] === 'block' &&
          typeof source.data['from'] === 'number'),
      getData: ({ source }) => ({
        kind:
          memoIdFrom(source) !== undefined
            ? 'memo-gap-target'
            : 'block-gap-target',
        beforeFrom,
      }),
      onDragEnter: updateDropTarget,
      onDrag: updateDropTarget,
      onDragLeave: () => {
        onDragChange(undefined)
      },
      onDrop: ({ source }) => {
        const memoId = memoIdFrom(source)
        onDragChange(undefined)
        if (memoId !== undefined) {
          onInsertMemo?.(memoId, beforeFrom)
          return
        }
        const from = source.data['from']
        if (source.data['kind'] === 'block' && typeof from === 'number')
          onMove({ from, destination: beforeFrom ?? bodyLength })
      },
    })
  }, [beforeFrom, bodyLength, onDragChange, onInsertMemo, onMove])

  return (
    <div
      aria-hidden="true"
      className={`w-full shrink-0 rounded-sm transition-colors ${
        active ? 'border border-dashed border-primary bg-primary/10' : ''
      }`}
      data-outline-gap={beforeFrom ?? 'end'}
      data-outline-drop-target={active ? 'gap' : undefined}
      ref={gapRef}
      style={{ height: '16px' }}
    />
  )
}
