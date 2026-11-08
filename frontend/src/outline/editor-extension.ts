import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
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

import { mountBlockMoveMenu } from '#outline/block-move-menu'
import { adjacentMove, blockStarts, bodyDropInput } from '#outline/block-ranges'
import type { MoveHistory } from '#outline/move-history'

const refreshBlockHandles = StateEffect.define()
const blockHandleCleanups = new WeakMap<HTMLElement, () => void>()

class BlockDragHandle extends WidgetType {
  constructor(
    private readonly from: number,
    private readonly history: MoveHistory,
    private readonly view: EditorView,
    private readonly composingViews: WeakSet<EditorView>,
  ) {
    super()
  }

  override eq(other: BlockDragHandle): boolean {
    return (
      this.history === other.history &&
      this.view === other.view &&
      this.composingViews === other.composingViews
    )
  }

  override toDOM(): HTMLElement {
    const wrapper = document.createElement('span')
    const button = document.createElement('button')
    const menuHost = document.createElement('span')
    button.type = 'button'
    button.className = 'cm-block-drag-handle'
    button.setAttribute('aria-label', 'Move block')
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-expanded', 'false')
    button.textContent = '⠿'
    wrapper.append(button, menuHost)
    blockHandleCleanups.set(
      wrapper,
      mountBlockMoveMenu({
        button,
        composingViews: this.composingViews,
        from: this.from,
        history: this.history,
        host: menuHost,
        view: this.view,
      }),
    )
    return wrapper
  }

  override destroy(dom: HTMLElement) {
    blockHandleCleanups.get(dom)?.()
    blockHandleCleanups.delete(dom)
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
      }).range(Math.max(0, from - 1)),
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
      // Other extensions read this to line their block widgets up with the text after the handle column.
      '.cm-content': {
        '--cm-line-inset': '1.5rem',
      },
      '.cm-content .cm-line': {
        paddingInlineStart: 'var(--cm-line-inset)',
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
