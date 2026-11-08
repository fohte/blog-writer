import { syntaxTree } from '@codemirror/language'
import {
  type EditorState,
  type Extension,
  StateEffect,
  StateField,
} from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'

import { createMarkdownImagePreview } from '#components/markdown-image-preview'
import {
  createMarkdownTablePreview,
  type TableAlignment,
} from '#components/markdown-table-preview'
import { createMermaidPreviewElement } from '#components/mermaid-preview'
import { DomWidget } from '#editor/dom-widget'

const compositionChanged = StateEffect.define<boolean>()
const refreshBlockWidgets = StateEffect.define()

type BlockWidgetState = {
  composing: boolean
  decorations: DecorationSet
}

function selectionTouches(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return state.selection.ranges.some(
    ({ empty, from: selectionFrom, to: selectionTo }) =>
      empty
        ? selectionFrom > from && selectionFrom < to
        : selectionFrom < to && selectionTo > from,
  )
}

function childNodes(node: { firstChild: NodeLike | null }): NodeLike[] {
  const children: NodeLike[] = []
  for (let child = node.firstChild; child; child = child.nextSibling)
    children.push(child)
  return children
}

type NodeLike = {
  firstChild: NodeLike | null
  nextSibling: NodeLike | null
  from: number
  name: string
  to: number
}

function markdownTable(state: EditorState, node: NodeLike) {
  const children = childNodes(node)
  const headerNode = children.find((child) => child.name === 'TableHeader')
  const delimiterNode = children.find(
    (child) => child.name === 'TableDelimiter',
  )
  if (!headerNode || !delimiterNode) return null

  const cellsIn = (row: NodeLike) =>
    childNodes(row)
      .filter((child) => child.name === 'TableCell')
      .map((cell) => state.doc.sliceString(cell.from, cell.to).trim())
  const header = cellsIn(headerNode)
  const delimiter = state.doc.sliceString(delimiterNode.from, delimiterNode.to)
  const delimiterCells = delimiter
    .trim()
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
    .split('|')
  const alignment: TableAlignment[] = header.map((_, index) => {
    const cell = delimiterCells[index]?.trim() ?? ''
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
  const rows = children
    .filter((child) => child.name === 'TableRow')
    .map(cellsIn)

  return { header, alignment, rows }
}

function imageData(state: EditorState, node: NodeLike) {
  const marks = childNodes(node).filter((child) => child.name === 'LinkMark')
  const url = childNodes(node).find((child) => child.name === 'URL')
  const openingMark = marks[0]
  const altEndMark = marks[1]
  if (!openingMark || !altEndMark || marks.length < 4 || !url) return null

  const line = state.doc.lineAt(node.from)
  const source = state.doc.sliceString(line.from, line.to)
  if (source.trim() !== state.doc.sliceString(node.from, node.to)) return null

  return {
    alt: state.doc.sliceString(openingMark.to, altEndMark.from),
    from: line.from,
    lineTo: line.to,
    source,
    src: state.doc.sliceString(url.from, url.to),
    to: line.to,
  }
}

function buildBlockWidgetDecorations(state: EditorState): DecorationSet {
  const decorations = []
  const cursor = syntaxTree(state).cursor()

  while (cursor.next()) {
    if (cursor.name === 'Table') {
      const table = markdownTable(state, cursor.node)
      if (table && !selectionTouches(state, cursor.from, cursor.to)) {
        const identity = `table:${String(cursor.from)}:${state.doc.sliceString(cursor.from, cursor.to)}`
        const widget = new DomWidget(
          () => createMarkdownTablePreview(table),
          identity,
        )
        decorations.push(
          Decoration.replace({ widget, block: true }).range(
            cursor.from,
            cursor.to,
          ),
        )
      }
    }

    if (cursor.name === 'Image') {
      const image = imageData(state, cursor.node)
      if (image) {
        const widget = new DomWidget(
          () =>
            createMarkdownImagePreview({
              alt: image.alt,
              source: image.source,
              src: image.src,
            }),
          `image:${String(image.from)}:${image.source}`,
        )
        if (selectionTouches(state, image.from, image.lineTo)) {
          decorations.push(
            Decoration.widget({ widget, block: true, side: 1 }).range(
              image.lineTo,
            ),
          )
        } else {
          decorations.push(
            Decoration.replace({ widget, block: true }).range(
              image.from,
              image.lineTo,
            ),
          )
        }
      }
    }

    if (cursor.name === 'FencedCode') {
      const codeInfo = childNodes(cursor.node).find(
        (child) => child.name === 'CodeInfo',
      )
      const codeText = childNodes(cursor.node).find(
        (child) => child.name === 'CodeText',
      )
      if (
        codeInfo &&
        codeText &&
        state.doc.sliceString(codeInfo.from, codeInfo.to).trim() === 'mermaid'
      ) {
        const source = state.doc
          .sliceString(codeText.from, codeText.to)
          .trimEnd()
        const diagramId = `markdown-mermaid-${String(cursor.from)}`
        const widget = new DomWidget(
          () => createMermaidPreviewElement(diagramId, source),
          `mermaid:${String(cursor.from)}:${source}`,
        )
        if (selectionTouches(state, cursor.from, cursor.to)) {
          decorations.push(
            Decoration.widget({ widget, block: true, side: 1 }).range(
              cursor.to,
            ),
          )
        } else {
          decorations.push(
            Decoration.replace({ widget, block: true }).range(
              cursor.from,
              cursor.to,
            ),
          )
        }
      }
    }
  }

  return Decoration.set(decorations, true)
}

const blockWidgetStateField = StateField.define<BlockWidgetState>({
  create(state) {
    return { composing: false, decorations: buildBlockWidgetDecorations(state) }
  },
  update(value, transaction) {
    const composition = transaction.effects.find((effect) =>
      effect.is(compositionChanged),
    )
    const refresh = transaction.effects.some((effect) =>
      effect.is(refreshBlockWidgets),
    )
    if (composition?.is(compositionChanged) === true) {
      if (composition.value)
        return {
          composing: true,
          decorations: transaction.docChanged
            ? value.decorations.map(transaction.changes)
            : value.decorations,
        }
      return { composing: false, decorations: value.decorations }
    }
    if (value.composing) {
      return {
        composing: true,
        decorations: transaction.docChanged
          ? value.decorations.map(transaction.changes)
          : value.decorations,
      }
    }
    const selectionChanged = !transaction.startState.selection.eq(
      transaction.state.selection,
    )
    if (!transaction.docChanged && !selectionChanged && !refresh) return value
    return {
      composing: false,
      decorations: buildBlockWidgetDecorations(transaction.state),
    }
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
})

export const markdownBlockWidgets: Extension = [
  blockWidgetStateField,
  EditorView.domEventHandlers({
    compositionstart: (_event, view) => {
      view.dispatch({ effects: compositionChanged.of(true) })
      return false
    },
    compositionend: (_event, view) => {
      view.dispatch({ effects: compositionChanged.of(false) })
      requestAnimationFrame(() => {
        if (view.dom.isConnected)
          view.dispatch({ effects: refreshBlockWidgets.of(null) })
      })
      return false
    },
  }),
]
