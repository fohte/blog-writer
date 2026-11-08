import { syntaxTree } from '@codemirror/language'
import {
  type EditorState,
  type Extension,
  Prec,
  StateEffect,
  StateField,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
} from '@codemirror/view'

import { createMarkdownImagePreview } from '#components/markdown-image-preview'
import {
  createMarkdownTablePreview,
  type TableAlignment,
} from '#components/markdown-table-preview'
import { createMermaidPreviewElement } from '#components/mermaid-preview'
import { DomWidget } from '#editor/dom-widget'
import {
  type BlockWidgetExclusionRange,
  collectBlockWidgetExclusions,
  equalBlockWidgetExclusionRanges,
  isBlockWidgetExcluded,
  refreshBlockWidgetExclusions,
} from '#editor/markdown-block-widget-exclusions'

const compositionChanged = StateEffect.define<boolean>()
const refreshBlockWidgets = StateEffect.define()

type BlockWidgetState = {
  composing: boolean
  decorations: DecorationSet
  exclusions: BlockWidgetExclusionRange[]
  ranges: BlockSourceRange[]
}

type BlockSourceRange = { from: number; to: number }

function selectionTouches(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return state.selection.ranges.some(
    ({ empty, from: selectionFrom, to: selectionTo }) =>
      empty
        ? selectionFrom >= from && selectionFrom <= to
        : selectionFrom < to && selectionTo > from,
  )
}

function mapRanges(
  ranges: readonly BlockSourceRange[],
  changes: Parameters<DecorationSet['map']>[0],
): BlockSourceRange[] {
  return ranges.map(({ from, to }) => ({
    from: changes.mapPos(from, 1),
    to: changes.mapPos(to, -1),
  }))
}

function createBlockWidget(
  createElement: (view: EditorView) => HTMLElement,
  identity: string,
): DomWidget {
  return new DomWidget((view) => {
    const element = createElement(view)
    const enterSource = (event: Event) => {
      const target = event.target
      if (target instanceof Element && target.closest('a')) {
        event.stopPropagation()
        return
      }

      event.preventDefault()
      event.stopPropagation()
      const first = view.posAtDOM(element, -1)
      const last = view.posAtDOM(element, 1)
      const from = Math.min(first, last)
      const to = Math.max(first, last)
      view.focus()
      view.dispatch({
        selection: { anchor: Math.min(from + 1, to) },
        scrollIntoView: true,
      })
    }
    element.addEventListener('mousedown', (event) => {
      event.stopPropagation()
    })
    element.addEventListener('click', enterSource)
    return element
  }, identity)
}

