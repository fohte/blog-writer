import { draggable } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { EditorView } from '@codemirror/view'
import { createElement, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'

import { BlockMoveMenu } from '#components/block-move-menu'
import { blockMoveActions } from '#outline/block-move-actions'
import { blockStarts } from '#outline/block-ranges'
import type { MoveHistory } from '#outline/move-history'

export function mountBlockMoveMenu({
  button,
  composingViews,
  history,
  host,
  positionDOM,
  sourceFrom,
  view,
}: {
  button: HTMLButtonElement
  composingViews: WeakSet<EditorView>
  history: MoveHistory
  host: HTMLElement
  positionDOM: HTMLElement
  sourceFrom?: number
  view: EditorView
}): () => void {
  const anchor: RefObject<HTMLButtonElement | null> = { current: button }
  let root: Root | undefined
  let menuOpen = false
  const currentFrom = () => {
    if (!view.dom.contains(positionDOM)) return undefined
    const starts = blockStarts(view.state)
    if (sourceFrom !== undefined)
      return starts.includes(sourceFrom) ? sourceFrom : undefined

    const position = view.posAtDOM(positionDOM, -1)
    return (
      starts.find((from) => from === position) ??
      starts.filter((from) => from < position).at(-1)
    )
  }
  const actions = () => {
    const position = currentFrom()
    return position === undefined
      ? []
      : blockMoveActions(view, position, currentFrom)
  }
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
    if (
      view.composing ||
      composingViews.has(view) ||
      currentFrom() === undefined
    )
      return
    renderMenu(!menuOpen, true)
  }
  const handleMouseDown = (event: MouseEvent) => {
    event.stopPropagation()
  }
  const handlePointerDown = (event: PointerEvent) => {
    event.stopPropagation()
  }
  button.addEventListener('click', handleClick)
  button.addEventListener('mousedown', handleMouseDown)
  button.addEventListener('pointerdown', handlePointerDown)
  const cleanupDraggable = draggable({
    element: button,
    getInitialData: () => {
      const from = currentFrom()
      return from === undefined ? { kind: 'block' } : { kind: 'block', from }
    },
  })

  return () => {
    cleanupDraggable()
    button.removeEventListener('click', handleClick)
    button.removeEventListener('mousedown', handleMouseDown)
    button.removeEventListener('pointerdown', handlePointerDown)
    if (root) queueMicrotask(() => root?.unmount())
  }
}
