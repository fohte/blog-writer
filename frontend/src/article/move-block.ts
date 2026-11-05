import { Annotation, Transaction } from '@codemirror/state'
import { GFM, parser } from '@lezer/markdown'
import { err, ok, Result } from 'neverthrow'
import * as Y from 'yjs'

import { getBody } from '#article/body'
import { InvalidBlockMoveError } from '#article/errors'
import { deriveHeadingTree } from '#article/headings'
import { prepareMemoAnchorMove } from '#article/memos'
import type { Heading } from '#article/types'

export type BlockMoved = {
  from: number
  to: number
  seam: number
}

export const blockMoved = Annotation.define<BlockMoved>()

export type MovePositionMapping = {
  from: number
  to: number
  newFrom: number
  newTo: number
  mapPosition: (position: number) => number | undefined
}

/** Resolve old anchors before deletion and return the write to run after insertion. */
export type BlockMoveUpdater = (
  mapping: MovePositionMapping,
) => (() => void) | undefined

export type MoveBlockInput = {
  from: number
  destination: number
  childOf?: number
  headingLevel?: number
  userEvent?: 'move' | 'undo'
}

export type MoveBlockResult = BlockMoved & {
  annotations: readonly [
    ReturnType<typeof blockMoved.of>,
    ReturnType<typeof Transaction.userEvent.of>,
  ]
  originalHeadingLevel?: number
}

type Range = { from: number; to: number; headingLevel?: number }
type TextReplacement = { from: number; to: number; text: string }

const markdownParser = parser.configure(GFM)
const updatersByDoc = new WeakMap<Y.Doc, Set<BlockMoveUpdater>>()

