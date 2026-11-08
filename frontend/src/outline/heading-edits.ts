import {
  findMoveBlockRange,
  flattenHeadingTree,
  type MoveBlockInput,
} from '#article/index'
import type { Heading } from '#article/types'

export type HeadingChange = { from: number; to: number; insert: string }

function lineEnd(markdown: string, from: number): number {
  const end = markdown.indexOf('\n', from)
  return end === -1 ? markdown.length : end
}

export function renameHeadingChange(
  markdown: string,
  heading: Heading,
  text: string,
): HeadingChange | undefined {
  if (text === heading.text) return undefined
  return {
    from: heading.from + heading.level,
    to: lineEnd(markdown, heading.from),
    insert: ` ${text}`,
  }
}

/**
 * A heading with children gets a first child, because a sibling placed before
 * those children would adopt them and one placed after them would not be the next row.
 */
export function addHeadingBelowChange(
  markdown: string,
  heading: Heading,
): HeadingChange | undefined {
  const firstChild = heading.children[0]
  const at = firstChild?.from ?? findMoveBlockRange(markdown, heading.from)?.to
  if (at === undefined) return undefined
  const before = at === 0 || markdown[at - 1] === '\n' ? '' : '\n'
  const after = markdown.slice(at - 2, at) === '\n\n' ? '\n\n' : '\n'
  const level = firstChild?.level ?? heading.level
  return { from: at, to: at, insert: `${before}${'#'.repeat(level)} ${after}` }
}

export function deleteHeadingChange(
  markdown: string,
  heading: Heading,
): HeadingChange {
  const end = lineEnd(markdown, heading.from)
  const next = Math.min(end + 1, markdown.length)
  return {
    from: heading.from,
    // The blank line under the heading would otherwise double the one above it.
    to: markdown[next] === '\n' ? next + 1 : next,
    insert: '',
  }
}

export function outdentHeadingMove(
  markdown: string,
  headings: readonly Heading[],
  heading: Heading,
): MoveBlockInput | undefined {
  const parent = flattenHeadingTree(headings).find(({ children }) =>
    children.some(({ from }) => from === heading.from),
  )
  if (!parent) return undefined
  const destination = findMoveBlockRange(markdown, parent.from)?.to
  return destination === undefined
    ? undefined
    : { from: heading.from, destination, headingLevel: parent.level }
}
