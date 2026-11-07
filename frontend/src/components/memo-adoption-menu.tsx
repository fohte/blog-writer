import { Button } from '@fohte/ui/button'
import { Popover, PopoverContent } from '@fohte/ui/popover'
import { useRef } from 'react'

import type { Heading, Memo } from '#article/index'
import { flattenHeadingTreeWithDepth } from '#article/index'

type MemoAdoptionMenuProps = {
  memo: Memo
  headings: Heading[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onAdoptToHeading: (memoId: string, markerIndex: number) => void
  onInsertAsHeading?:
    ((memoId: string, beforeFrom?: number) => void) | undefined
}

export function MemoAdoptionMenu({
  memo,
  headings,
  open = false,
  onOpenChange,
  onAdoptToHeading,
  onInsertAsHeading,
}: MemoAdoptionMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const flatHeadings = flattenHeadingTreeWithDepth(headings)

  return (
    <Popover anchor={triggerRef} onOpenChange={onOpenChange} open={open}>
      <Button
        aria-expanded={open}
        onClick={() => {
          onOpenChange?.(!open)
        }}
        ref={triggerRef}
        type="button"
        variant="outline"
      >
        {memo.state.kind === 'adopted' ? '採用先を変更' : '採用先を選ぶ'}
      </Button>
      <PopoverContent className="flex max-h-80 w-72 flex-col gap-2 overflow-y-auto">
        <h3 className="font-semibold">見出しに採用</h3>
        {flatHeadings.length === 0 ? (
          <p className="text-sm text-muted-foreground">見出しはありません。</p>
        ) : (
          <div className="flex flex-col gap-1">
            {flatHeadings.map(({ heading, depth }) => (
              <Button
                className="w-full justify-start truncate"
                key={heading.from}
                onClick={() => {
                  onAdoptToHeading(memo.id, heading.from)
                  onOpenChange?.(false)
                }}
                type="button"
                variant="ghost"
              >
                <span style={{ paddingInlineStart: `${String(depth)}rem` }}>
                  {heading.text || '無題の見出し'}
                </span>
              </Button>
            ))}
          </div>
        )}
        {onInsertAsHeading === undefined ? null : (
          <>
            <h3 className="mt-2 font-semibold">新しい見出しとして追加</h3>
            {flatHeadings.map(({ heading }) => (
              <Button
                className="w-full justify-start truncate"
                key={`before-${String(heading.from)}`}
                onClick={() => {
                  onInsertAsHeading(memo.id, heading.from)
                  onOpenChange?.(false)
                }}
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
                onOpenChange?.(false)
              }}
              type="button"
              variant="ghost"
            >
              {flatHeadings.length === 0 ? '先頭に追加' : '末尾に追加'}
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