function flattenHeadings(headings: Heading[]): Heading[] {
  return headings.flatMap((heading) => [
    heading,
    ...flattenHeadings(heading.children),
  ])
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

function findBlockRange(markdown: string, position: number): Range | undefined {
  const cursor = markdownParser.parse(markdown).cursor()
  if (!cursor.firstChild()) return undefined

  do {
    if (cursor.from <= position && position < cursor.to) {
      let to = cursor.to
      while (markdown[to] === '\n') to += 1
      return { from: cursor.from, to }
    }
  } while (cursor.nextSibling())

  return undefined
}

function findRange(markdown: string, from: number): Range | undefined {
  const headings = flattenHeadings(deriveHeadingTree(markdown))
  return (
    findHeadingSection(markdown, headings, from) ??
    findBlockRange(markdown, from)
  )
}

function sectionReplacements(
  markdown: string,
  range: Range,
  targetLevel?: number,
): TextReplacement[] {
  if (range.headingLevel === undefined || targetLevel === undefined) return []

  const delta = targetLevel - range.headingLevel
  const headings = flattenHeadings(deriveHeadingTree(markdown)).filter(
    (heading) => heading.from >= range.from && heading.from < range.to,
  )

  return headings.map((heading) => {
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

function mapWithinRange(
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

function transformedText(
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
): { text: string; prefixLength: number; contentLength: number } {
  const before = remaining.slice(0, insertionIndex)
  const after = remaining.slice(insertionIndex)
  const prefix =
    before.length > 0 && !before.endsWith('\n') && !movedText.startsWith('\n')
      ? '\n\n'
      : ''
  const suffix =
    after.length > 0 && !movedText.endsWith('\n') && !after.startsWith('\n')
      ? '\n\n'
      : ''

  return {
    text: prefix + movedText + suffix,
    prefixLength: prefix.length,
    contentLength: movedText.length,
  }
}

export function registerBlockMoveUpdater(
  doc: Y.Doc,
  updater: BlockMoveUpdater,
): () => void {
  let updaters = updatersByDoc.get(doc)
  if (!updaters) {
    updaters = new Set()
    updatersByDoc.set(doc, updaters)
  }
  updaters.add(updater)
  const registeredUpdaters = updaters

  return () => {
    registeredUpdaters.delete(updater)
    if (registeredUpdaters.size === 0) updatersByDoc.delete(doc)
  }
}

export function moveBlock(
  doc: Y.Doc,
  input: MoveBlockInput,
): Result<MoveBlockResult, InvalidBlockMoveError> {
  const body = getBody(doc)
  const markdown = body.toJSON()
  if (
    !Number.isInteger(input.from) ||
    !Number.isInteger(input.destination) ||
    input.destination < 0 ||
    input.destination > markdown.length
  ) {
    return err(new InvalidBlockMoveError('Block positions are out of bounds'))
  }

  const range = findRange(markdown, input.from)
  if (!range)
    return err(new InvalidBlockMoveError('No Markdown block at position'))
  if (input.destination > range.from && input.destination < range.to) {
    return err(
      new InvalidBlockMoveError('Destination is inside the moved block'),
    )
  }
  const changesHeadingLevel =
    input.childOf !== undefined || input.headingLevel !== undefined
  if (
    !changesHeadingLevel &&
    input.destination >= range.from &&
    input.destination <= range.to
  ) {
    return err(
      new InvalidBlockMoveError('Destination is inside the moved block'),
    )
  }

  let targetLevel = input.headingLevel
  if (input.childOf !== undefined) {
    const target = flattenHeadings(deriveHeadingTree(markdown)).find(
      (heading) => heading.from === input.childOf,
    )
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
    const headings = flattenHeadings(deriveHeadingTree(markdown)).filter(
      (heading) => heading.from >= range.from && heading.from < range.to,
    )
    if (
      headings.some(
        (heading) => heading.level + delta < 1 || heading.level + delta > 6,
      )
    )
      return err(
        new InvalidBlockMoveError(
          'Moving the section would exceed heading levels 1 to 6',
        ),
      )
  }
  if (
    targetLevel === range.headingLevel &&
    input.destination >= range.from &&
    input.destination <= range.to
  ) {
    return err(
      new InvalidBlockMoveError('The block is already at its destination'),
    )
  }

  const replacements = sectionReplacements(markdown, range, targetLevel)
  const movedText = transformedText(markdown, range, replacements)
  const removedLength = range.to - range.from
  const insertionIndex =
    input.destination >= range.to
      ? input.destination - removedLength
      : input.destination
  const remaining = markdown.slice(0, range.from) + markdown.slice(range.to)
  const insertion = getInsertionText(remaining, insertionIndex, movedText)
  const newFrom = insertionIndex + insertion.prefixLength
  const newTo = newFrom + insertion.contentLength
  const seam =
    input.destination < range.from
      ? range.from + insertion.text.length
      : range.from
  const mapping: MovePositionMapping = {
    from: range.from,
    to: range.to,
    newFrom,
    newTo,
    mapPosition: (position) => {
      const withinRange = mapWithinRange(position, range, replacements)
      return withinRange === undefined ? undefined : newFrom + withinRange
    },
  }
  const annotationValue = { from: newFrom, to: newTo, seam }
  const annotations = [
    blockMoved.of(annotationValue),
    Transaction.userEvent.of(input.userEvent ?? 'move'),
  ] as const
  const origin = annotations

  doc.transact(() => {
    const finishMemoAnchorMove = prepareMemoAnchorMove(doc, mapping)
    const finishUpdaterMoves = [...(updatersByDoc.get(doc) ?? [])]
      .map((updater) => updater(mapping))
      .filter((finishMove) => finishMove !== undefined)
    body.delete(range.from, removedLength)
    body.insert(insertionIndex, insertion.text)
    finishMemoAnchorMove()
    for (const finishMove of finishUpdaterMoves) finishMove()
  }, origin)

  return ok({
    ...annotationValue,
    annotations,
    ...(range.headingLevel === undefined
      ? {}
      : { originalHeadingLevel: range.headingLevel }),
  })
}

export function reverseBlockMove(
  doc: Y.Doc,
  move: MoveBlockResult,
): Result<MoveBlockResult, InvalidBlockMoveError> {
  return moveBlock(doc, {
    from: move.from,
    destination: move.seam,
    ...(move.originalHeadingLevel === undefined
      ? {}
      : { headingLevel: move.originalHeadingLevel }),
    userEvent: 'undo',
  })
}
