import { type Extension, StateEffect, StateField } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view'
import { createRoot, type Root } from 'react-dom/client'
import * as Y from 'yjs'

import { deriveHeadingTree } from '#article/headings'
import type { MoveConflict } from '#article/move-conflict-detection'
import {
  type MoveConflictDestination,
  moveConflictDestination,
} from '#article/move-conflict-headings'
import {
  getMoveConflicts,
  observeMoveConflicts,
  resolveMoveConflict,
} from '#article/move-conflicts'
import { MoveConflictNotice } from '#components/move-conflict-notice'
import {
  blockWidgetExclusionProviders,
  refreshBlockWidgetExclusions,
} from '#editor/markdown-block-widget-exclusions'

const rootsByDOM = new WeakMap<HTMLElement, Root>()
const viewsByDoc = new WeakMap<Y.Doc, Set<() => void>>()
const refreshMoveConflicts = StateEffect.define()

class MoveConflictWidget extends WidgetType {
  constructor(
    readonly doc: Y.Doc,
    readonly conflict: MoveConflict,
    readonly destination: MoveConflictDestination | undefined,
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
      this.conflict.target === other.conflict.target &&
      this.destination?.section === other.destination?.section &&
      this.destination?.parent === other.destination?.parent
    )
  }

  override toDOM(): HTMLElement {
    const dom = document.createElement('div')
    dom.className = 'cm-move-conflict-widget'
    const root = createRoot(dom)
    rootsByDOM.set(dom, root)
    const render = (status?: string) => {
      root.render(
        <MoveConflictNotice
          destination={this.destination}
          onKeep={() => {
            resolveMoveConflict(this.doc, this.conflict.id, 'keep').match(
              () => {
                refreshViews(this.doc)
              },
              () => {
                render(
                  '選択を反映する前にこの文が変わりました。変わった文を確認してください。',
                )
              },
            )
          }}
          onMove={() => {
            resolveMoveConflict(this.doc, this.conflict.id, 'move').match(
              () => {
                refreshViews(this.doc)
              },
              () => {
                render(
                  '選択を反映する前にこの文が変わりました。変わった文を確認してください。',
                )
              },
            )
          }}
          text={this.conflict.text}
          {...(status === undefined ? {} : { status })}
        />,
      )
    }
    render()
    return dom
  }

  override destroy(dom: HTMLElement): void {
    const root = rootsByDOM.get(dom)
    rootsByDOM.delete(dom)
    if (root)
      queueMicrotask(() => {
        root.unmount()
      })
  }

  override ignoreEvent(): boolean {
    return true
  }
}

function refreshViews(doc: Y.Doc): void {
  for (const refresh of viewsByDoc.get(doc) ?? []) refresh()
}

function buildDecorations(doc: Y.Doc): DecorationSet {
  const conflicts = getMoveConflicts(doc)
  const headings =
    conflicts.length === 0
      ? []
      : deriveHeadingTree(doc.getText('body').toJSON())
  const decorations = conflicts.flatMap((conflict) => {
    return [
      Decoration.mark({ class: 'cm-move-conflict-range' }).range(
        conflict.from,
        conflict.to,
      ),
      Decoration.widget({
        block: true,
        side: 1,
        widget: new MoveConflictWidget(
          doc,
          conflict,
          moveConflictDestination(headings, conflict.target),
        ),
      }).range(conflict.to),
    ]
  })
  return Decoration.set(decorations, true)
}

function moveConflictStateField(doc: Y.Doc) {
  return StateField.define({
    create: () => buildDecorations(doc),
    update: (value, transaction) => {
      if (transaction.effects.some((effect) => effect.is(refreshMoveConflicts)))
        return buildDecorations(doc)
      return value.map(transaction.changes)
    },
    provide: (field) => EditorView.decorations.from(field),
  })
}

class MoveConflictObserver {
  private readonly stopObserving: () => void
  private readonly refresh: () => void
  private readonly body: Y.Text
  private destroyed = false
  private refreshScheduled = false

  constructor(
    private readonly view: EditorView,
    private readonly doc: Y.Doc,
  ) {
    this.refresh = () => {
      if (!this.destroyed)
        this.view.dispatch({
          effects: [
            refreshMoveConflicts.of(null),
            refreshBlockWidgetExclusions.of(null),
          ],
        })
    }
    this.body = doc.getText('body')
    this.body.observe(this.onBodyChange)
    const views = viewsByDoc.get(doc) ?? new Set<() => void>()
    views.add(this.refresh)
    viewsByDoc.set(doc, views)
    this.stopObserving = observeMoveConflicts(doc, this.scheduleRefresh)
  }

  destroy(): void {
    this.destroyed = true
    this.body.unobserve(this.onBodyChange)
    this.stopObserving()
    const views = viewsByDoc.get(this.doc)
    views?.delete(this.refresh)
    if (views?.size === 0) viewsByDoc.delete(this.doc)
  }

  private readonly onBodyChange = () => {
    this.scheduleRefresh()
  }

  private readonly scheduleRefresh = () => {
    if (this.destroyed || this.refreshScheduled) return
    this.refreshScheduled = true
    queueMicrotask(() => {
      this.refreshScheduled = false
      this.refresh()
    })
  }
}

const moveConflictPlugin = (doc: Y.Doc) =>
  ViewPlugin.define((view) => new MoveConflictObserver(view, doc))

export function moveConflictExtension(doc: Y.Doc): Extension {
  return [
    moveConflictStateField(doc),
    moveConflictPlugin(doc),
    blockWidgetExclusionProviders.of((state) =>
      getMoveConflicts(doc).map(({ from, to }) => ({
        from: Math.min(from, state.doc.length),
        to: Math.min(to, state.doc.length),
      })),
    ),
    EditorView.baseTheme({
      '.cm-move-conflict-range': {
        textDecoration: 'underline dashed var(--muted-foreground)',
      },
      '.cm-move-conflict-widget': {
        whiteSpace: 'normal',
      },
    }),
  ]
}
