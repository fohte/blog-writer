import {
  Annotation,
  type ChangeSet,
  Text,
  Transaction,
} from '@codemirror/state'
import { err, ok, Result } from 'neverthrow'
import * as Y from 'yjs'

import { getBody } from '#article/body'
import { InvalidBlockMoveError } from '#article/errors'
import { prepareMemoAnchorMove } from '#article/memos'
import {
  changeSetForMove,
  mapMoveHistoryRemote,
  type MoveRecord,
  type MoveSeparator,
} from '#article/move-block-history'
import type {
  MoveInsertion,
  MoveSource,
  TextReplacement,
} from '#article/move-block-plan'
import {
  mapWithinRange,
  planBlockMove,
  sectionReplacements,
  transformedText,
  validateMove,
} from '#article/move-block-plan'
import {
  collectHeadings,
  findMoveBlockRange,
  validatePlannedMoveStructure,
} from '#article/move-block-structure'

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
  userEvent?: 'move' | 'undo' | 'redo'
}

export type MoveBlockResult = BlockMoved & {
  annotations: readonly [
    ReturnType<typeof blockMoved.of>,
    ReturnType<typeof Transaction.userEvent.of>,
  ]
  originalHeadingLevel?: number
}

type ApplyMoveOptions = {
  expectedSelection?: string
  replacement?: MoveSource
  removeRanges?: { from: number; to: number; text: string }[]
  skipValidation?: boolean
}
const updatersByDoc = new WeakMap<Y.Doc, Set<BlockMoveUpdater>>()
const historyByMove = new WeakMap<MoveBlockResult, MoveRecord>()

function rememberMove(input: {
  move: MoveBlockResult
  insertion: MoveInsertion
  inverse: ChangeSet
  source: MoveSource
  contentReplacements: TextReplacement[]
  mapPosition: (position: number, assoc: number) => number | undefined
}): void {
  const { move, insertion, inverse, source, contentReplacements, mapPosition } =
    input
  const prefix = insertion.text.slice(0, insertion.prefixLength)
  const suffix = insertion.text.slice(
    insertion.prefixLength + insertion.contentLength,
  )
  const separators: MoveSeparator[] = []
  if (prefix.length > 0) {
    separators.push({ side: 'prefix', text: prefix })
  }
  if (suffix.length > 0) {
    separators.push({ side: 'suffix', text: suffix })
  }
  historyByMove.set(move, {
    insertedSelection: insertion.text.slice(insertion.prefixLength),
    contentReplacements,
    mapPosition,
    inverse,
    source,
    separators,
  })
}

function reverseContentReplacements(
  rangeFrom: number,
  replacements: TextReplacement[],
): TextReplacement[] {
  let offset = 0
  return replacements.map((replacement) => {
    const from = replacement.from - rangeFrom + offset
    const to = from + replacement.text.length
    offset += replacement.text.length - (replacement.to - replacement.from)
    return {
      from,
      to,
      text: '#'.repeat(replacement.to - replacement.from),
    }
  })
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

function applyMoveBlock(
  doc: Y.Doc,
  input: MoveBlockInput,
  options: ApplyMoveOptions = {},
): Result<MoveBlockResult, InvalidBlockMoveError> {
  const body = getBody(doc)
  const markdown = body.toJSON()
  const headings = collectHeadings(markdown)
  const skipValidation = options.skipValidation === true
  const validation = skipValidation
    ? undefined
    : validateMove(markdown, input, headings)
  if (validation?.isErr() === true) return err(validation.error)
  const validated = validation?.isOk() === true ? validation.value : undefined
  const range = validated
    ? validated.range
    : findMoveBlockRange(markdown, input.from, headings)
  if (!range)
    return err(new InvalidBlockMoveError('No Markdown block at position'))
  const targetLevel = validated ? validated.targetLevel : input.headingLevel
  if (
    options.expectedSelection !== undefined &&
    markdown.slice(range.from, range.to) !== options.expectedSelection
  ) {
    return err(new InvalidBlockMoveError('The moved block has changed'))
  }
  const replacements = sectionReplacements(
    markdown,
    range,
    targetLevel,
    headings,
  )
  const movedText = transformedText(markdown, range, replacements)
  const sourceText = markdown.slice(range.from, range.to)
  const removeRanges = options.removeRanges ?? []
  if (
    removeRanges.some(
      ({ from, to, text }) =>
        from < 0 ||
        to < from ||
        to > markdown.length ||
        markdown.slice(from, to) !== text,
    )
  )
    return err(new InvalidBlockMoveError('A moved separator has changed'))
  const removeFrom = Math.min(
    range.from,
    ...removeRanges.map((resolved) => resolved.from),
  )
  const removeTo = Math.max(
    range.to,
    ...removeRanges.map((resolved) => resolved.to),
  )
  const plannedMove = planBlockMove({
    markdown,
    removeFrom,
    removeTo,
    destination: input.destination,
    movedText,
    ...(options.replacement === undefined
      ? {}
      : { replacement: options.replacement }),
  })
  const {
    deletionFrom,
    removedLength,
    insertionIndex,
    insertion,
    seam,
    plannedMarkdown,
    insertedFrom,
    insertedTo,
  } = plannedMove
  const inverse = changeSetForMove(markdown, plannedMove).invert(
    Text.of(markdown.split('\n')),
  )
  const newFrom = insertedFrom
  const newTo = newFrom + insertion.contentLength
  const structureError = skipValidation
    ? undefined
    : validatePlannedMoveStructure({
        originalMarkdown: markdown,
        originalRange: { from: range.from, to: range.to },
        plannedMarkdown,
        movedRange: { from: insertedFrom, to: insertedTo },
        isSection: range.headingLevel !== undefined,
      })
  if (structureError) return err(structureError)
  const mapping: MovePositionMapping = {
    from: range.from,
    to: range.to,
    newFrom,
    newTo,
    mapPosition: (position) => {
      if (position === range.to) return newTo
      const withinRange = mapWithinRange(position, range, replacements)
      return withinRange === undefined ? undefined : newFrom + withinRange
    },
  }
  const mapDocumentPosition = (position: number, assoc: number) => {
    if (position === range.from && assoc < 0) return undefined
    if (position === range.to) return assoc < 0 ? newTo : undefined
    const withinRange = mapWithinRange(position, range, replacements)
    if (withinRange === undefined) return undefined
    return newFrom + Math.min(withinRange, insertion.contentLength)
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
    body.delete(deletionFrom, removedLength)
    body.insert(insertionIndex, insertion.text)
    finishMemoAnchorMove()
    for (const finishMove of finishUpdaterMoves) finishMove()
  }, origin)

  const move: MoveBlockResult = {
    ...annotationValue,
    annotations,
    ...(range.headingLevel === undefined
      ? {}
      : { originalHeadingLevel: range.headingLevel }),
  }
  const sourcePrefix = removeRanges
    .filter((separator) => separator.to === range.from)
    .map((separator) => separator.text)
    .join('')
  const sourceSuffix = removeRanges
    .filter((separator) => separator.from === range.to)
    .map((separator) => separator.text)
    .join('')
  rememberMove({
    move,
    insertion,
    inverse,
    mapPosition: mapDocumentPosition,
    source: {
      text: sourceText,
      prefix: sourcePrefix + plannedMove.sourcePrefix,
      ...(sourceSuffix.length === 0 ? {} : { suffix: sourceSuffix }),
    },
    contentReplacements: reverseContentReplacements(range.from, replacements),
  })
  return ok(move)
}

