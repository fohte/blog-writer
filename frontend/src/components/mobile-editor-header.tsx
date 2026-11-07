import { Button } from '@fohte/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@fohte/ui/popover'
import type { ReactNode } from 'react'
import { useState } from 'react'

interface MobileEditorMenuItem {
  label: string
  onSelect: () => void
}

type MobileEditorHeaderProps = {
  title: string
  status?: ReactNode
  menuItems: MobileEditorMenuItem[]
  defaultMenuOpen?: boolean
  onBack: () => void
}

export function MobileEditorHeader({
  title,
  status,
  menuItems,
  defaultMenuOpen = false,
  onBack,
}: MobileEditorHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(defaultMenuOpen)

  return (
    <header className="flex h-13 shrink-0 items-center gap-2 border-b border-border px-2">
      <button
        aria-label="記事一覧"
        className="flex size-11 items-center justify-center text-xl"
        onClick={onBack}
        type="button"
      >
        ‹
      </button>
      <span className="min-w-0 flex-1 truncate text-sm font-bold">{title}</span>
      {status}
      <Popover onOpenChange={setMenuOpen} open={menuOpen}>
        <PopoverTrigger
          aria-label="その他"
          className="size-11 text-lg text-muted-foreground-strong"
          type="button"
        >
          ⋯
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="flex min-w-36 flex-col gap-1 p-1"
          role="menu"
        >
          {menuItems.map(({ label, onSelect }) => (
            <Button
              className="h-11 w-full justify-start font-sans text-sm"
              key={label}
              onClick={() => {
                setMenuOpen(false)
                onSelect()
              }}
              role="menuitem"
              type="button"
              variant="ghost"
            >
              {label}
            </Button>
          ))}
        </PopoverContent>
      </Popover>
    </header>
  )
}
