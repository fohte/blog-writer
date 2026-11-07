import { Button } from '@fohte/ui/button'
import { Popover, PopoverContent } from '@fohte/ui/popover'
import { useRef } from 'react'

import type { Heading, Memo } from '#article/index'
import { flattenHeadingTreeWithDepth } from '#article/index'

type MemoAdoptionMenuProps = {
  memo: Memo
  headings: Heading[]
  open?: boolean
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
  const close = () => {
    onOpenChange?.(false)
  }

  return (
    <Popover anchor={triggerRef} onOpenChange={onOpenChange} open={open}>
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
      <PopoverContent className="flex w-72 flex-col gap-3">
        {/* Only the targets scroll so the row actions stay reachable in a long article. */}
        <div className="flex max-h-80 flex-col gap-4 overflow-y-auto">
          {onInsertAsHeading === undefined ? null : (
            <section className="flex flex-col gap-1">
              <h3 className="text-xs text-muted-foreground-strong">
                新しい見出しとして
              </h3>
              {flatHeadings.map(({ heading }) => (
                <Button
                  className="w-full justify-start truncate"
                  key={`before-${String(heading.from)}`}
                  onClick={() => {
                    onInsertAsHeading(memo.id, heading.from)
                    close()
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  「{heading.text || '無題の見出し'}」の前
                </Button>
              ))}
              <Button
                className="w-full justify-start"
                onClick={() => {
                  onInsertAsHeading(memo.id)
                  close()
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                {flatHeadings.length === 0 ? '先頭に追加' : '末尾に追加'}
              </Button>
            </section>
          )}
          <section className="flex flex-col gap-1">
            <h3 className="text-xs text-muted-foreground-strong">
              既存の見出しに採用
            </h3>
            {flatHeadings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                見出しはありません。
              </p>
            ) : (
              flatHeadings.map(({ heading }) => (
                <Button
                  className="w-full justify-start truncate"
                  key={heading.from}
                  onClick={() => {
                    onAdoptToHeading(memo.id, heading.from)
                    close()
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <HeadingLabel heading={heading} />
                </Button>
              ))
            )}
          </section>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 border-t border-border pt-3">
          <Button
            aria-label={`メモ「${memo.text}」を上へ`}
            disabled={!canMoveUp}
            onClick={() => {
              onMove('up')
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            上へ
          </Button>
          <Button
            aria-label={`メモ「${memo.text}」を下へ`}
            disabled={!canMoveDown}
            onClick={() => {
              onMove('down')
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            下へ
          </Button>
          {memo.state.kind === 'adopted' ? (
            <Button
              onClick={() => {
                onRestore()
                close()
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              未整理に戻す
            </Button>
          ) : null}
          <Button
            onClick={() => {
              onDismiss()
              close()
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            見送る
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
