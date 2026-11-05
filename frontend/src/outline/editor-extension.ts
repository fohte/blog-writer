import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import type { Extension } from '@codemirror/state'
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
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
    })
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
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      private readonly cleanupDropTarget: () => void

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
        if (update.docChanged || update.viewportChanged) {
          this.decorations = createDecorations(this.view, history)
        }
      }

      destroy() {
        this.cleanupDropTarget()
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
}

function moveAdjacent(history: MoveHistory, direction: 'up' | 'down') {
  return (view: EditorView) => {
    const input = adjacentMove(
      view.state,
      view.state.selection.main.head,
      direction,
    )
    if (!input) return false
    return history.move(input, view).match(
      () => true,
      () => false,
    )
  }
}

export function createOutlineEditorExtension(history: MoveHistory): Extension {
  return [
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
    createDragPlugin(history),
    EditorView.baseTheme({
      '.cm-line': { position: 'relative' },
      '.cm-block-drag-handle': {
        position: 'absolute',
        left: '-1.5rem',
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
      },
      '.cm-block-drag-handle:hover': {
        background: 'var(--accent)',
      },
    }),
  ]
}
