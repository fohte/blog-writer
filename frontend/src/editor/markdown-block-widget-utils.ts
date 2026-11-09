import type { EditorState } from '@codemirror/state'

export type MarkdownSyntaxNode = {
  firstChild: MarkdownSyntaxNode | null
  nextSibling: MarkdownSyntaxNode | null
  from: number
  name: string
  to: number
}

export function childNodes(node: MarkdownSyntaxNode): MarkdownSyntaxNode[] {
  const children: MarkdownSyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling)
    children.push(child)
  return children
}

export function imageData(state: EditorState, node: MarkdownSyntaxNode) {
  const children = childNodes(node)
  const marks = children.filter((child) => child.name === 'LinkMark')
  const url = children.find((child) => child.name === 'URL')
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
    nodeFrom: node.from,
    source,
    src: state.doc.sliceString(url.from, url.to),
    to: line.to,
  }
}

export function selectionTouches(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return state.selection.ranges.some(({ empty, from: start, to: end }) =>
    empty ? start >= from && start <= to : start < to && end > from,
  )
}
