import type { EditorView } from '@codemirror/view'
import { useState } from 'react'

import { MobileEditorToolbar } from '#components/mobile-editor-toolbar'
import { blockMoveActions, type MoveHistory } from '#outline/index'

type ArticleEditorMobileToolbarProps = {
  view: EditorView
  history: MoveHistory
  onRequest?: (() => void) | undefined
  onShowMemo: () => void
  onShowOutline: () => void
}

const ignore = () => undefined

export function ArticleEditorMobileToolbar({
  view,
  history,
  onRequest,
  onShowMemo,
  onShowOutline,
}: ArticleEditorMobileToolbarProps) {
  const [moveMenuOpen, setMoveMenuOpen] = useState(false)
  const cursor = () => view.state.selection.main.head

  return (
    <MobileEditorToolbar
      moveActions={moveMenuOpen ? blockMoveActions(view, cursor(), cursor) : []}
      moveMenuOpen={moveMenuOpen}
      onMove={(input) => {
        history.move(input, view).match(ignore, ignore)
      }}
      onMoveMenuOpenChange={setMoveMenuOpen}
      onRedo={() => {
        history.redo(view).match(ignore, ignore)
      }}
      onRequest={onRequest}
      onShowMemo={onShowMemo}
      onShowOutline={onShowOutline}
      onUndo={() => {
        history.undo(view).match(ignore, ignore)
      }}
    />
  )
}
