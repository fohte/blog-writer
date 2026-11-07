import { Button } from '@fohte/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@fohte/ui/dialog'
import { Popover, PopoverContent } from '@fohte/ui/popover'
import { useRef } from 'react'

import type { Heading, Memo } from '#article/index'
import { flattenHeadingTreeWithDepth } from '#article/index'

type MemoAdoptionMenuProps = {
  memo: Memo
  headings: Heading[]
  open?: boolean
  /** `sheet` shows the targets in a bottom sheet with touch-sized rows for phones. */
  presentation?: 'popover' | 'sheet' | undefined
  canMoveUp: boolean
  canMoveDown: boolean
  onOpenChange?: (open: boolean) => void
  onAdoptToHeading: (memoId: string, markerIndex: number) => void
  onInsertAsHeading?:
    ((memoId: string, beforeFrom?: number) => void) | undefined
  onMove: (direction: 'up' | 'down') => void
  onDismiss: () => void
  onRestore: () => void
}

function HeadingLabel({ heading }: { heading: Heading }) {
  return (
    <>
      <span className="font-mono text-muted-foreground">
        {'#'.repeat(heading.level)}
      </span>{' '}
      {heading.text || '無題の見出し'}
    </>
  )
}

export function MemoAdoptionMenu({
  memo,
  headings,
  open = false,
  presentation = 'popover',
  canMoveUp,
  canMoveDown,
  onOpenChange,
  onAdoptToHeading,
  onInsertAsHeading,
  onMove,
  onDismiss,
  onRestore,
}: MemoAdoptionMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const flatHeadings = flattenHeadingTreeWithDepth(headings)
  const sheet = presentation === 'sheet'
  const close = () => {
    onOpenChange?.(false)
  }
  const targetClassName = sheet
    ? 'h-12 w-full justify-start truncate px-4.5 text-base font-normal'
    : 'w-full justify-start truncate'
  const targetSize = sheet ? 'default' : 'sm'
  const sectionTitleClassName = `text-xs text-muted-foreground-strong ${sheet ? 'px-4.5 pt-3' : ''}`
  const actionClassName = sheet ? 'h-11 text-sm' : ''
  const actionSize = sheet ? 'default' : 'sm'

  const targets = (
    <>
      {onInsertAsHeading === undefined ? null : (
        <section className="flex flex-col gap-1">
          <h3 className={sectionTitleClassName}>新しい見出しとして</h3>
          {flatHeadings.map(({ heading }) => (
            <Button
              className={targetClassName}
              key={`before-${String(heading.from)}`}
              onClick={() => {
                onInsertAsHeading(memo.id, heading.from)
                close()
              }}
              size={targetSize}
              type="button"
              variant="ghost"
            >
              「{heading.text || '無題の見出し'}」の前
            </Button>
          ))}
          <Button
            className={targetClassName}
            onClick={() => {
              onInsertAsHeading(memo.id)
              close()
            }}
            size={targetSize}
            type="button"
            variant="ghost"
          >
            {flatHeadings.length === 0 ? '先頭に追加' : '末尾に追加'}
          </Button>
        </section>
      )}
      <section className="flex flex-col gap-1">
        <h3 className={sectionTitleClassName}>既存の見出しに採用</h3>
        {flatHeadings.length === 0 ? (
          <p
            className={`text-sm text-muted-foreground ${sheet ? 'px-4.5' : ''}`}
          >
            見出しはありません。
          </p>
        ) : (
          flatHeadings.map(({ heading }) => (
            <Button
              className={targetClassName}
              key={heading.from}
              onClick={() => {
                onAdoptToHeading(memo.id, heading.from)
                close()
              }}
              size={targetSize}
              type="button"
              variant="ghost"
            >
              <HeadingLabel heading={heading} />
            </Button>
          ))
        )}
      </section>
    </>
  )

  const actions = (
    <>
      <Button
        aria-label={`メモ「${memo.text}」を上へ`}
        className={actionClassName}
        disabled={!canMoveUp}
        onClick={() => {
          onMove('up')
        }}
        size={actionSize}
        type="button"
        variant="outline"
      >
        上へ
      </Button>
      <Button
        aria-label={`メモ「${memo.text}」を下へ`}
        className={actionClassName}
        disabled={!canMoveDown}
        onClick={() => {
          onMove('down')
        }}
        size={actionSize}
        type="button"
        variant="outline"
      >
        下へ
      </Button>
      {memo.state.kind === 'adopted' ? (
        <Button
          className={actionClassName}
          onClick={() => {
            onRestore()
            close()
          }}
          size={actionSize}
          type="button"
          variant="outline"
        >
          未整理に戻す
        </Button>
      ) : null}
      <Button
        className={actionClassName}
        onClick={() => {
          onDismiss()
          close()
        }}
        size={actionSize}
        type="button"
        variant="outline"
      >
        見送る
      </Button>
    </>
  )

  const trigger = (
    <Button
      aria-expanded={open}
      onClick={() => {
        onOpenChange?.(!open)
      }}
      ref={triggerRef}
      size="sm"
      type="button"
      variant="outline"
    >
      {memo.state.kind === 'adopted' ? '変更' : '採用'}
    </Button>
  )

  if (sheet)
    return (
      <>
        {trigger}
        <Dialog onOpenChange={onOpenChange} open={open}>
          <DialogContent
            aria-label="採用先"
            className="top-auto bottom-0 left-0 max-w-none translate-x-0 translate-y-0 gap-1 rounded-none border-t border-border-strong bg-card px-0 pt-4 pb-7 ring-0 sm:max-w-none"
            showCloseButton={false}
          >
            <div className="flex flex-col gap-1 px-4.5 pb-2.5">
              <span className="text-xs text-muted-foreground-strong">
                このメモを採用
              </span>
              <DialogTitle className="text-base leading-normal font-bold">
                {memo.text}
              </DialogTitle>
            </div>
            <div className="flex max-h-96 flex-col gap-1 overflow-y-auto">
              {targets}
            </div>
            <div className="grid grid-cols-2 gap-2 px-4.5 pt-3">
              {actions}
              <Button
                className={actionClassName}
                onClick={close}
                type="button"
                variant="outline"
              >
                キャンセル
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    )

  return (
    <Popover anchor={triggerRef} onOpenChange={onOpenChange} open={open}>
      {trigger}
      <PopoverContent className="flex w-72 flex-col gap-3">
        {/* Only the targets scroll so the row actions stay reachable in a long article. */}
        <div className="flex max-h-80 flex-col gap-4 overflow-y-auto">
          {targets}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 border-t border-border pt-3">
          {actions}
        </div>
      </PopoverContent>
    </Popover>
  )
}
