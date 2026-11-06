import { draggable } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { EditorView } from '@codemirror/view'
import { createElement, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'

import type { BlockMoveMenuAction } from '#components/block-move-menu'
import { BlockMoveMenu } from '#components/block-move-menu'
import { adjacentMove } from '#outline/block-ranges'
import type { MoveHistory } from '#outline/move-history'

export function mountBlockMoveMenu({
  button,
  composingViews,
  from,
  history,
  host,
  view,
}: {
  button: HTMLButtonElement
  composingViews: WeakSet<EditorView>
  from: number
  history: MoveHistory
  host: HTMLElement
  view: EditorView
}): () => void {
  const anchor: RefObject<HTMLButtonElement | null> = { current: button }
  let root: Root | undefined
  let menuOpen = false
  let dragStarted = false
  const actions = (): BlockMoveMenuAction[] => [
    {
      label: 'Move up',
      input: adjacentMove(view.state, from, 'up'),
    },
    {
      label: 'Move down',
      input: adjacentMove(view.state, from, 'down'),
    },
  ]
  const renderMenu = (open: boolean, sync = false) => {
    menuOpen = open
    button.setAttribute('aria-expanded', String(open))
    root ??= createRoot(host)
    const render = () => {
      root?.render(
        createElement(BlockMoveMenu, {
          actions: actions(),
          anchor,
          onMove: (input) => {
            history.move(input, view).match(
              () => true,
              () => false,
            )
          },
          onOpenChange: (nextOpen) => {
            renderMenu(nextOpen)
          },
          open,
        }),
      )
    }
    if (sync) flushSync(render)
    else render()
  }
  const handleClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (dragStarted) {
      dragStarted = false
      return
    }
    if (view.composing || composingViews.has(view)) return
    renderMenu(!menuOpen, true)
  }
  const handleMouseDown = (event: MouseEvent) => {
    event.stopPropagation()
  }
  button.addEventListener('click', handleClick)
  button.addEventListener('mousedown', handleMouseDown)
  const cleanupDraggable = draggable({
    element: button,
    getInitialData: () => ({ kind: 'block', from }),
    onDragStart: () => {
      dragStarted = true
    },
    onDrop: () => {
      window.setTimeout(() => {
        dragStarted = false
      }, 0)
    },
  })

  return () => {
    cleanupDraggable()
    button.removeEventListener('click', handleClick)
    button.removeEventListener('mousedown', handleMouseDown)
    if (root) queueMicrotask(() => root?.unmount())
  }
}
