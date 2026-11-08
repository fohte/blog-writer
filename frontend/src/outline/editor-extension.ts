import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import {
  type Extension,
  Prec,
  RangeSet,
  StateEffect,
  type Text,
} from '@codemirror/state'
import {
  EditorView,
  gutter,
  GutterMarker,
  keymap,
  ViewPlugin,
} from '@codemirror/view'

import { getBlockWidgetReplaceEnds } from '#editor/markdown-block-widgets'
import { mountBlockMoveMenu } from '#outline/block-move-menu'
import { adjacentMove, blockStarts, bodyDropInput } from '#outline/block-ranges'
import { createAccessibleBlockHandleGutter } from '#outline/editor-extension-accessibility'
import type { MoveHistory } from '#outline/move-history'

const refreshBlockHandles = StateEffect.define()
const blockHandleCleanups = new WeakMap<HTMLElement, () => void>()

class BlockDragHandle extends GutterMarker {
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
    button.type = 'button'
    button.className = 'cm-block-drag-handle'
    button.tabIndex = -1
    button.dataset['blockFrom'] = String(this.from)
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

  override destroy(dom: Node) {
    if (dom instanceof HTMLElement) {
      blockHandleCleanups.get(dom)?.()
      blockHandleCleanups.delete(dom)
    }
  }
}

function createBlockHandleGutter(
  history: MoveHistory,
  composingViews: WeakSet<EditorView>,
) {
  const blockStartsByView = new WeakMap<
    EditorView,
    { doc: Text; from: number; to: number; starts: number[] }
  >()
  const getBlockStarts = (view: EditorView) => {
    const from = view.viewport.from
    const to = view.viewport.to
    const cached = blockStartsByView.get(view)
    if (
      cached?.doc === view.state.doc &&
      cached.from === from &&
      cached.to === to
    ) {
      return cached.starts
    }

    const starts = blockStarts(view.state, from, to)
    blockStartsByView.set(view, { doc: view.state.doc, from, to, starts })
    return starts
  }

  return gutter({
    class: 'cm-block-move-gutter',
    side: 'after',
    markers: (view) => {
      const replacedBlockEnds = getBlockWidgetReplaceEnds(view.state)
      const starts = getBlockStarts(view)
      const markers = starts
        .filter((from) => !replacedBlockEnds.has(from))
        .map((from) =>
          new BlockDragHandle(from, history, view, composingViews).range(from),
        )
      return RangeSet.of(markers, true)
    },
    widgetMarker: (view, _widget, block) => {
      const replaced = getBlockWidgetReplaceEnds(view.state)
      return replaced.has(block.from)
        ? new BlockDragHandle(block.from, history, view, composingViews)
        : null
    },
    lineMarkerChange: (update) =>
      !composingViews.has(update.view) ||
      update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(refreshBlockHandles)),
      ),
  })
}

function createDragPlugin(
  history: MoveHistory,
  composingViews: WeakSet<EditorView>,
) {
  const plugin = ViewPlugin.fromClass(
    class {
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
    createBlockHandleGutter(history, composingViews),
    createAccessibleBlockHandleGutter(),
    createDragPlugin(history, composingViews),
    EditorView.theme({
      // Keep the controls visually on the left while their DOM order follows the body.
      '.cm-scroller > .cm-gutters-after': {
        order: '-1',
        insetInlineStart: '0',
        insetInlineEnd: 'auto',
        borderLeftWidth: '0',
      },
      '.cm-block-move-gutter': {
        flex: '0 0 1.5rem',
        width: '1.5rem',
      },
      '.cm-block-move-gutter .cm-gutterElement': {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0',
      },
    }),
    EditorView.baseTheme({
      '.cm-block-drag-handle': {
        display: 'flex',
        width: '1.5rem',
        height: '1.5rem',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'auto',
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
