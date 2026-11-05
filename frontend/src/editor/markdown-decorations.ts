import { syntaxTree } from '@codemirror/language'
import { type EditorState, StateEffect } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'

const refreshDecorations = StateEffect.define()

function selectionTouches(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return state.selection.ranges.some(
    ({ anchor, head }) =>
      (anchor >= from && anchor <= to) ||
      (head >= from && head <= to) ||
      (Math.min(anchor, head) <= from && Math.max(anchor, head) >= to),
  )
}

function buildDecorations(state: EditorState): DecorationSet {
  const decorations = []
  const cursor = syntaxTree(state).cursor()
  const selected = (from: number, to: number) =>
    selectionTouches(state, from, to)

  while (cursor.next()) {
    if (/^ATXHeading[1-6]$/u.test(cursor.name)) {
      const level = Number(cursor.name.slice('ATXHeading'.length))
      const line = state.doc.lineAt(cursor.from)
      decorations.push(
        Decoration.line({
          class: `cm-md-heading cm-md-heading-${String(level)}`,
        }).range(line.from),
      )
    }

    const isInlineCodeMark =
      cursor.name === 'CodeMark' && cursor.node.parent?.name === 'InlineCode'
    const isHiddenMark =
      cursor.name === 'HeaderMark' ||
      cursor.name === 'EmphasisMark' ||
      cursor.name === 'StrikethroughMark' ||
      cursor.name === 'LinkMark' ||
      isInlineCodeMark

    if (isHiddenMark && !selected(cursor.from, cursor.to)) {
      const to =
        cursor.name === 'HeaderMark' &&
        /^[ \t]$/u.test(state.doc.sliceString(cursor.to, cursor.to + 1))
          ? cursor.to + 1
          : cursor.to
      decorations.push(
        Decoration.replace({ class: 'cm-md-hidden-markup' }).range(
          cursor.from,
          to,
        ),
      )
    }

    if (cursor.name === 'InlineCode') {
      decorations.push(
        Decoration.mark({ class: 'cm-md-inline-code' }).range(
          cursor.from,
          cursor.to,
        ),
      )
    }

    if (cursor.name === 'CodeText') {
      decorations.push(
        Decoration.mark({ class: 'cm-md-code-text' }).range(
          cursor.from,
          cursor.to,
        ),
      )
    }
  }

  return Decoration.set(decorations, true)
}

class MarkdownDecorationPlugin {
  decorations: DecorationSet
  private composing = false

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view.state)
  }

  update(update: ViewUpdate): void {
    if (this.composing) {
      if (update.docChanged)
        this.decorations = this.decorations.map(update.changes)
      return
    }

    if (
      !update.docChanged &&
      !update.selectionSet &&
      !update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(refreshDecorations)),
      )
    )
      return

    this.decorations = buildDecorations(update.state)
  }

  startComposition(): void {
    this.composing = true
  }

  endComposition(view: EditorView): void {
    this.composing = false
    requestAnimationFrame(() => {
      if (view.dom.isConnected) {
        view.dispatch({ effects: refreshDecorations.of(null) })
      }
    })
  }
}

const markdownDecorationPlugin = ViewPlugin.fromClass(
  MarkdownDecorationPlugin,
  {
    decorations: (plugin) => plugin.decorations,
  },
)

export const markdownDecorations = [
  markdownDecorationPlugin,
  EditorView.domEventHandlers({
    compositionstart: (_event, view) => {
      view.plugin(markdownDecorationPlugin)?.startComposition()
      return false
    },
    compositionend: (_event, view) => {
      view.plugin(markdownDecorationPlugin)?.endComposition(view)
      return false
    },
  }),
]