export function moveBlock(
  doc: Y.Doc,
  input: MoveBlockInput,
): Result<MoveBlockResult, InvalidBlockMoveError> {
  return applyMoveBlock(doc, input)
}

export function resolveMoveBlockStart(
  doc: Y.Doc,
  move: MoveBlockResult,
): number | undefined {
  const history = historyByMove.get(move)
  const body = getBody(doc)
  return history && move.from >= 0 && move.from < body.length
    ? move.from
    : undefined
}

export function mapMoveBlockPosition(
  move: MoveBlockResult,
  position: number,
  assoc = 1,
): number | undefined {
  return historyByMove.get(move)?.mapPosition(position, assoc)
}

export function getReverseMoveChange(
  move: MoveBlockResult,
): ChangeSet | undefined {
  return historyByMove.get(move)?.inverse
}

export function mapMoveBlockHistoryRemote(
  move: MoveBlockResult,
  change: ChangeSet,
  inverse: ChangeSet,
): Result<
  {
    move: MoveBlockResult
    changeBeforeMove: ChangeSet
  },
  InvalidBlockMoveError
> {
  const history = historyByMove.get(move)
  if (!history)
    return err(new InvalidBlockMoveError('The move cannot be reversed'))

  const mapped = mapMoveHistoryRemote(move, history, change, inverse)
  if (mapped.isErr()) return err(mapped.error)

  const { history: mappedHistory, ...mappedMove } = mapped.value
  const updatedMove: MoveBlockResult = {
    ...move,
    from: mappedMove.from,
    to: mappedMove.to,
    seam: mappedMove.seam,
    annotations: [
      blockMoved.of({
        from: mappedMove.from,
        to: mappedMove.to,
        seam: mappedMove.seam,
      }),
      move.annotations[1],
    ],
  }
  historyByMove.set(updatedMove, mappedHistory)
  return ok({
    move: updatedMove,
    changeBeforeMove: mappedMove.changeBeforeMove,
  })
}

export function reverseBlockMove(
  doc: Y.Doc,
  move: MoveBlockResult,
  userEvent: 'undo' | 'redo' = 'undo',
  options: { skipValidation?: boolean } = {},
): Result<MoveBlockResult, InvalidBlockMoveError> {
  const history = historyByMove.get(move)
  if (!history)
    return err(new InvalidBlockMoveError('The move cannot be reversed'))

  const body = getBody(doc)
  const from = move.from
  const destination = move.seam

  const markdown = body.toJSON()
  const range = findMoveBlockRange(markdown, from)
  if (!range)
    return err(
      new InvalidBlockMoveError('The moved block is no longer available'),
    )
  const separators = history.separators.map(({ side, text }) => {
    const to = side === 'prefix' ? range.from : range.to
    return { from: to - text.length, to, text }
  })

  return applyMoveBlock(
    doc,
    {
      from,
      destination,
      ...(move.originalHeadingLevel === undefined
        ? {}
        : { headingLevel: move.originalHeadingLevel }),
      userEvent,
    },
    {
      expectedSelection: history.insertedSelection,
      ...(history.source === undefined ? {} : { replacement: history.source }),
      removeRanges: separators,
      ...(options.skipValidation === undefined
        ? {}
        : { skipValidation: options.skipValidation }),
    },
  )
}
