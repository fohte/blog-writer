import { Button } from '@fohte/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@fohte/ui/popover'
import { useState } from 'react'

import { TRASH_RETENTION_DAYS } from '#article/constants'

export interface ArticleRowMenuProps {
  defaultOpen?: boolean | undefined
  onDuplicate: () => void
  onTrash: () => void
}

export function ArticleRowMenu({
  defaultOpen = false,
  onDuplicate,
  onTrash,
}: ArticleRowMenuProps) {
  const [open, setOpen] = useState(defaultOpen)
  const items = [
    { label: '複製', onSelect: onDuplicate },
    { label: 'ゴミ箱へ移す', onSelect: onTrash },
  ]

  return (
    <Popover onOpenChange={setOpen} open={open}>
      {/* `relative` lifts it above the pseudo-element that makes the whole row open the article. */}
      <PopoverTrigger
        aria-label="記事の操作"
        className="relative border border-muted-foreground-strong px-2 text-sm pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        type="button"
      >
        ⋯
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-55 flex-col gap-1 p-1"
        role="menu"
      >
        {items.map(({ label, onSelect }) => (
          <Button
            className="w-full justify-start font-sans text-sm pointer-coarse:h-11"
            key={label}
            onClick={() => {
              setOpen(false)
              onSelect()
            }}
            role="menuitem"
            type="button"
            variant="ghost"
          >
            {label}
          </Button>
        ))}
        <p className="px-2.5 pt-1 pb-2 text-xs leading-relaxed text-muted-foreground-strong">
          {TRASH_RETENTION_DAYS} 日後に消えます。それまではゴミ箱から戻せます。
        </p>
      </PopoverContent>
    </Popover>
  )
}
