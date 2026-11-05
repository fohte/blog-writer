import { Annotation, Transaction } from '@codemirror/state'
import { err, ok, Result } from 'neverthrow'
import * as Y from 'yjs'

import { getBody } from '#article/body'
import { InvalidBlockMoveError } from '#article/errors'
import { prepareMemoAnchorMove } from '#article/memos'
import type { MoveInsertion, MoveSource } from '#article/move-block-plan'
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

type MoveSeparator = {
  side: 'prefix' | 'suffix'
  text: string
}
type MoveHistory = {
  movedFrom: Y.RelativePosition
  seam: Y.RelativePosition
  insertedSelection: string
  mapPosition: (position: number, assoc: number) => number | undefined
  source?: MoveSource
  separators: MoveSeparator[]
}
type ApplyMoveOptions = {
  expectedSelection?: string
  replacement?: MoveSource
  removeRanges?: { from: number; to: number; text: string }[]
}
type HistoryPositionSnapshot = { position: number; assoc: number } | undefined
type MoveHistorySnapshot = {
  history: MoveHistory
  movedFrom: HistoryPositionSnapshot
  seam: HistoryPositionSnapshot
}

const updatersByDoc = new WeakMap<Y.Doc, Set<BlockMoveUpdater>>()
const historyByMove = new WeakMap<MoveBlockResult, MoveHistory>()

function resolvePosition(
  doc: Y.Doc,
  body: Y.Text,
  relativePosition: Y.RelativePosition,
): number | undefined {
  const absolutePosition = Y.createAbsolutePositionFromRelativePosition(
    relativePosition,
    doc,
  )
  return absolutePosition?.type === body ? absolutePosition.index : undefined
}

function relativePositionAt(
  body: Y.Text,
  index: number,
  assoc: number,
): Y.RelativePosition {
  const position = Y.createRelativePositionFromTypeIndex(body, index, assoc)
  return position.item === null
    ? Y.createRelativePositionFromTypeIndex(body, index, -assoc)
    : position
}

function rememberMove(input: {
  body: Y.Text
  move: MoveBlockResult
  insertion: MoveInsertion
  source?: MoveSource
  mapPosition: (position: number, assoc: number) => number | undefined
}): void {
  const { body, move, insertion, source, mapPosition } = input
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
    movedFrom: relativePositionAt(body, move.from, 1),
    seam: relativePositionAt(body, move.seam, 1),
    insertedSelection: insertion.text.slice(insertion.prefixLength),
    mapPosition,
    ...(source === undefined ? {} : { source }),
    separators,
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
  const validation = validateMove(markdown, input, headings)
  if (validation.isErr()) return err(validation.error)
  const { range, targetLevel } = validation.value
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
  const newFrom = insertedFrom
  const newTo = newFrom + insertion.contentLength
  const structureError = validatePlannedMoveStructure({
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
  rememberMove({
    body,
    move,
    insertion,
    mapPosition: mapDocumentPosition,
    ...(options.replacement === undefined
      ? {
          source: {
            text: sourceText,
            prefix: plannedMove.sourcePrefix,
          },
        }
      : {}),
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
  if (!history) return undefined
  return resolvePosition(doc, getBody(doc), history.movedFrom)
}

export function mapMoveBlockPosition(
  move: MoveBlockResult,
  position: number,
  assoc = 1,
): number | undefined {
  return historyByMove.get(move)?.mapPosition(position, assoc)
}

export function captureMoveBlockHistoryRebaser(
  doc: Y.Doc,
  moves: MoveBlockResult[],
): (
  mapRelativePosition: (position: Y.RelativePosition) => Y.RelativePosition,
  mapAbsolutePosition: (position: number, assoc: number) => number | undefined,
) => void {
  const body = getBody(doc)
  const snapshot = (position: Y.RelativePosition) => {
    const absolute = resolvePosition(doc, body, position)
    return absolute === undefined
      ? undefined
      : { position: absolute, assoc: position.assoc }
  }
  const histories = moves.flatMap((move): MoveHistorySnapshot[] => {
    const history = historyByMove.get(move)
    return history
      ? [
          {
            history,
            movedFrom: snapshot(history.movedFrom),
            seam: snapshot(history.seam),
          },
        ]
      : []
  })

  const rebase = (
    position: Y.RelativePosition,
    savedPosition: HistoryPositionSnapshot,
    mapRelativePosition: (position: Y.RelativePosition) => Y.RelativePosition,
    mapAbsolutePosition: (
      position: number,
      assoc: number,
    ) => number | undefined,
  ) => {
    if (savedPosition === undefined) return mapRelativePosition(position)
    const mappedAbsolute = mapAbsolutePosition(
      savedPosition.position,
      savedPosition.assoc,
    )
    if (mappedAbsolute === undefined) return mapRelativePosition(position)
    return relativePositionAt(body, mappedAbsolute, savedPosition.assoc)
  }

  return (mapRelativePosition, mapAbsolutePosition) => {
    for (const saved of histories) {
      saved.history.movedFrom = rebase(
        saved.history.movedFrom,
        saved.movedFrom,
        mapRelativePosition,
        mapAbsolutePosition,
      )
      saved.history.seam = rebase(
        saved.history.seam,
        saved.seam,
        mapRelativePosition,
        mapAbsolutePosition,
      )
    }
  }
}

export function reverseBlockMove(
  doc: Y.Doc,
  move: MoveBlockResult,
  userEvent: 'undo' | 'redo' = 'undo',
): Result<MoveBlockResult, InvalidBlockMoveError> {
  const history = historyByMove.get(move)
  if (!history)
    return err(new InvalidBlockMoveError('The move cannot be reversed'))

  const body = getBody(doc)
  const from = resolvePosition(doc, body, history.movedFrom)
  const destination = resolvePosition(doc, body, history.seam)
  if (from === undefined || destination === undefined)
    return err(
      new InvalidBlockMoveError('The moved block is no longer available'),
    )

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
    },
  )
}
