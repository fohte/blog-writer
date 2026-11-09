import { GFM, parser } from '@lezer/markdown'

import { InvalidBlockMoveError } from '#article/errors'
import { deriveHeadingTree, flattenHeadingTree } from '#article/headings'
import type { Heading } from '#article/types'
import { mdxMarkdownExtension } from '#editor/mdx-markdown-extension'

export type MarkdownBlockRange = {
  from: number
  contentTo: number
  to: number
  name: string
}

const markdownParser = parser.configure([GFM, mdxMarkdownExtension])

function isImageGridOpening(markdown: string, block: MarkdownBlockRange) {
  return (
    block.name === 'MdxComponentTag' &&
    /^<ImageGrid[ \t]*>$/u.test(markdown.slice(block.from, block.contentTo))
  )
}

function isImageGridClosing(markdown: string, block: MarkdownBlockRange) {
  return (
    block.name === 'MdxComponentTag' &&
    /^<\/ImageGrid[ \t]*>$/u.test(markdown.slice(block.from, block.contentTo))
  )
}

function groupImageGrids(
  markdown: string,
  blocks: MarkdownBlockRange[],
): MarkdownBlockRange[] {
  const grouped: MarkdownBlockRange[] = []
  for (let index = 0; index < blocks.length;) {
    const opening = blocks[index]
    if (!opening || !isImageGridOpening(markdown, opening)) {
      if (opening) grouped.push(opening)
      index += 1
      continue
    }

    let closingIndex = index + 1
    while (closingIndex < blocks.length) {
      const candidate = blocks[closingIndex]
      if (
        !candidate ||
        isImageGridOpening(markdown, candidate) ||
        isImageGridClosing(markdown, candidate)
      ) {
        break
      }
      closingIndex += 1
    }

    const closing = blocks[closingIndex]
    if (!closing || !isImageGridClosing(markdown, closing)) {
      grouped.push(opening)
      index += 1
      continue
    }

    grouped.push({
      from: opening.from,
      contentTo: closing.contentTo,
      to: closing.to,
      name: 'MdxImageGrid',
    })
    index = closingIndex + 1
  }
  return grouped
}

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

  return groupImageGrids(markdown, blocks)
}

export function collectHeadings(markdown: string): Heading[] {
  return flattenHeadingTree(deriveHeadingTree(markdown))
}

export function findHeadingSection(
  markdown: string,
  headings: Heading[],
  from: number,
): { from: number; to: number; headingLevel: number } | undefined {
  const index = headings.findIndex(
    (heading) => heading.from <= from && from <= heading.to,
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

export function findMoveBlockRange(
  markdown: string,
  position: number,
  headings = collectHeadings(markdown),
  blocks = topLevelBlocks(markdown),
): { from: number; to: number; headingLevel?: number } | undefined {
  const section = findHeadingSection(markdown, headings, position)
  if (section) return section

  const block = blocks.find(({ from, to }) => from <= position && position < to)
  return block ? { from: block.from, to: block.to } : undefined
}

type TextRange = { from: number; to: number }
type PlannedMoveStructure = {
  originalMarkdown: string
  originalRange: TextRange
  plannedMarkdown: string
  movedRange: TextRange
  isSection: boolean
}

function blocksIn(
  blocks: MarkdownBlockRange[],
  range: TextRange,
): MarkdownBlockRange[] {
  return blocks.filter(
    (block) => block.from >= range.from && block.from < range.to,
  )
}

function blocksOutside(
  blocks: MarkdownBlockRange[],
  range: TextRange,
): MarkdownBlockRange[] {
  return blocks.filter(
    (block) => block.from < range.from || block.from >= range.to,
  )
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

function validateMovedBlocks(
  input: PlannedMoveStructure,
  plannedBlocks: MarkdownBlockRange[],
  insertedMarkdown: string,
  insertedBlocks: MarkdownBlockRange[],
): boolean {
  const movedBlocks = blocksIn(plannedBlocks, input.movedRange)
  const mergedIntoPrevious = plannedBlocks.some(
    (block) =>
      block.from < input.movedRange.from &&
      block.contentTo > input.movedRange.from,
  )

  return (
    !mergedIntoPrevious &&
    hasSameBlocks(
      input.plannedMarkdown,
      movedBlocks,
      insertedMarkdown,
      insertedBlocks,
    )
  )
}

function validateMovedShape(
  input: PlannedMoveStructure,
  originalBlocks: MarkdownBlockRange[],
  insertedBlocks: MarkdownBlockRange[],
): boolean {
  if (input.isSection) {
    const section = findHeadingSection(
      input.plannedMarkdown,
      collectHeadings(input.plannedMarkdown),
      input.movedRange.from,
    )
    return (
      section?.from === input.movedRange.from &&
      section.to === input.movedRange.to
    )
  }

  return (
    blocksIn(originalBlocks, input.originalRange).length === 1 &&
    insertedBlocks.length === 1
  )
}

function validateRemainingBlocks(
  input: PlannedMoveStructure,
  originalBlocks: MarkdownBlockRange[],
  plannedBlocks: MarkdownBlockRange[],
): boolean {
  return hasSameBlocks(
    input.plannedMarkdown,
    blocksOutside(plannedBlocks, input.movedRange),
    input.originalMarkdown,
    blocksOutside(originalBlocks, input.originalRange),
  )
}

export function validatePlannedMoveStructure(
  input: PlannedMoveStructure,
): InvalidBlockMoveError | undefined {
  const { originalMarkdown, plannedMarkdown } = input
  const originalBlocks = topLevelBlocks(originalMarkdown)
  const plannedBlocks = topLevelBlocks(plannedMarkdown)
  const insertedMarkdown = plannedMarkdown.slice(
    input.movedRange.from,
    input.movedRange.to,
  )
  const insertedBlocks = topLevelBlocks(insertedMarkdown)

  const isValid =
    validateMovedBlocks(
      input,
      plannedBlocks,
      insertedMarkdown,
      insertedBlocks,
    ) &&
    validateMovedShape(input, originalBlocks, insertedBlocks) &&
    validateRemainingBlocks(input, originalBlocks, plannedBlocks)
  return isValid
    ? undefined
    : new InvalidBlockMoveError(
        'The move would change Markdown block structure',
      )
}
