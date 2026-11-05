import { GFM, parser } from '@lezer/markdown'
import { err, ok, Result } from 'neverthrow'

import { InvalidBlockMoveError } from '#article/errors'
import { deriveHeadingTree } from '#article/headings'
import type { MoveBlockInput } from '#article/move-block'
import type { Heading } from '#article/types'

export type Range = { from: number; to: number; headingLevel?: number }
export type TextReplacement = { from: number; to: number; text: string }
export type ValidatedMove = { range: Range; targetLevel?: number }
export type MoveSource = { text: string; prefix: string }
export type MoveInsertion = {
  text: string
  prefixLength: number
  contentLength: number
}
type PlannedMove = {
  deletionFrom: number
  removedLength: number
  insertionIndex: number
  insertion: MoveInsertion
  seam: number
  sourcePrefix: string
}
type MarkdownBlockRange = { from: number; contentTo: number; to: number }

const markdownParser = parser.configure(GFM)

function topLevelBlocks(markdown: string): MarkdownBlockRange[] {
  const blocks: MarkdownBlockRange[] = []
  const cursor = markdownParser.parse(markdown).cursor()
  if (!cursor.firstChild()) return blocks

  do {
    let to = cursor.to
    while (markdown[to] === '\n') to += 1
    blocks.push({ from: cursor.from, contentTo: cursor.to, to })
  } while (cursor.nextSibling())

  return blocks
}

