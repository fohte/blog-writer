import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { type Extension, Prec, StateEffect, type Text } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'

import { blockWidgetDecorators } from '#editor/block-widget'
import { refreshBlockWidgetExclusions } from '#editor/markdown-block-widget-exclusions'
import { getBlockWidgetReplaceEnds } from '#editor/markdown-block-widgets'
import { mountBlockMoveHandle } from '#outline/block-move-handle'
import { adjacentMove, blockStarts, bodyDropInput } from '#outline/block-ranges'
import type { MoveHistory } from '#outline/move-history'

const refreshBlockHandles = StateEffect.define()
const blockHandleCleanups = new WeakMap<HTMLElement, () => void>()
const blockStartsByView = new WeakMap<
  EditorView,
  { doc: Text; from: number; to: number; starts: number[] }
>()

function getVisibleBlockStarts(view: EditorView): number[] {
  const { from, to } = view.viewport
  const cached = blockStartsByView.get(view)
  if (
    cached?.doc === view.state.doc &&
    cached.from === from &&
    cached.to === to
  ) {
    return cached.starts
  }

  const starts = blockStarts(view.state, from, to)
  blockStartsByView.set(view, {
    doc: view.state.doc,
    from,
    to,
    starts,
  })
  return starts
}

class BlockDragHandle extends WidgetType {
  constructor(
    private readonly history: MoveHistory,
    private readonly view: EditorView,
    private readonly composingViews: WeakSet<EditorView>,
  ) {
    super()
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof BlockDragHandle &&
      this.history === other.history &&
      this.view === other.view &&
      this.composingViews === other.composingViews
    )
  }

  override toDOM(): HTMLElement {
    const wrapper = document.createElement('span')
    wrapper.className = 'cm-block-drag-handle-wrapper'
    blockHandleCleanups.set(
      wrapper,
      mountBlockMoveHandle({
        composingViews: this.composingViews,
        host: wrapper,
        history: this.history,
        positionDOM: wrapper,
        view: this.view,
      }),
    )
    return wrapper
  }

  override destroy(dom: Node): void {
    if (dom instanceof HTMLElement) {
      blockHandleCleanups.get(dom)?.()
      blockHandleCleanups.delete(dom)
    }
  }
}

function createBlockHandleDecorations(
  view: EditorView,
  history: MoveHistory,
  composingViews: WeakSet<EditorView>,
): DecorationSet {
  const replacedBlocks = getBlockWidgetReplaceEnds(view.state)
  const decorations = getVisibleBlockStarts(view)
    .filter((from) => !replacedBlocks.has(from))
    .map((from) =>
      Decoration.widget({
        widget: new BlockDragHandle(history, view, composingViews),
        side: -1,
      }).range(from),
    )
  return Decoration.set(decorations, true)
}

function attachWidgetHandle(
  element: HTMLElement,
  view: EditorView,
  sourceFrom: number,
  history: MoveHistory,
  composingViews: WeakSet<EditorView>,
): (() => void) | undefined {
  if (!getVisibleBlockStarts(view).includes(sourceFrom)) return undefined

  const host = document.createElement('span')
  host.className = 'cm-markdown-block-widget-handle'
  element.prepend(host)
  return mountBlockMoveHandle({
    composingViews,
    host,
    history,
    positionDOM: element,
    view,
  })
}

function createBlockHandleExtension(
  history: MoveHistory,
  composingViews: WeakSet<EditorView>,
): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(readonly view: EditorView) {
        this.decorations = createBlockHandleDecorations(
          view,
          history,
          composingViews,
        )
      }

      update(update: ViewUpdate): void {
        if (composingViews.has(this.view)) {
          if (update.docChanged)
            this.decorations = this.decorations.map(update.changes)
          return
        }
        const refresh = update.transactions.some((transaction) =>
          transaction.effects.some(
            (effect) =>
              effect.is(refreshBlockHandles) ||
              effect.is(refreshBlockWidgetExclusions),
          ),
        )
        if (
          !update.docChanged &&
          !update.viewportChanged &&
          !update.selectionSet &&
          !refresh
        ) {
          return
        }
        this.decorations = createBlockHandleDecorations(
          this.view,
          history,
          composingViews,
        )
      }
    },
    { decorations: (extension) => extension.decorations },
  )
  return [
    plugin,
    EditorView.domEventHandlers({
      compositionstart: (_event, view) => {
        composingViews.add(view)
        return false
      },
      compositionend: (_event, view) => {
        composingViews.delete(view)
        requestAnimationFrame(() => {
          if (view.dom.isConnected)
            view.dispatch({ effects: refreshBlockHandles.of(null) })
        })
        return false
      },
    }),
  ]
}

function createDragPlugin(
  history: MoveHistory,
  composingViews: WeakSet<EditorView>,
) {
  return ViewPlugin.fromClass(
    class {
      private readonly cleanupDropTarget: () => void
      private readonly preventCompositionShortcut = (event: KeyboardEvent) => {
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

      destroy(): void {
        this.view.contentDOM.removeEventListener(
          'keydown',
          this.preventCompositionShortcut,
          true,
        )
        this.cleanupDropTarget()
      }
    },
  )
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
    blockWidgetDecorators.of((element, view, sourceFrom) =>
      attachWidgetHandle(element, view, sourceFrom, history, composingViews),
    ),
    createBlockHandleExtension(history, composingViews),
    createDragPlugin(history, composingViews),
    EditorView.theme({
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
      '.cm-markdown-block-widget': {
        position: 'relative',
        display: 'flow-root',
        paddingInlineStart: 'var(--cm-line-inset)',
      },
      '.cm-markdown-block-widget-handle': {
        position: 'absolute',
        left: '0',
        top: '0.25rem',
      },
      '.cm-markdown-block-widget-handle .cm-block-drag-handle': {
        position: 'static',
        transform: 'none',
      },
    }),
  ]
}
