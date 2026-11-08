import { Button } from '@fohte/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@fohte/ui/dialog'
import { Input } from '@fohte/ui/input'
import { Kbd } from '@fohte/ui/kbd'
import { Popover, PopoverContent } from '@fohte/ui/popover'
import { SegmentedControl } from '@fohte/ui/segmented-control'
import { type RefObject, useRef, useState } from 'react'

import type { Heading, Memo } from '#article/index'
import { flattenHeadingTreeWithDepth } from '#article/index'
import { resolveNewHeadingPlacement } from '#memos/new-heading-placement'

type MemoAdoptionMenuProps = {
  memo: Memo
  headings: Heading[]
  /** The editor cursor, which decides where a new heading goes. */
  cursorOffset?: number | undefined
  /** The filter text the menu opens with. */
  defaultHeadingQuery?: string | undefined
  open?: boolean
  /** `sheet` shows the targets in a bottom sheet with touch-sized rows for phones. */
  presentation?: 'popover' | 'sheet' | undefined
  canMoveUp: boolean
  canMoveDown: boolean
  onOpenChange?: (open: boolean) => void
  onAdoptToHeading: (memoId: string, markerIndex: number) => void
  onInsertAsHeading?:
    ((memoId: string, beforeFrom?: number, level?: number) => void) | undefined
  onMove: (direction: 'up' | 'down') => void
  onDismiss: () => void
  onRestore: () => void
}

type AdoptionTargetsProps = Pick<
  MemoAdoptionMenuProps,
  'memo' | 'headings' | 'onAdoptToHeading' | 'onInsertAsHeading'
> & {
  cursorOffset: number
  defaultHeadingQuery: string
  sheet: boolean
  newHeadingRef: RefObject<HTMLButtonElement | null>
  close: () => void
}

function headingDisplayText({ text }: Pick<Heading, 'text'>) {
  return text || '無題の見出し'
}

function HeadingLabel({ heading }: { heading: Heading }) {
  return (
    <>
      <span className="font-mono text-muted-foreground">
        {'#'.repeat(heading.level)}
      </span>{' '}
      {headingDisplayText(heading)}
    </>
  )
}

// Rendered inside the popup so the level and filter reset on every open.
function AdoptionTargets({
  memo,
  headings,
  cursorOffset,
  defaultHeadingQuery,
  sheet,
  newHeadingRef,
  close,
  onAdoptToHeading,
  onInsertAsHeading,
}: AdoptionTargetsProps) {
  const [chosenLevel, setChosenLevel] = useState<number>()
  const [query, setQuery] = useState(defaultHeadingQuery)
  const flatHeadings = flattenHeadingTreeWithDepth(headings)
  const placement = resolveNewHeadingPlacement(headings, cursorOffset)
  const level =
    chosenLevel !== undefined && placement.levels.includes(chosenLevel)
      ? chosenLevel
      : placement.defaultLevel
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matchingHeadings = flatHeadings.filter(({ heading }) =>
    headingDisplayText(heading).toLocaleLowerCase().includes(normalizedQuery),
  )
  const position =
    placement.anchor === undefined
      ? '本文の末尾'
      : `${headingDisplayText(placement.anchor)} の末尾`
  const anchorMarker =
    placement.anchor === undefined
      ? ''
      : `${'#'.repeat(placement.anchor.level)} `
  const insertNewHeading = () => {
    onInsertAsHeading?.(memo.id, placement.beforeFrom, level)
    close()
  }
  const targetClassName = sheet
    ? 'h-12 w-full justify-start truncate px-4.5 text-base font-normal'
    : 'w-full justify-start truncate'
  const sectionTitleClassName = `text-xs text-muted-foreground-strong ${sheet ? 'px-4.5 pt-3' : ''}`

  return (
    <>
      {onInsertAsHeading === undefined ? null : sheet ? (
        <Button
          className="h-13 w-full justify-between gap-2.5 px-4.5 text-base font-normal focus-visible:ring-inset"
          onClick={insertNewHeading}
          type="button"
          variant="ghost"
        >
          <span className="shrink-0">新しい見出しとして追加</span>
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {'#'.repeat(level)} {position}
          </span>
        </Button>
      ) : (
        <section className="flex flex-col gap-2">
          <h3 className={sectionTitleClassName}>新しい見出しとして</h3>
          <div className="flex items-center gap-2">
            <SegmentedControl
              aria-label="新しい見出しのレベル"
              onValueChange={(value) => {
                setChosenLevel(Number(value))
              }}
              options={placement.levels.map((option) => ({
                value: String(option),
                label: '#'.repeat(option),
              }))}
              value={String(level)}
            />
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              位置: {anchorMarker}
              {position}
            </span>
          </div>
          <Button
            aria-label="新しい見出しとして追加"
            className="w-full justify-start focus-visible:ring-inset"
            onClick={insertNewHeading}
            ref={newHeadingRef}
            size="sm"
            type="button"
            variant="ghost"
          >
            <span className="shrink-0 font-mono text-muted-foreground">
              {'#'.repeat(level)}
            </span>
            <span className="min-w-0 truncate">{memo.text}</span>
            <Kbd aria-hidden="true" className="ms-auto shrink-0">
              ⏎
            </Kbd>
          </Button>
        </section>
      )}
      <section className="flex flex-col gap-1">
        <h3 className={sectionTitleClassName}>既存の見出しに採用</h3>
        {sheet || flatHeadings.length === 0 ? null : (
          <Input
            aria-label="見出しを絞り込む"
            onChange={(event) => {
              setQuery(event.target.value)
            }}
            placeholder="見出しを絞り込む"
            value={query}
          />
        )}
        {matchingHeadings.length === 0 ? (
          <p
            className={`text-sm text-muted-foreground ${sheet ? 'px-4.5' : ''}`}
          >
            {flatHeadings.length === 0
              ? '見出しはありません。'
              : '一致する見出しはありません。'}
          </p>
        ) : (
          matchingHeadings.map(({ heading }) => (
            <Button
              className={targetClassName}
              key={heading.from}
              onClick={() => {
                onAdoptToHeading(memo.id, heading.from)
                close()
              }}
              size={sheet ? 'default' : 'sm'}
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
}

export function MemoAdoptionMenu({
  memo,
  headings,
  cursorOffset = 0,
  defaultHeadingQuery = '',
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
  const newHeadingRef = useRef<HTMLButtonElement>(null)
  const sheet = presentation === 'sheet'
  const close = () => {
    onOpenChange?.(false)
  }
  const actionClassName = sheet ? 'h-11 text-sm' : ''
  const actionSize = sheet ? 'default' : 'sm'

  const targets = (
    <AdoptionTargets
      close={close}
      cursorOffset={cursorOffset}
      defaultHeadingQuery={defaultHeadingQuery}
      headings={headings}
      memo={memo}
      newHeadingRef={newHeadingRef}
      onAdoptToHeading={onAdoptToHeading}
      onInsertAsHeading={onInsertAsHeading}
      sheet={sheet}
    />
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
      title="採用先を選ぶ (A)"
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
      <PopoverContent
        className="flex w-72 flex-col gap-3"
        initialFocus={() => newHeadingRef.current ?? true}
      >
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
