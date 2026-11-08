import { EditorView } from '@codemirror/view'

import { mountBlockMoveMenu } from '#outline/block-move-menu'
import type { MoveHistory } from '#outline/move-history'

export function mountBlockMoveHandle({
  composingViews,
  host,
  history,
  positionDOM,
  sourceFrom,
  view,
}: {
  composingViews: WeakSet<EditorView>
  host: HTMLElement
  history: MoveHistory
  positionDOM: HTMLElement
  sourceFrom?: number
  view: EditorView
}): () => void {
  const button = document.createElement('button')
  const menuHost = document.createElement('span')
  button.type = 'button'
  button.className = 'cm-block-drag-handle'
  button.setAttribute('aria-label', 'Move block')
  button.setAttribute('aria-haspopup', 'menu')
  button.setAttribute('aria-expanded', 'false')
  button.textContent = '⠿'
  host.append(button, menuHost)
  return mountBlockMoveMenu({
    button,
    composingViews,
    history,
    host: menuHost,
    positionDOM,
    ...(sourceFrom === undefined ? {} : { sourceFrom }),
    view,
  })
}
