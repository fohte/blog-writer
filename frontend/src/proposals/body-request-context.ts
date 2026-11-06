import { deriveHeadingTree } from '#article/headings'

export type TextRange = { from: number; to: number }

type HeadingRange = TextRange & { level: number }

export type BodyRequestContext = {
  headings: string[]
  section: string
  target: string
  range: TextRange
}

function lineStartAt(text: string, position: number): number {
  return text.lastIndexOf('\n', Math.max(0, position - 1)) + 1
}

function lineEndAt(text: string, position: number): number {
  const newline = text.indexOf('\n', position)
  return newline === -1 ? text.length : newline
}

function nextLineStart(text: string, lineEnd: number): number {
  return lineEnd < text.length ? lineEnd + 1 : text.length
}

function lineIsBlank(text: string, start: number, end: number): boolean {
  return text.slice(start, end).trim().length === 0
}

function lineIsHeading(text: string, start: number, end: number): boolean {
  return /^#{1,6}(?:[ \t]+|$)/.test(text.slice(start, end))
}

function resolveBodyRequestRange(
  text: string,
  selection: TextRange,
): TextRange {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (from !== to) return { from, to }

  let start = lineStartAt(text, from)
  let end = lineEndAt(text, from)
  if (lineIsBlank(text, start, end)) return { from, to: from }

  while (start > 0) {
    const previousEnd = start - 1
    const previousStart = lineStartAt(text, previousEnd - 1)
    if (
      lineIsBlank(text, previousStart, previousEnd) ||
      lineIsHeading(text, previousStart, previousEnd)
    ) {
      break
    }
    start = previousStart
  }

  while (end < text.length) {
    const followingStart = nextLineStart(text, end)
    const followingEnd = lineEndAt(text, followingStart)
    if (
      lineIsBlank(text, followingStart, followingEnd) ||
      lineIsHeading(text, followingStart, followingEnd)
    ) {
      break
    }
    end = followingEnd
  }

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
  let sectionEnd = text.length

  if (activeHeading) {
    const nextSectionHeading = headingRanges
      .slice(activeIndex + 1)
      .find(
        (heading) =>
          heading.from >= range.to && heading.level <= activeHeading.level,
      )
    sectionEnd = nextSectionHeading?.from ?? text.length
  } else {
    sectionEnd =
      headingRanges.find((heading) => heading.from >= range.to)?.from ??
      text.length
  }

  const headings = headingRanges.map(({ from, to }) => text.slice(from, to))
  const section = text.slice(sectionStart, sectionEnd)
  const sectionRange = {
    from: range.from - sectionStart,
    to: range.to - sectionStart,
  }
  const markedSection = `${section.slice(0, sectionRange.from)}⟪依頼範囲の開始⟫${section.slice(sectionRange.from, sectionRange.to)}⟪依頼範囲の終了⟫${section.slice(sectionRange.to)}`
  return {
    headings,
    section: markedSection.trimEnd(),
    target: text.slice(range.from, range.to),
    range,
  }
}
