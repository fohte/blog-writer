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

function selectionIntersects(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return state.selection.ranges.some((range) =>
    range.empty
      ? range.from > from && range.from < to
      : range.from < to && range.to > from,
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

    if (cursor.name === 'Link') {
      let destinationFrom: number | undefined
      let destinationTo: number | undefined
      for (
        let child = cursor.node.firstChild;
        child;
        child = child.nextSibling
      ) {
        if (child.name !== 'LinkMark') continue
        const mark = state.doc.sliceString(child.from, child.to)
        if (mark === '(') destinationFrom = child.from
        if (mark === ')' && destinationFrom !== undefined)
          destinationTo = child.to
      }

      if (
        destinationFrom !== undefined &&
        destinationTo !== undefined &&
        !selectionIntersects(state, cursor.from, cursor.to)
      ) {
        decorations.push(
          Decoration.replace({ class: 'cm-md-hidden-markup' }).range(
            destinationFrom,
            destinationTo,
          ),
        )
      }
    }

    const isInlineCodeMark =
      cursor.name === 'CodeMark' && cursor.node.parent?.name === 'InlineCode'
    const parentLink =
      cursor.name === 'LinkMark' && cursor.node.parent?.name === 'Link'
        ? cursor.node.parent
        : null
    const isLinkMark = parentLink !== null
    const isLinkParenthesis =
      isLinkMark &&
      ['(', ')'].includes(state.doc.sliceString(cursor.from, cursor.to))
    const isActiveLink =
      parentLink !== null &&
      selectionIntersects(state, parentLink.from, parentLink.to)
    const isHiddenMark =
      cursor.name === 'HeaderMark' ||
      cursor.name === 'EmphasisMark' ||
      cursor.name === 'StrikethroughMark' ||
      cursor.name === 'LinkMark' ||
      isInlineCodeMark
    const markupParent = cursor.node.parent
    const isEditableMarkup =
      markupParent !== null &&
      ((cursor.name === 'HeaderMark' &&
        /^ATXHeading[1-6]$/u.test(markupParent.name)) ||
        cursor.name === 'EmphasisMark' ||
        cursor.name === 'StrikethroughMark' ||
        isInlineCodeMark) &&
      selectionIntersects(state, markupParent.from, markupParent.to)

    if (
      isHiddenMark &&
      !selected(cursor.from, cursor.to) &&
      !isEditableMarkup &&
      !isLinkParenthesis &&
      !(isLinkMark && isActiveLink)
    ) {
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
