import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

import type { MoveBlockInput } from '#article/index'
import {
  deriveHeadingTree,
  findMoveBlockRange,
  topLevelBlocks,
} from '#article/index'
import type { Heading } from '#article/types'

function siblingsAt(
  headings: Heading[],
  from: number,
): { siblings: Heading[]; index: number } | undefined {
  for (const heading of headings) {
    if (heading.from === from) {
      return { siblings: headings, index: headings.indexOf(heading) }
    }
    const nested = siblingsAt(heading.children, from)
    if (nested) return nested
  }
  return undefined
}

function headingBlockAt(markdown: string, position: number) {
  return topLevelBlocks(markdown).find(
    ({ from, to }) => from <= position && position < to,
  )
}

function isHeadingBlock(block: ReturnType<typeof headingBlockAt>): boolean {
  return block?.name.startsWith('ATXHeading') === true
}

export function isHeadingBlockAt(
  state: EditorState,
  position: number,
): boolean {
  return isHeadingBlock(headingBlockAt(state.doc.toString(), position))
}

export function adjacentMove(
  state: EditorState,
  from: number,
  direction: 'up' | 'down',
): MoveBlockInput | undefined {
  const markdown = state.doc.toString()
  const range = findMoveBlockRange(markdown, from)
  if (!range) return undefined

  if (range.headingLevel !== undefined) {
    const siblings = siblingsAt(deriveHeadingTree(markdown), range.from)
    const sibling =
      direction === 'up'
        ? siblings?.siblings[siblings.index - 1]
        : siblings?.siblings[siblings.index + 1]
    if (!sibling) return undefined
    const destination =
      direction === 'up'
        ? sibling.from
        : findMoveBlockRange(markdown, sibling.from)?.to
    return destination === undefined
      ? undefined
      : { from: range.from, destination }
  }

  const blocks = topLevelBlocks(markdown)
  const index = blocks.findIndex(
    (block) => block.from <= from && from < block.to,
  )
  const sibling = blocks[index + (direction === 'up' ? -1 : 1)]
  if (!sibling) return undefined
  const destination =
    sibling.name.startsWith('ATXHeading') && direction === 'down'
      ? findMoveBlockRange(markdown, sibling.from)?.to
      : direction === 'up'
        ? sibling.from
        : sibling.to
  return destination === undefined
    ? undefined
    : { from: range.from, destination }
}

export function headingChildMove(
  state: EditorState,
  from: number,
): MoveBlockInput | undefined {
  const markdown = state.doc.toString()
  if (!isHeadingBlock(headingBlockAt(markdown, from))) return undefined

  const range = findMoveBlockRange(markdown, from)
  if (range?.headingLevel === undefined) return undefined

  const siblings = siblingsAt(deriveHeadingTree(markdown), range.from)
  const parent = siblings?.siblings[siblings.index - 1]
  return parent
    ? { from: range.from, destination: range.from, childOf: parent.from }
    : undefined
}

export function bodyDropInput(
  view: EditorView,
  position: number,
  clientY: number,
  from: number,
): MoveBlockInput | undefined {
  const markdown = view.state.doc.toString()
  const range = findMoveBlockRange(markdown, position)
  if (!range) return undefined
  const firstLine = view.coordsAtPos(range.from)
  const lastLine = view.coordsAtPos(Math.max(range.from, range.to - 1))
  if (!firstLine || !lastLine) return undefined

  return {
    from,
    destination:
      clientY < (firstLine.top + lastLine.bottom) / 2 ? range.from : range.to,
  }
}

export function blockStarts(
  state: EditorState,
  from = 0,
  to = state.doc.length,
): number[] {
  return topLevelBlocks(state.doc.toString())
    .filter((block) => block.from <= to && block.to >= from)
    .map(({ from: blockFrom }) => blockFrom)
}
