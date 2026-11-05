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

import { adjacentMove, blockStarts, bodyDropInput } from '#outline/block-ranges'
import type { MoveHistory } from '#outline/move-history'

const refreshBlockHandles = StateEffect.define()

class BlockDragHandle extends WidgetType {
  constructor(
    private readonly from: number,
    private readonly history: MoveHistory,
  ) {
    super()
  }

  private cleanup: (() => void) | undefined

  override eq(other: BlockDragHandle): boolean {
    return this.from === other.from && this.history === other.history
  }

  override toDOM(): HTMLElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-block-drag-handle'
    button.setAttribute('aria-label', 'Move block')
    button.textContent = '⠿'
    this.cleanup = draggable({
      element: button,
      getInitialData: () => ({ kind: 'block', from: this.from }),
    })
    return button
  }

  override destroy() {
    this.cleanup?.()
  }
}

function createDecorations(view: EditorView, history: MoveHistory) {
  return Decoration.set(
    blockStarts(view.state, view.viewport.from, view.viewport.to).map((from) =>
      Decoration.widget({
        widget: new BlockDragHandle(from, history),
        side: -1,
      }).range(from),
    ),
  )
}

function createDragPlugin(history: MoveHistory) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      private readonly cleanupDropTarget: () => void
      private composing = false

      constructor(readonly view: EditorView) {
        this.decorations = createDecorations(view, history)
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
        if (this.composing) {
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
        this.decorations = createDecorations(this.view, history)
      }

      startComposition() {
        this.composing = true
      }

      endComposition() {
        this.composing = false
        requestAnimationFrame(() => {
          if (this.view.dom.isConnected) {
            this.view.dispatch({ effects: refreshBlockHandles.of(null) })
          }
        })
      }

      destroy() {
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

function moveAdjacent(history: MoveHistory, direction: 'up' | 'down') {
  return (view: EditorView) => {
    if (view.composing) return true
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
  return [
    Prec.highest(
      keymap.of([
        {
          key: 'Alt-ArrowUp',
          run: moveAdjacent(history, 'up'),
        },
        {
          key: 'Alt-ArrowDown',
          run: moveAdjacent(history, 'down'),
        },
      ]),
    ),
    createDragPlugin(history),
    EditorView.baseTheme({
      '.cm-line': {
        position: 'relative',
        paddingInlineStart: '1.5rem',
      },
      '.cm-block-drag-handle': {
        position: 'absolute',
        left: '0',
        top: '0.1rem',
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
