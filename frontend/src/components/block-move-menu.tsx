import { Button } from '@fohte/ui/button'
import { Popover, PopoverContent } from '@fohte/ui/popover'
import type { RefObject } from 'react'

import type { MoveBlockInput } from '#article/index'

export interface BlockMoveMenuAction {
  label: string
  input?: MoveBlockInput | undefined
}

export interface BlockMoveMenuProps {
  anchor: RefObject<HTMLButtonElement | null>
  actions: BlockMoveMenuAction[]
  open: boolean
  onMove: (input: MoveBlockInput) => void
  onOpenChange: (open: boolean) => void
}

export function BlockMoveMenu({
  anchor,
  actions,
  open,
  onMove,
  onOpenChange,
}: BlockMoveMenuProps) {
  return (
    <Popover anchor={anchor} onOpenChange={onOpenChange} open={open}>
      <PopoverContent
        className="flex min-w-36 flex-col gap-1 p-1"
        onClick={(event) => {
          event.stopPropagation()
        }}
        role="menu"
      >
        {actions.map(({ input, label }) => (
          <Button
            className="w-full justify-start"
            disabled={input === undefined}
            key={label}
            onClick={() => {
              if (input !== undefined) onMove(input)
              onOpenChange(false)
            }}
            role="menuitem"
            size="sm"
            variant="ghost"
          >
            {label}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
