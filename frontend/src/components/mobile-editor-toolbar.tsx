import { Button } from '@fohte/ui/button'
import { useRef } from 'react'

import type { MoveBlockInput } from '#article/index'
import {
  BlockMoveMenu,
  type BlockMoveMenuAction,
} from '#components/block-move-menu'

type MobileEditorToolbarProps = {
  onRequest?: (() => void) | undefined
  onShowMemo: () => void
  onShowOutline: () => void
  moveActions: BlockMoveMenuAction[]
  moveMenuOpen: boolean
  onMove: (input: MoveBlockInput) => void
  onMoveMenuOpenChange: (open: boolean) => void
  onUndo: () => void
  onRedo: () => void
}

const toolbarButtonClass = 'h-11 px-3 font-sans text-sm'
const iconButtonClass = 'size-11 font-sans text-muted-foreground-strong'

export function MobileEditorToolbar({
  onRequest,
  onShowMemo,
  onShowOutline,
  moveActions,
  moveMenuOpen,
  onMove,
  onMoveMenuOpenChange,
  onUndo,
  onRedo,
}: MobileEditorToolbarProps) {
  const moveButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <div
      aria-label="入力補助"
      className="flex h-12 shrink-0 items-center border-t border-border bg-card px-1"
      // Keeping focus in the editor keeps the iPhone keyboard open while the writer uses the toolbar.
      onMouseDown={(event) => {
        event.preventDefault()
      }}
      role="toolbar"
    >
      {onRequest ? (
        <Button
          className={toolbarButtonClass}
          onClick={onRequest}
          type="button"
          variant="ghost"
        >
          <span aria-hidden="true" className="font-mono font-bold text-primary">
            &gt;
          </span>
          依頼
        </Button>
      ) : null}
      <Button
        className={toolbarButtonClass}
        onClick={onShowMemo}
        type="button"
        variant="ghost"
      >
        メモ
      </Button>
      <Button
        className={toolbarButtonClass}
        onClick={onShowOutline}
        type="button"
        variant="ghost"
      >
        構成
      </Button>
      <Button
        aria-expanded={moveMenuOpen}
        aria-haspopup="menu"
        className={toolbarButtonClass}
        onClick={() => {
          onMoveMenuOpenChange(!moveMenuOpen)
        }}
        ref={moveButtonRef}
        type="button"
        variant="ghost"
      >
        移動
      </Button>
      <BlockMoveMenu
        actions={moveActions}
        anchor={moveButtonRef}
        onMove={onMove}
        onOpenChange={onMoveMenuOpenChange}
        open={moveMenuOpen}
      />
      <span className="flex-1" />
      <Button
        aria-label="取り消す"
        className={iconButtonClass}
        onClick={onUndo}
        type="button"
        variant="ghost"
      >
        ↶
      </Button>
      <Button
        aria-label="やり直す"
        className={iconButtonClass}
        onClick={onRedo}
        type="button"
        variant="ghost"
      >
        ↷
      </Button>
    </div>
  )
}