function findHeadingSection(
  markdown: string,
  headings: Heading[],
  from: number,
): Range | undefined {
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

function findBlockRange(
  blocks: MarkdownBlockRange[],
  position: number,
): Range | undefined {
  const block = blocks.find(({ from, to }) => from <= position && position < to)
  return block ? { from: block.from, to: block.to } : undefined
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

function findRange(
  markdown: string,
  from: number,
  headings: Heading[],
  blocks: MarkdownBlockRange[],
): Range | undefined {
  return (
    findHeadingSection(markdown, headings, from) ?? findBlockRange(blocks, from)
  )
}

export function sectionReplacements(
  markdown: string,
  range: Range,
  targetLevel: number | undefined,
  headings: Heading[],
): TextReplacement[] {
  if (range.headingLevel === undefined || targetLevel === undefined) return []

  const delta = targetLevel - range.headingLevel
  return headings
    .filter((heading) => heading.from >= range.from && heading.from < range.to)
    .map((heading) => {
      const lineEnd = markdown.indexOf('\n', heading.from)
      const to = lineEnd === -1 ? markdown.length : lineEnd
      const line = markdown.slice(heading.from, to)
      const match = /^(#{1,6})(?=[ \t]|$)/.exec(line)
      const level = heading.level + delta
      return {
        from: heading.from,
        to: heading.from + (match?.[1]?.length ?? 0),
        text: '#'.repeat(level),
      }
    })
}

function validateDestination(
  input: MoveBlockInput,
  range: Range,
  targetLevel: number | undefined,
): InvalidBlockMoveError | undefined {
  if (input.destination < range.from || input.destination > range.to)
    return undefined
  if (input.destination > range.from && input.destination < range.to)
    return new InvalidBlockMoveError('Destination is inside the moved block')
  if ((targetLevel ?? range.headingLevel) === range.headingLevel)
    return new InvalidBlockMoveError('The block is already at its destination')
  return undefined
}

function validateSectionDestination(
  input: MoveBlockInput,
  markdown: string,
  range: Range,
  targetLevel: number | undefined,
  headings: Heading[],
): InvalidBlockMoveError | undefined {
  if (
    input.childOf !== undefined ||
    range.headingLevel === undefined ||
    input.destination === markdown.length
  ) {
    return undefined
  }

  const destinationHeading = headings.find(
    (heading) => heading.from === input.destination,
  )
  const error = new InvalidBlockMoveError(
    'The section destination must be before a heading at the same or a shallower level, or at the end of the document',
  )
  if (!destinationHeading) {
    return error
  }

  const level = targetLevel ?? range.headingLevel
  const destinationLevel =
    destinationHeading.from === range.from ? level : destinationHeading.level
  return destinationLevel > level ? error : undefined
}

function isInsideBlock(
  blocks: MarkdownBlockRange[],
  position: number,
): boolean {
  return blocks.some(
    ({ from, contentTo }) => from < position && position < contentTo,
  )
}

function isBlockBoundary(
  markdown: string,
  blocks: MarkdownBlockRange[],
  position: number,
): boolean {
  return (
    position === markdown.length ||
    blocks.some((block) => block.from === position)
  )
}

function trailingNewlines(text: string): number {
  return text.length - text.replace(/\n+$/, '').length
}

function leadingNewlines(text: string): number {
  return text.length - text.replace(/^\n+/, '').length
}

function normalizeTrailingNewlines(text: string): {
  text: string
  removed: string
} {
  const trailing = /\n+$/.exec(text)?.[0] ?? ''
  if (trailing.length < 2) return { text, removed: '' }

  return {
    text: text.slice(0, text.length - trailing.length + 1),
    removed: trailing.slice(1),
  }
}

function missingSeparator(left: string, right: string): number {
  return Math.max(0, 2 - trailingNewlines(left) - leadingNewlines(right))
}

export function validateMove(
  markdown: string,
  input: MoveBlockInput,
  headings: Heading[],
): Result<ValidatedMove, InvalidBlockMoveError> {
  if (
    !Number.isInteger(input.from) ||
    !Number.isInteger(input.destination) ||
    input.destination < 0 ||
    input.destination > markdown.length
  ) {
    return err(new InvalidBlockMoveError('Block positions are out of bounds'))
  }

  const blocks = topLevelBlocks(markdown)
  const range = findRange(markdown, input.from, headings, blocks)
  if (!range)
    return err(new InvalidBlockMoveError('No Markdown block at position'))
  if (isInsideBlock(blocks, input.destination))
    return err(
      new InvalidBlockMoveError('The destination is inside a Markdown block'),
    )
  if (!isBlockBoundary(markdown, blocks, input.destination))
    return err(
      new InvalidBlockMoveError(
        'The destination is not at a Markdown block boundary',
      ),
    )

  let targetLevel = input.headingLevel
  if (input.childOf !== undefined) {
    const target = headings.find((heading) => heading.from === input.childOf)
    if (!target)
      return err(new InvalidBlockMoveError('Child target is not a heading'))
    if (range.headingLevel === undefined)
      return err(
        new InvalidBlockMoveError('Only a heading section can become a child'),
      )
    if (target.from >= range.from && target.from < range.to)
      return err(
        new InvalidBlockMoveError('A section cannot become its own child'),
      )
    const targetRange = findHeadingSection(markdown, headings, target.from)
    if (
      !targetRange ||
      input.destination <= targetRange.from ||
      input.destination > targetRange.to
    ) {
      return err(
        new InvalidBlockMoveError(
          'The child destination is outside the parent section',
        ),
      )
    }
    targetLevel = target.level + 1
  }

  if (targetLevel !== undefined) {
    if (range.headingLevel === undefined)
      return err(
        new InvalidBlockMoveError('Only a heading section can change level'),
      )
    if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > 6)
      return err(
        new InvalidBlockMoveError('Heading levels must be between 1 and 6'),
      )
    const delta = targetLevel - range.headingLevel
    if (
      headings.some(
        (heading) =>
          heading.from >= range.from &&
          heading.from < range.to &&
          (heading.level + delta < 1 || heading.level + delta > 6),
      )
    ) {
      return err(
        new InvalidBlockMoveError(
          'Moving the section would exceed heading levels 1 to 6',
        ),
      )
    }
  }

  const destinationError = validateDestination(input, range, targetLevel)
  if (destinationError) return err(destinationError)

  const sectionDestinationError = validateSectionDestination(
    input,
    markdown,
    range,
    targetLevel,
    headings,
  )
  return sectionDestinationError
    ? err(sectionDestinationError)
    : ok({ range, ...(targetLevel === undefined ? {} : { targetLevel }) })
}

export function mapWithinRange(
  position: number,
  range: Range,
  replacements: TextReplacement[],
): number | undefined {
  if (position < range.from || position >= range.to) return undefined

  const offset = position - range.from
  let delta = 0
  for (const replacement of replacements) {
    if (position >= replacement.to) {
      delta += replacement.text.length - (replacement.to - replacement.from)
      continue
    }
    if (position >= replacement.from) {
      return (
        replacement.from -
        range.from +
        delta +
        Math.min(position - replacement.from, replacement.text.length)
      )
    }
    break
  }

  return offset + delta
}

export function transformedText(
  markdown: string,
  range: Range,
  replacements: TextReplacement[],
): string {
  let text = markdown.slice(range.from, range.to)
  for (const replacement of replacements.toReversed()) {
    const from = replacement.from - range.from
    const to = replacement.to - range.from
    text = text.slice(0, from) + replacement.text + text.slice(to)
  }
  return text
}

function getInsertionText(
  remaining: string,
  insertionIndex: number,
  movedText: string,
): MoveInsertion {
  const before = remaining.slice(0, insertionIndex)
  const after = remaining.slice(insertionIndex)
  const contentText = movedText.replace(/\n+$/, '\n')
  const prefixLength =
    before.length === 0 ? 0 : missingSeparator(before, contentText)
  const suffixLength =
    after.length === 0 ? 0 : missingSeparator(contentText, after)
  const prefix = '\n'.repeat(prefixLength)
  const suffix = '\n'.repeat(suffixLength)

  return {
    text: prefix + contentText + suffix,
    prefixLength,
    contentLength: contentText.length,
  }
}

export function planBlockMove(input: {
  markdown: string
  removeFrom: number
  removeTo: number
  destination: number
  movedText: string
  replacement?: MoveSource
}): PlannedMove {
  const {
    markdown,
    removeFrom,
    removeTo,
    destination,
    movedText,
    replacement,
  } = input
  const remainingBeforeNormalization =
    markdown.slice(0, removeFrom) + markdown.slice(removeTo)
  const sourceSeparator =
    replacement === undefined && removeTo === markdown.length
      ? normalizeTrailingNewlines(remainingBeforeNormalization)
      : { text: remainingBeforeNormalization, removed: '' }
  const deletionFrom = removeFrom - sourceSeparator.removed.length
  const removedLength = removeTo - deletionFrom
  const insertionIndex =
    destination >= removeTo
      ? destination - removedLength
      : destination >= deletionFrom
        ? deletionFrom
        : destination
  const insertion =
    replacement === undefined
      ? getInsertionText(sourceSeparator.text, insertionIndex, movedText)
      : {
          text: replacement.prefix + replacement.text,
          prefixLength: replacement.prefix.length,
          contentLength: replacement.text.length,
        }
  const restoresDestinationSeam =
    replacement !== undefined &&
    destination >= removeTo &&
    insertionIndex === deletionFrom

  return {
    deletionFrom,
    removedLength,
    insertionIndex,
    insertion,
    seam: restoresDestinationSeam
      ? insertionIndex + insertion.prefixLength
      : insertionIndex < removeFrom
        ? deletionFrom + insertion.text.length
        : deletionFrom,
    sourcePrefix: sourceSeparator.removed,
  }
}