function enterAdjacentBlock(direction: 'up' | 'down') {
  return (view: EditorView): boolean => {
    const state = view.state
    if (
      view.composing ||
      state.field(blockWidgetStateField).composing ||
      !state.selection.main.empty
    ) {
      return false
    }

    const { head } = state.selection.main
    const ranges = state.field(blockWidgetStateField).ranges
    const orderedRanges = direction === 'down' ? ranges : [...ranges].reverse()
    const adjacent = orderedRanges.find((range) => {
      if (direction === 'down' && range.from >= head) {
        return state.doc.sliceString(head, range.from).trim().length === 0
      }
      if (direction === 'up' && range.to <= head) {
        return state.doc.sliceString(range.to, head).trim().length === 0
      }
      return false
    })
    if (!adjacent) return false

    const position = direction === 'down' ? adjacent.from + 1 : adjacent.to - 1
    view.dispatch({
      selection: { anchor: position },
      scrollIntoView: true,
    })
    return true
  }
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

let nextMermaidWidgetId = 0

type BuiltBlockWidgets = {
  decorations: DecorationSet
  ranges: BlockSourceRange[]
}

function buildBlockWidgetDecorations(
  state: EditorState,
  exclusions: readonly BlockWidgetExclusionRange[],
): BuiltBlockWidgets {
  const decorations = []
  const ranges: BlockSourceRange[] = []
  const cursor = syntaxTree(state).cursor()

  while (cursor.next()) {
    if (cursor.name === 'Table') {
      const table = markdownTable(state, cursor.node)
      const range = { from: cursor.from, to: cursor.to }
      if (
        table &&
        !selectionTouches(state, range.from, range.to) &&
        !isBlockWidgetExcluded(range, exclusions)
      ) {
        const source = state.doc.sliceString(range.from, range.to)
        const widget = createBlockWidget(
          () => createMarkdownTablePreview(table),
          'table:' + source,
        )
        decorations.push(
          Decoration.replace({
            widget,
            block: true,
          }).range(range.from, range.to),
        )
        ranges.push(range)
      }
    }

    if (cursor.name === 'Image') {
      const image = imageData(state, cursor.node)
      if (image) {
        const range = { from: image.from, to: image.lineTo }
        const excluded = isBlockWidgetExcluded(range, exclusions)
        if (excluded) continue
        const widget = createBlockWidget(
          () =>
            createMarkdownImagePreview({
              alt: image.alt,
              source: image.source,
              src: image.src,
            }),
          'image:' + image.source,
        )
        if (selectionTouches(state, range.from, range.to)) {
          decorations.push(
            Decoration.widget({ widget, block: true, side: 1 }).range(
              image.lineTo,
            ),
          )
        } else {
          decorations.push(
            Decoration.replace({
              widget,
              block: true,
            }).range(image.from, image.lineTo),
          )
          ranges.push(range)
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
        const range = { from: cursor.from, to: cursor.to }
        const excluded = isBlockWidgetExcluded(range, exclusions)
        if (excluded) continue
        const diagramId = 'markdown-mermaid-' + String(nextMermaidWidgetId++)
        const widget = createBlockWidget((view) => {
          const refreshMeasurements = () => {
            view.requestMeasure()
          }
          return createMermaidPreviewElement(
            { id: diagramId, source },
            refreshMeasurements,
          )
        }, 'mermaid:' + source)
        if (selectionTouches(state, range.from, range.to)) {
          decorations.push(
            Decoration.widget({ widget, block: true, side: 1 }).range(
              cursor.to,
            ),
          )
        } else {
          decorations.push(
            Decoration.replace({
              widget,
              block: true,
            }).range(cursor.from, cursor.to),
          )
          ranges.push(range)
        }
      }
    }
  }

  return { decorations: Decoration.set(decorations, true), ranges }
}

const blockWidgetStateField = StateField.define<BlockWidgetState>({
  create(state) {
    const exclusions = collectBlockWidgetExclusions(state)
    const built = buildBlockWidgetDecorations(state, exclusions)
    return { composing: false, ...built, exclusions }
  },
  update(value, transaction) {
    const composition = transaction.effects.find((effect) =>
      effect.is(compositionChanged),
    )
    const refresh = transaction.effects.some(
      (effect) =>
        effect.is(refreshBlockWidgets) ||
        effect.is(refreshBlockWidgetExclusions),
    )
    if (composition?.is(compositionChanged) === true) {
      if (composition.value)
        return {
          composing: true,
          decorations: transaction.docChanged
            ? value.decorations.map(transaction.changes)
            : value.decorations,
          exclusions: transaction.docChanged
            ? mapRanges(value.exclusions, transaction.changes)
            : value.exclusions,
          ranges: transaction.docChanged
            ? mapRanges(value.ranges, transaction.changes)
            : value.ranges,
        }
      return { ...value, composing: false }
    }
    if (value.composing) {
      return {
        composing: true,
        decorations: transaction.docChanged
          ? value.decorations.map(transaction.changes)
          : value.decorations,
        exclusions: transaction.docChanged
          ? mapRanges(value.exclusions, transaction.changes)
          : value.exclusions,
        ranges: transaction.docChanged
          ? mapRanges(value.ranges, transaction.changes)
          : value.ranges,
      }
    }
    const selectionChanged = !transaction.startState.selection.eq(
      transaction.state.selection,
    )
    const treeChanged =
      syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
    const exclusions = collectBlockWidgetExclusions(transaction.state)
    const exclusionsChanged = !equalBlockWidgetExclusionRanges(
      value.exclusions,
      exclusions,
    )
    if (
      !transaction.docChanged &&
      !selectionChanged &&
      !refresh &&
      !treeChanged &&
      !exclusionsChanged
    ) {
      return value
    }
    const built = buildBlockWidgetDecorations(transaction.state, exclusions)
    return {
      composing: false,
      ...built,
      exclusions,
    }
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
})

export const markdownBlockWidgets: Extension = [
  blockWidgetStateField,
  Prec.highest(
    keymap.of([
      { key: 'ArrowDown', run: enterAdjacentBlock('down') },
      { key: 'ArrowUp', run: enterAdjacentBlock('up') },
    ]),
  ),
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

export function getBlockWidgetReplaceEnds(
  state: EditorState,
): ReadonlyMap<number, number> {
  const ranges = state.field(blockWidgetStateField, false)?.ranges ?? []
  return new Map(ranges.map(({ from, to }) => [from, to]))
}
