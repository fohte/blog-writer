import { draggable } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { Button } from '@fohte/ui/button'
import { Input } from '@fohte/ui/input'
import { Kbd } from '@fohte/ui/kbd'
import { List } from '@fohte/ui/list'
import { SegmentedControl } from '@fohte/ui/segmented-control'
import { GripVerticalIcon } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'

import type { Heading, Memo } from '#article/index'
import { MemoAdoptionMenu } from '#components/memo-adoption-menu'
import { writeMemoKeyLabel } from '#lib/key-labels'

type MemoFilter = Memo['state']['kind']

type MemoPanelViewProps = {
  memos: Memo[]
  headings: Heading[]
  draft: string
  filter: MemoFilter
  error?: string | undefined
  openAdoptionMenuId?: string | undefined
  adoptionPresentation?: 'popover' | 'sheet' | undefined
  onDraftChange: (draft: string) => void
  onAddMemo: () => void
  onFilterChange: (filter: MemoFilter) => void
  onMoveMemo: (id: string, direction: 'up' | 'down') => void
  onDismissMemo: (id: string) => void
  onRestoreMemo: (id: string) => void
  onAdoptToHeading: (memoId: string, markerIndex: number) => void
  onInsertAsHeading?:
    ((memoId: string, beforeFrom?: number) => void) | undefined
  onOpenAdoptionMenuChange: (memoId: string | undefined) => void
}

const FILTER_LABELS: Record<MemoFilter, string> = {
  unorganized: '未整理',
  adopted: '採用済み',
  dismissed: '見送り',
}

const EMPTY_MESSAGES: Record<MemoFilter, string> = {
  unorganized: '未整理のメモはありません。',
  adopted: '採用済みのメモはありません。',
  dismissed: '見送ったメモはありません。',
}

export function MemoPanelView({
  memos,
  headings,
  draft,
  filter,
  error,
  openAdoptionMenuId,
  adoptionPresentation,
  onDraftChange,
  onAddMemo,
  onFilterChange,
  onMoveMemo,
  onDismissMemo,
  onRestoreMemo,
  onAdoptToHeading,
  onInsertAsHeading,
  onOpenAdoptionMenuChange,
}: MemoPanelViewProps) {
  const dragHandleRefs = useRef(new Map<string, HTMLButtonElement>())
  const visibleMemos = useMemo(
    () => memos.filter((memo) => memo.state.kind === filter),
    [filter, memos],
  )

  useEffect(() => {
    const cleanup = visibleMemos.flatMap((memo) => {
      const handle = dragHandleRefs.current.get(memo.id)
      if (!handle) return []

      return [
        draggable({
          element: handle,
          getInitialData: () => ({
            kind: 'memo',
            memoId: memo.id,
          }),
        }),
      ]
    })

    return () => {
      for (const cleanupDraggable of cleanup) cleanupDraggable()
    }
  }, [visibleMemos])

  return (
    <section aria-label="メモ" className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (draft.trim().length > 0) onAddMemo()
        }}
      >
        <label className="text-xs text-muted-foreground" htmlFor="new-memo">
          メモを足す <Kbd className="max-md:hidden">{writeMemoKeyLabel}</Kbd>
        </label>
        <Input
          id="new-memo"
          onChange={(event) => {
            onDraftChange(event.currentTarget.value)
          }}
          placeholder="思いついたことを書いて Enter"
          value={draft}
        />
      </form>

      {error === undefined ? null : <p role="alert">{error}</p>}

      {/* SegmentedControl takes no className, and a flex column would stretch it. */}
      <div>
        <SegmentedControl
          aria-label="表示するメモ"
          onValueChange={onFilterChange}
          options={(['unorganized', 'adopted', 'dismissed'] as const).map(
            (kind) => ({
              value: kind,
              label: `${FILTER_LABELS[kind]} ${String(
                memos.filter((memo) => memo.state.kind === kind).length,
              )}`,
            }),
          )}
          value={filter}
        />
      </div>

      {visibleMemos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {EMPTY_MESSAGES[filter]}
        </p>
      ) : (
        <List aria-label="メモ一覧">
          {visibleMemos.map((memo, index) => (
            <div
              className="flex items-start gap-2 border-b border-border py-2 last:border-b-0"
              data-memo-id={memo.id}
              key={memo.id}
              role="listitem"
            >
              {memo.state.kind === 'dismissed' ? null : (
                <button
                  aria-label={`メモ「${memo.text}」をドラッグ`}
                  className="flex h-8 w-6 shrink-0 cursor-grab items-center justify-center touch-none select-none rounded text-muted-foreground hover:bg-accent active:cursor-grabbing [-webkit-touch-callout:none] [-webkit-user-select:none]"
                  ref={(element) => {
                    if (element) dragHandleRefs.current.set(memo.id, element)
                    else dragHandleRefs.current.delete(memo.id)
                  }}
                  type="button"
                >
                  <GripVerticalIcon aria-hidden="true" className="size-4" />
                </button>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5 text-sm">
                <p
                  className={
                    memo.state.kind === 'unorganized'
                      ? 'whitespace-pre-wrap'
                      : 'whitespace-pre-wrap text-muted-foreground'
                  }
                >
                  {memo.state.kind === 'adopted' ? (
                    <span aria-hidden="true" className="font-mono">
                      [x]{' '}
                    </span>
                  ) : null}
                  {memo.text}
                </p>
                {memo.state.kind === 'adopted' ? (
                  <p className="truncate text-xs text-muted-foreground">
                    →{' '}
                    <span className="font-mono">
                      {'#'.repeat(memo.state.heading.level)}
                    </span>{' '}
                    {memo.state.heading.text}
                  </p>
                ) : null}
              </div>
              {memo.state.kind === 'dismissed' ? (
                <Button
                  onClick={() => {
                    onRestoreMemo(memo.id)
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  未整理に戻す
                </Button>
              ) : (
                <MemoAdoptionMenu
                  canMoveDown={index < visibleMemos.length - 1}
                  canMoveUp={index > 0}
                  headings={headings}
                  memo={memo}
                  onAdoptToHeading={onAdoptToHeading}
                  onDismiss={() => {
                    onDismissMemo(memo.id)
                  }}
                  onInsertAsHeading={onInsertAsHeading}
                  onMove={(direction) => {
                    onMoveMemo(memo.id, direction)
                  }}
                  onOpenChange={(open) => {
                    onOpenAdoptionMenuChange(open ? memo.id : undefined)
                  }}
                  onRestore={() => {
                    onRestoreMemo(memo.id)
                  }}
                  open={openAdoptionMenuId === memo.id}
                  presentation={adoptionPresentation}
                />
              )}
            </div>
          ))}
        </List>
      )}
    </section>
  )
}
