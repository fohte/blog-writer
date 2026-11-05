import { Annotation, Transaction } from '@codemirror/state'
import { err, ok, Result } from 'neverthrow'
import * as Y from 'yjs'

import { getBody } from '#article/body'
import { InvalidBlockMoveError } from '#article/errors'
import { prepareMemoAnchorMove } from '#article/memos'
import {
  collectHeadings,
  getInsertionText,
  mapWithinRange,
  sectionReplacements,
  transformedText,
  validateMove,
} from '#article/move-block-plan'

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

type AnchoredTextRange = {
  from: Y.RelativePosition
  to: Y.RelativePosition
  text: string
}
type MoveHistory = {
  movedFrom: Y.RelativePosition
  seam: Y.RelativePosition
  insertedSelection: string
  sourceText?: string
  sourcePrefix: string
  separators: AnchoredTextRange[]
}
type ApplyMoveOptions = {
  expectedSelection?: string
  replacementText?: string
  replacementPrefix?: string
  removeRanges?: AnchoredTextRange[]
}

const updatersByDoc = new WeakMap<Y.Doc, Set<BlockMoveUpdater>>()
const historyByMove = new WeakMap<MoveBlockResult, MoveHistory>()

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

function resolveTextRange(
  doc: Y.Doc,
  body: Y.Text,
  markdown: string,
  anchoredRange: AnchoredTextRange,
): { from: number; to: number } | undefined {
  const from = resolvePosition(doc, body, anchoredRange.from)
  const to = resolvePosition(doc, body, anchoredRange.to)
  if (
    from === undefined ||
    to === undefined ||
    to < from ||
    markdown.slice(from, to) !== anchoredRange.text
  ) {
    return undefined
  }
  return { from, to }
}

function rememberMove(
  body: Y.Text,
  move: MoveBlockResult,
  insertionIndex: number,
  insertion: { text: string; prefixLength: number; contentLength: number },
  sourceText: string,
  sourcePrefix: string,
  restoreSource: boolean,
): void {
  const prefix = insertion.text.slice(0, insertion.prefixLength)
  const suffix = insertion.text.slice(
    insertion.prefixLength + insertion.contentLength,
  )
  const moveTo = move.to
  const separators: AnchoredTextRange[] = []
  if (prefix.length > 0) {
    separators.push({
      from: Y.createRelativePositionFromTypeIndex(body, insertionIndex, 1),
      to: Y.createRelativePositionFromTypeIndex(body, move.from, -1),
      text: prefix,
    })
  }
  if (suffix.length > 0) {
    separators.push({
      from: Y.createRelativePositionFromTypeIndex(body, moveTo, 1),
      to: Y.createRelativePositionFromTypeIndex(
        body,
        moveTo + suffix.length,
        -1,
      ),
      text: suffix,
    })
  }
  historyByMove.set(move, {
    movedFrom: Y.createRelativePositionFromTypeIndex(body, move.from, 1),
    seam: Y.createRelativePositionFromTypeIndex(body, move.seam, 1),
    insertedSelection: insertion.text.slice(insertion.prefixLength),
    ...(restoreSource ? { sourceText } : {}),
    sourcePrefix: restoreSource ? sourcePrefix : '',
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
  const removeRanges = (options.removeRanges ?? []).map((anchoredRange) =>
    resolveTextRange(doc, body, markdown, anchoredRange),
  )
  if (removeRanges.some((resolved) => resolved === undefined))
    return err(new InvalidBlockMoveError('A moved separator has changed'))
  const resolvedRanges = removeRanges.filter(
    (resolved): resolved is { from: number; to: number } =>
      resolved !== undefined,
  )
  const removeFrom = Math.min(
    range.from,
    ...resolvedRanges.map((resolved) => resolved.from),
  )
  const removeTo = Math.max(
    range.to,
    ...resolvedRanges.map((resolved) => resolved.to),
  )
  const remainingBeforeNormalization =
    markdown.slice(0, removeFrom) + markdown.slice(removeTo)
  const sourceSeparator =
    options.replacementText === undefined && removeTo === markdown.length
      ? normalizeTrailingNewlines(remainingBeforeNormalization)
      : { text: remainingBeforeNormalization, removed: '' }
  const deletionFrom = removeFrom - sourceSeparator.removed.length
  const removedLength = removeTo - deletionFrom
  const insertionIndex =
    input.destination >= removeTo
      ? input.destination - removedLength
      : input.destination >= deletionFrom
        ? deletionFrom
        : input.destination
  const remaining = sourceSeparator.text
  const insertion =
    options.replacementText === undefined
      ? getInsertionText(remaining, insertionIndex, movedText)
      : {
          text: (options.replacementPrefix ?? '') + options.replacementText,
          prefixLength: (options.replacementPrefix ?? '').length,
          contentLength: options.replacementText.length,
        }
  const newFrom = insertionIndex + insertion.prefixLength
  const newTo = newFrom + insertion.contentLength
  const seam =
    insertionIndex < removeFrom
      ? deletionFrom + insertion.text.length
      : deletionFrom
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
  rememberMove(
    body,
    move,
    insertionIndex,
    insertion,
    sourceText,
    sourceSeparator.removed,
    options.replacementText === undefined,
  )
  return ok(move)
}

export function moveBlock(
  doc: Y.Doc,
  input: MoveBlockInput,
): Result<MoveBlockResult, InvalidBlockMoveError> {
  return applyMoveBlock(doc, input)
}

export function reverseBlockMove(
  doc: Y.Doc,
  move: MoveBlockResult,
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

  return applyMoveBlock(
    doc,
    {
      from,
      destination,
      ...(move.originalHeadingLevel === undefined
        ? {}
        : { headingLevel: move.originalHeadingLevel }),
      userEvent: 'undo',
    },
    {
      expectedSelection: history.insertedSelection,
      ...(history.sourceText === undefined
        ? {}
        : { replacementText: history.sourceText }),
      replacementPrefix: history.sourcePrefix,
      removeRanges: history.separators,
    },
  )
}
