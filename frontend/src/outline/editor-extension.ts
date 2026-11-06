import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { type Extension, Prec, StateEffect } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { createElement, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'

import type { BlockMoveMenuAction } from '#components/block-move-menu'
import { BlockMoveMenu } from '#components/block-move-menu'
import { adjacentMove, blockStarts, bodyDropInput } from '#outline/block-ranges'
import type { MoveHistory } from '#outline/move-history'

const refreshBlockHandles = StateEffect.define()

class BlockDragHandle extends WidgetType {
  constructor(
    private readonly from: number,
    private readonly history: MoveHistory,
    private readonly view: EditorView,
    private readonly composingViews: WeakSet<EditorView>,
  ) {
    super()
  }

  private cleanup: (() => void) | undefined

  override eq(other: BlockDragHandle): boolean {
    return (
      this.from === other.from &&
      this.history === other.history &&
      this.view === other.view &&
      this.composingViews === other.composingViews
    )
  }

  override toDOM(): HTMLElement {
    const wrapper = document.createElement('span')
    const button = document.createElement('button')
    const menuHost = document.createElement('span')
    const anchor: RefObject<HTMLButtonElement | null> = { current: button }
    let root: Root | undefined
    let menuOpen = false
    let dragStarted = false
    const actions = (): BlockMoveMenuAction[] => [
      {
        label: 'Move up',
        input: adjacentMove(this.view.state, this.from, 'up'),
      },
      {
        label: 'Move down',
        input: adjacentMove(this.view.state, this.from, 'down'),
      },
    ]
    const renderMenu = (open: boolean, sync = false) => {
      menuOpen = open
      button.setAttribute('aria-expanded', String(open))
      root ??= createRoot(menuHost)
      const render = () => {
        root?.render(
          createElement(BlockMoveMenu, {
            actions: actions(),
            anchor,
            onMove: (input) => {
              this.history.move(input, this.view).match(
                () => true,
                () => false,
              )
            },
            onOpenChange: renderMenu,
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
      if (this.view.composing || this.composingViews.has(this.view)) return
      renderMenu(!menuOpen, true)
    }
    button.type = 'button'
    button.className = 'cm-block-drag-handle'
    button.setAttribute('aria-label', 'Move block')
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-expanded', 'false')
    button.textContent = '⠿'
    button.addEventListener('click', handleClick)
    button.addEventListener('mousedown', (event) => {
      event.stopPropagation()
    })
    const cleanupDraggable = draggable({
      element: button,
      getInitialData: () => ({ kind: 'block', from: this.from }),
      onDragStart: () => {
        dragStarted = true
      },
      onDrop: () => {
        window.setTimeout(() => {
          dragStarted = false
        }, 0)
      },
    })
    wrapper.append(button, menuHost)
    this.cleanup = () => {
      cleanupDraggable()
      button.removeEventListener('click', handleClick)
      if (root) queueMicrotask(() => root?.unmount())
    }
    return wrapper
  }

  override destroy() {
    this.cleanup?.()
  }
}

function createDecorations(
  view: EditorView,
  history: MoveHistory,
  composingViews: WeakSet<EditorView>,
) {
  return Decoration.set(
    blockStarts(view.state, view.viewport.from, view.viewport.to).map((from) =>
      Decoration.widget({
        widget: new BlockDragHandle(from, history, view, composingViews),
        side: -1,
      }).range(from),
    ),
  )
}

function createDragPlugin(
  history: MoveHistory,
  composingViews: WeakSet<EditorView>,
) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      private readonly cleanupDropTarget: () => void
      private readonly preventCompositionShortcut = (event: KeyboardEvent) => {
        // Capture these before CodeMirror skips keymaps during composition.
        if (
          composingViews.has(this.view) &&
          event.altKey &&
          (event.key === 'ArrowUp' || event.key === 'ArrowDown')
        ) {
          event.preventDefault()
        }
      }

      constructor(readonly view: EditorView) {
        this.decorations = createDecorations(view, history, composingViews)
        view.contentDOM.addEventListener(
          'keydown',
          this.preventCompositionShortcut,
          true,
        )
        this.cleanupDropTarget = dropTargetForElements({
          element: view.dom,
          canDrop: ({ source, input }) =>
            source.data['kind'] === 'block' &&
            typeof source.data['from'] === 'number' &&
            view.posAtCoords({ x: input.clientX, y: input.clientY }) !== null,
          getData: ({ input }) => ({
            position: view.posAtCoords({
              x: input.clientX,
              y: input.clientY,
            }),
            clientY: input.clientY,
          }),
          onDrop: ({ source, self }) => {
            const from = source.data['from']
            const position = self.data['position']
            const clientY = self.data['clientY']
            if (
              typeof from !== 'number' ||
              typeof position !== 'number' ||
              typeof clientY !== 'number'
            ) {
              return
            }
            const input = bodyDropInput(view, position, clientY, from)
            if (input) {
              const succeeded = history.move(input, view).match(
                () => true,
                () => false,
              )
              if (!succeeded) return
            }
          },
        })
      }

      update(update: ViewUpdate) {
        if (composingViews.has(this.view)) {
          if (update.docChanged)
            this.decorations = this.decorations.map(update.changes)
          return
        }
        if (
          !update.docChanged &&
          !update.viewportChanged &&
          !update.transactions.some((transaction) =>
            transaction.effects.some((effect) =>
              effect.is(refreshBlockHandles),
            ),
          )
        )
          return
        this.decorations = createDecorations(this.view, history, composingViews)
      }

      startComposition() {
        composingViews.add(this.view)
      }

      endComposition() {
        composingViews.delete(this.view)
        requestAnimationFrame(() => {
          if (this.view.dom.isConnected) {
            this.view.dispatch({ effects: refreshBlockHandles.of(null) })
          }
        })
      }

      destroy() {
        this.view.contentDOM.removeEventListener(
          'keydown',
          this.preventCompositionShortcut,
          true,
        )
        this.cleanupDropTarget()
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
  return [
    plugin,
    EditorView.domEventHandlers({
      compositionstart: (_event, view) => {
        view.plugin(plugin)?.startComposition()
        return false
      },
      compositionend: (_event, view) => {
        view.plugin(plugin)?.endComposition()
        return false
      },
    }),
  ]
}

function moveAdjacent(
  history: MoveHistory,
  composingViews: WeakSet<EditorView>,
  direction: 'up' | 'down',
) {
  return (view: EditorView) => {
    if (view.composing || composingViews.has(view)) return true
    const input = adjacentMove(
      view.state,
      view.state.selection.main.head,
      direction,
    )
    if (input) {
      history.move(input, view).match(
        () => true,
        () => true,
      )
    }
    return true
  }
}

export function createOutlineEditorExtension(history: MoveHistory): Extension {
  const composingViews = new WeakSet<EditorView>()
  return [
    Prec.highest(
      keymap.of([
        {
          key: 'Alt-ArrowUp',
          run: moveAdjacent(history, composingViews, 'up'),
        },
        {
          key: 'Alt-ArrowDown',
          run: moveAdjacent(history, composingViews, 'down'),
        },
      ]),
    ),
    createDragPlugin(history, composingViews),
    EditorView.theme({
      '.cm-content .cm-line': {
        paddingInlineStart: '1.5rem',
      },
      '.cm-block-drag-handle': {
        top: '50%',
        transform: 'translateY(-50%)',
      },
    }),
    EditorView.baseTheme({
      '.cm-line': {
        position: 'relative',
      },
      '.cm-block-drag-handle': {
        position: 'absolute',
        left: '0',
        display: 'flex',
        width: '1.5rem',
        height: '1.5rem',
        alignItems: 'center',
        justifyContent: 'center',
        border: '0',
        borderRadius: '0.25rem',
        background: 'transparent',
        color: 'var(--muted-foreground)',
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
      },
      '.cm-block-drag-handle:hover': {
        background: 'var(--accent)',
      },
    }),
  ]
}
