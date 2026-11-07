import { draggable } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { EditorView } from '@codemirror/view'
import { createElement, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'

import { type MoveBlockInput, topLevelBlocks } from '#article/index'
import type { BlockMoveMenuAction } from '#components/block-move-menu'
import { BlockMoveMenu } from '#components/block-move-menu'
import { adjacentMove, headingChildMove } from '#outline/block-ranges'
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
  const currentFrom = () =>
    view.contentDOM.contains(button) ? view.posAtDOM(button) : undefined
  const actions = (): BlockMoveMenuAction[] => {
    const currentPosition = currentFrom() ?? from
    const markdown = view.state.doc.toString()
    const block = topLevelBlocks(markdown).find(
      ({ from: blockFrom, to }) =>
        blockFrom <= currentPosition && currentPosition < to,
    )
    const isHeading = block?.name.startsWith('ATXHeading') ?? false
    const action = (
      label: string,
      getInput: (position: number) => MoveBlockInput | undefined,
    ): BlockMoveMenuAction => ({
      label,
      input: getInput(currentPosition),
      resolveInput: () => {
        const position = currentFrom()
        return position === undefined ? undefined : getInput(position)
      },
    })

    return [
      action('Move up', (position) => adjacentMove(view.state, position, 'up')),
      action('Move down', (position) =>
        adjacentMove(view.state, position, 'down'),
      ),
      ...(isHeading
        ? [
            action('Make child', (position) =>
              headingChildMove(view.state, position),
            ),
          ]
        : []),
    ]
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
  })

  return () => {
    cleanupDraggable()
    button.removeEventListener('click', handleClick)
    button.removeEventListener('mousedown', handleMouseDown)
    if (root) queueMicrotask(() => root?.unmount())
  }
}
