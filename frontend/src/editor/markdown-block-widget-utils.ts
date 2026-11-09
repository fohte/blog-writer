import type { EditorState } from '@codemirror/state'

import { markdownImageData } from '#markdown/image-data'

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
  return markdownImageData(state.doc, node)
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
