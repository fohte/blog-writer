import { GFM, parser } from '@lezer/markdown'

import type { Heading } from '#article/types'

const markdownParser = parser.configure(GFM)

type FlatHeading = Omit<Heading, 'children'>

export type HeadingWithDepth = { heading: Heading; depth: number }

export function flattenHeadingTreeWithDepth(
  headings: readonly Heading[],
): HeadingWithDepth[] {
  return headings.flatMap((heading) => [
    { heading, depth: 0 },
    ...flattenHeadingTreeWithDepth(heading.children).map((nested) => ({
      ...nested,
      depth: nested.depth + 1,
    })),
  ])
}

export function flattenHeadingTree(headings: readonly Heading[]): Heading[] {
  return flattenHeadingTreeWithDepth(headings).map(({ heading }) => heading)
}

function extractHeadingText(
  markdown: string,
  from: number,
  to: number,
): string {
  const lineEnd = markdown.indexOf('\n', from)
  const line = markdown.slice(
    from,
    lineEnd === -1 || lineEnd > to ? to : lineEnd,
  )
  const match = /^#{1,6}(?:[ \t]+|$)(.*)$/.exec(line)
  return match?.[1]?.replace(/[ \t]+#+[ \t]*$/, '').trim() ?? ''
}

function collectAtxHeadings(markdown: string): FlatHeading[] {
  const cursor = markdownParser.parse(markdown).cursor()
  const headings: FlatHeading[] = []

  while (cursor.next()) {
    const match = /^ATXHeading([1-6])$/.exec(cursor.name)
    if (!match) continue

    headings.push({
      level: Number(match[1]),
      text: extractHeadingText(markdown, cursor.from, cursor.to),
      from: cursor.from,
      to: cursor.to,
    })
  }

  return headings
}

export function deriveHeadingTree(markdown: string): Heading[] {
  const roots: Heading[] = []
  const parents: Heading[] = []

  for (const heading of collectAtxHeadings(markdown)) {
    const node: Heading = { ...heading, children: [] }
    while (parents.at(-1) && (parents.at(-1)?.level ?? 0) >= node.level)
      parents.pop()

    const parent = parents.at(-1)
    if (parent) parent.children.push(node)
    else roots.push(node)
    parents.push(node)
  }

  return roots
}
