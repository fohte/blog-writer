import { GFM, parser } from '@lezer/markdown'

import { deriveHeadingTree, extractAtxHeadingText } from '#article/headings'

type TextRange = { from: number; to: number }

type ContextBlockRange = TextRange & { name: string }

type HeadingRange = TextRange & { level: number }

type BodyRequestContext = {
  headings: string[]
  section: string
  target: string
  range: TextRange
}

const markdownParser = parser.configure(GFM)

export function getBlankLineInsertionSeparators(
  before: string,
  after: string,
  replacement: string,
): { before: string; after: string } {
  const beforeSeparator =
    before.trim().length > 0 &&
    !before.endsWith('\n\n') &&
    !replacement.startsWith('\n')
      ? '\n'
      : ''
  const afterSeparator =
    after.trim().length > 0 &&
    !after.startsWith('\n\n') &&
    !replacement.endsWith('\n')
      ? '\n'
      : ''
  return { before: beforeSeparator, after: afterSeparator }
}

function lineStartAt(text: string, position: number): number {
  if (position <= 0) return 0
  return text.lastIndexOf('\n', position - 1) + 1
}

function lineEndAt(text: string, position: number): number {
  const newline = text.indexOf('\n', position)
  return newline === -1 ? text.length : newline
}

function lineIsBlank(text: string, start: number, end: number): boolean {
  return text.slice(start, end).trim().length === 0
}

function lineIsHeading(text: string, start: number, end: number): boolean {
  return /^#{1,6}(?:[ \t]+|$)/.test(text.slice(start, end))
}

function collectContextBlockRanges(markdown: string): ContextBlockRange[] {
  const cursor = markdownParser.parse(markdown).cursor()
  const ranges: ContextBlockRange[] = []

  function visit(): void {
    if (cursor.name === 'FencedCode' || cursor.name === 'Paragraph') {
      ranges.push({ from: cursor.from, to: cursor.to, name: cursor.name })
    }
    if (cursor.firstChild()) {
      do {
        visit()
      } while (cursor.nextSibling())
      cursor.parent()
    }
  }

  if (cursor.firstChild()) {
    do {
      visit()
    } while (cursor.nextSibling())
  }
  return ranges
}

function findContextBlockRange(
  blocks: ContextBlockRange[],
  name: 'FencedCode' | 'Paragraph',
  position: number,
): TextRange | undefined {
  const block = blocks.find(
    ({ from, name: blockName, to }) =>
      blockName === name && from <= position && position <= to,
  )
  return block ? { from: block.from, to: block.to } : undefined
}

function findFencedCodeRangeAt(
  markdown: string,
  blocks: ContextBlockRange[],
  position: number,
): TextRange | undefined {
  const containingRange = findContextBlockRange(blocks, 'FencedCode', position)
  if (containingRange) return containingRange

  const lineStart = lineStartAt(markdown, position)
  const firstContentPositionOnLine = blocks.find(
    ({ from, name }) =>
      name === 'FencedCode' && lineStartAt(markdown, from) === lineStart,
  )?.from
  if (firstContentPositionOnLine === undefined) return undefined

  return findContextBlockRange(blocks, 'FencedCode', firstContentPositionOnLine)
}

function resolveBodyRequestRange(
  text: string,
  selection: TextRange,
): TextRange {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (from !== to) return { from, to }

  const blocks = collectContextBlockRanges(text)
  const fencedCodeRange = findFencedCodeRangeAt(text, blocks, from)
  if (fencedCodeRange) return fencedCodeRange

  const paragraphRange = findContextBlockRange(blocks, 'Paragraph', from)
  if (paragraphRange) return paragraphRange

  const start = lineStartAt(text, from)
  const end = lineEndAt(text, from)

  if (lineIsHeading(text, start, end)) return { from: start, to: end }

  if (lineIsBlank(text, start, end)) return { from, to: from }

  return { from: start, to: end }
}

function collectHeadingRanges(text: string): HeadingRange[] {
  const flatten = (
    headings: ReturnType<typeof deriveHeadingTree>,
  ): HeadingRange[] =>
    headings.flatMap(({ level, from, to, children }) => [
      { level, from, to },
      ...flatten(children),
    ])
  return flatten(deriveHeadingTree(text))
}

export function sectionHeadingText(section: string): string {
  const unmarked = section.replace(/⟪依頼範囲の(?:開始|終了)⟫/gu, '')
  return extractAtxHeadingText(unmarked, 0, unmarked.length)
}

export function getBodyRequestContext(
  text: string,
  selection: TextRange,
): BodyRequestContext {
  const range = resolveBodyRequestRange(text, selection)
  const headingRanges = collectHeadingRanges(text)
  const activeIndex = headingRanges.findLastIndex(
    (heading) => heading.from <= range.from,
  )
  const activeHeading = headingRanges[activeIndex]
  const sectionStart = activeHeading?.from ?? 0
  const sectionEnd =
    headingRanges.find((heading) => heading.from >= range.to)?.from ??
    text.length

  const headings = headingRanges.map(({ from, to }) => text.slice(from, to))
  const section = text.slice(sectionStart, sectionEnd)
  const sectionRange = {
    from: range.from - sectionStart,
    to: range.to - sectionStart,
  }
  const sectionBeforeRange = section.slice(0, sectionRange.from)
  const sectionAfterRange = section.slice(sectionRange.to)
  const isBlankLineInsertion =
    sectionRange.from === sectionRange.to &&
    lineIsBlank(
      text,
      lineStartAt(text, range.from),
      lineEndAt(text, range.from),
    )
  const separators = isBlankLineInsertion
    ? getBlankLineInsertionSeparators(
        sectionBeforeRange,
        sectionAfterRange,
        section.slice(sectionRange.from, sectionRange.to),
      )
    : { before: '', after: '' }
  const markedSection = `${sectionBeforeRange}${separators.before}⟪依頼範囲の開始⟫${section.slice(sectionRange.from, sectionRange.to)}⟪依頼範囲の終了⟫${separators.after}${sectionAfterRange}`
  return {
    headings,
    section: markedSection.trimEnd(),
    target: text.slice(range.from, range.to),
    range,
  }
}
