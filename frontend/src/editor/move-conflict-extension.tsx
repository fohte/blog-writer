import { type Extension, StateEffect } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { createRoot, type Root } from 'react-dom/client'
import * as Y from 'yjs'

import type { MoveConflict } from '#article/move-conflict-detection'
import {
  getMoveConflicts,
  observeMoveConflicts,
  resolveMoveConflict,
} from '#article/move-conflicts'
import { MoveConflictNotice } from '#components/move-conflict-notice'

const rootsByDOM = new WeakMap<HTMLElement, Root>()
const refreshMoveConflicts = StateEffect.define()

class MoveConflictWidget extends WidgetType {
  constructor(
    readonly doc: Y.Doc,
    readonly conflict: MoveConflict,
    readonly dismiss: (id: string) => void,
  ) {
    super()
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof MoveConflictWidget &&
      this.conflict.id === other.conflict.id &&
      this.conflict.text === other.conflict.text &&
      this.conflict.from === other.conflict.from &&
      this.conflict.to === other.conflict.to &&
      this.conflict.target === other.conflict.target
    )
  }

  override toDOM(): HTMLElement {
    const dom = document.createElement('div')
    dom.className = 'cm-move-conflict-widget'
    const root = createRoot(dom)
    rootsByDOM.set(dom, root)
    root.render(
      <MoveConflictNotice
        onKeep={() => {
          resolveMoveConflict(this.doc, this.conflict.id, 'keep').match(
            () => undefined,
            () => undefined,
          )
          this.dismiss(this.conflict.id)
        }}
        onMove={() => {
          resolveMoveConflict(this.doc, this.conflict.id, 'move').match(
            () => undefined,
            () => undefined,
          )
        }}
        text={this.conflict.text}
      />,
    )
    return dom
  }

  override destroy(dom: HTMLElement): void {
    rootsByDOM.get(dom)?.unmount()
    rootsByDOM.delete(dom)
  }

  override ignoreEvent(): boolean {
    return true
  }
}

function buildDecorations(
  doc: Y.Doc,
  dismissed: Set<string>,
  dismiss: (id: string) => void,
): DecorationSet {
  const decorations = getMoveConflicts(doc).flatMap((conflict) => {
    if (dismissed.has(conflict.id)) return []
    return [
      Decoration.mark({ class: 'cm-move-conflict-range' }).range(
        conflict.from,
        conflict.to,
      ),
      Decoration.widget({
        block: true,
        side: 1,
        widget: new MoveConflictWidget(doc, conflict, dismiss),
      }).range(conflict.to),
    ]
  })
  return Decoration.set(decorations, true)
}

class MoveConflictPlugin {
  decorations: DecorationSet
  private readonly dismissed = new Set<string>()
  private readonly stopObserving: () => void
  private destroyed = false

  constructor(
    private readonly view: EditorView,
    private readonly doc: Y.Doc,
  ) {
    this.stopObserving = observeMoveConflicts(doc, () => {
      queueMicrotask(() => {
        if (!this.destroyed) this.refresh()
      })
    })
    this.decorations = buildDecorations(doc, this.dismissed, (id) => {
      this.dismissed.add(id)
      this.refresh()
    })
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(refreshMoveConflicts)),
      )
    ) {
      this.decorations = buildDecorations(this.doc, this.dismissed, (id) => {
        this.dismissed.add(id)
        this.refresh()
      })
    }
  }

  destroy(): void {
    this.destroyed = true
    this.stopObserving()
  }

  private refresh(): void {
    this.view.dispatch({ effects: refreshMoveConflicts.of(null) })
  }
}

const moveConflictPlugin = (doc: Y.Doc) =>
  ViewPlugin.define((view) => new MoveConflictPlugin(view, doc), {
    decorations: (plugin) => plugin.decorations,
  })

export function moveConflictExtension(doc: Y.Doc): Extension {
  return [
    moveConflictPlugin(doc),
    EditorView.baseTheme({
      '.cm-move-conflict-range': {
        backgroundColor:
          'color-mix(in srgb, var(--color-amber-500) 20%, transparent)',
        textDecoration: 'underline wavy var(--color-amber-700)',
      },
      '.cm-move-conflict-widget': {
        whiteSpace: 'normal',
      },
    }),
  ]
}
