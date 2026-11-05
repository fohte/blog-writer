import { GFM, parser } from '@lezer/markdown'

import { InvalidBlockMoveError } from '#article/errors'
import { deriveHeadingTree } from '#article/headings'
import type { Heading } from '#article/types'

export type MarkdownBlockRange = {
  from: number
  contentTo: number
  to: number
  name: string
}

const markdownParser = parser.configure(GFM)

export function topLevelBlocks(markdown: string): MarkdownBlockRange[] {
  const blocks: MarkdownBlockRange[] = []
  const cursor = markdownParser.parse(markdown).cursor()
  if (!cursor.firstChild()) return blocks

  do {
    let to = cursor.to
    while (markdown[to] === '\n') to += 1
    blocks.push({
      from: cursor.from,
      contentTo: cursor.to,
      to,
      name: cursor.name,
    })
  } while (cursor.nextSibling())

  return blocks
}

function flattenHeadings(headings: Heading[]): Heading[] {
  return headings.flatMap((heading) => [
    heading,
    ...flattenHeadings(heading.children),
  ])
}

export function collectHeadings(markdown: string): Heading[] {
  return flattenHeadings(deriveHeadingTree(markdown))
}

export function findHeadingSection(
  markdown: string,
  headings: Heading[],
  from: number,
): { from: number; to: number; headingLevel: number } | undefined {
  const index = headings.findIndex(
    (heading) => heading.from <= from && from < heading.to,
  )
  if (index === -1) return undefined

  const heading = headings[index]
  if (!heading) return undefined
  const nextHeading = headings
    .slice(index + 1)
    .find((candidate) => candidate.level <= heading.level)

  return {
    from: heading.from,
    to: nextHeading?.from ?? markdown.length,
    headingLevel: heading.level,
  }
}

function hasSameBlocks(
  actualMarkdown: string,
  actualBlocks: MarkdownBlockRange[],
  expectedMarkdown: string,
  expectedBlocks: MarkdownBlockRange[],
): boolean {
  return (
    actualBlocks.length === expectedBlocks.length &&
    actualBlocks.every((block, index) => {
      const expected = expectedBlocks[index]
      return (
        expected !== undefined &&
        block.name === expected.name &&
        actualMarkdown.slice(block.from, block.contentTo) ===
          expectedMarkdown.slice(expected.from, expected.contentTo)
      )
    })
  )
}

export function validatePlannedMoveStructure(input: {
  originalMarkdown: string
  originalFrom: number
  originalTo: number
  plannedMarkdown: string
  movedFrom: number
  movedTo: number
  isSection: boolean
}): InvalidBlockMoveError | undefined {
  const {
    originalMarkdown,
    originalFrom,
    originalTo,
    plannedMarkdown,
    movedFrom,
    movedTo,
    isSection,
  } = input
  const originalBlocks = topLevelBlocks(originalMarkdown)
  const plannedBlocks = topLevelBlocks(plannedMarkdown)
  const insertedMarkdown = plannedMarkdown.slice(movedFrom, movedTo)
  const insertedBlocks = topLevelBlocks(insertedMarkdown)
  const movedBlocks = plannedBlocks.filter(
    (block) => block.from >= movedFrom && block.from < movedTo,
  )
  const mergedIntoPrevious = plannedBlocks.some(
    (block) => block.from < movedFrom && block.contentTo > movedFrom,
  )

  const invalidStructure = () =>
    new InvalidBlockMoveError('The move would change Markdown block structure')

  if (
    mergedIntoPrevious ||
    !hasSameBlocks(
      plannedMarkdown,
      movedBlocks,
      insertedMarkdown,
      insertedBlocks,
    )
  ) {
    return invalidStructure()
  }

  if (isSection) {
    const section = findHeadingSection(
      plannedMarkdown,
      collectHeadings(plannedMarkdown),
      movedFrom,
    )
    if (!section || section.from !== movedFrom || section.to !== movedTo)
      return invalidStructure()
  } else {
    const originalMovedBlocks = originalBlocks.filter(
      (block) => block.from >= originalFrom && block.from < originalTo,
    )
    if (originalMovedBlocks.length !== 1 || insertedBlocks.length !== 1)
      return invalidStructure()
  }

  const originalRemaining = originalBlocks.filter(
    (block) => block.from < originalFrom || block.from >= originalTo,
  )
  const plannedRemaining = plannedBlocks.filter(
    (block) => block.from < movedFrom || block.from >= movedTo,
  )
  return hasSameBlocks(
    plannedMarkdown,
    plannedRemaining,
    originalMarkdown,
    originalRemaining,
  )
    ? undefined
    : invalidStructure()
}
