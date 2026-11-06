import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { useEffect, useRef } from 'react'

import { memoIdFrom } from '#outline/memo-drag'

type OutlineMemoDropGapProps = {
  beforeFrom?: number
  active: boolean
  onDragChange: (target: { beforeFrom?: number } | undefined) => void
  onInsertMemo?: ((memoId: string, beforeFrom?: number) => void) | undefined
}

export function OutlineMemoDropGap({
  beforeFrom,
  active,
  onDragChange,
  onInsertMemo,
}: OutlineMemoDropGapProps) {
  const gapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = gapRef.current
    if (!element) return

    const updateDropTarget = () => {
      onDragChange({
        ...(beforeFrom === undefined ? {} : { beforeFrom }),
      })
    }
    return dropTargetForElements({
      element,
      canDrop: ({ source }) =>
        memoIdFrom(source) !== undefined && onInsertMemo !== undefined,
      getData: () => ({ kind: 'memo-gap-target', beforeFrom }),
      onDragEnter: updateDropTarget,
      onDrag: updateDropTarget,
      onDragLeave: () => {
        onDragChange(undefined)
      },
      onDrop: ({ source }) => {
        const memoId = memoIdFrom(source)
        onDragChange(undefined)
        if (memoId !== undefined) onInsertMemo?.(memoId, beforeFrom)
      },
    })
  }, [beforeFrom, onDragChange, onInsertMemo])

  return (
    <div
      aria-hidden="true"
      className={`h-4 w-full rounded-sm transition-colors ${
        active ? 'border border-dashed border-primary bg-primary/10' : ''
      }`}
      data-outline-gap={beforeFrom ?? 'end'}
      data-memo-drop-target={active ? 'gap' : undefined}
      ref={gapRef}
      style={{ flexShrink: 0, height: '16px' }}
    />
  )
}
