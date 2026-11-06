import { err, ok, Result } from 'neverthrow'
import * as Y from 'yjs'

import { getBody } from '#article/body'
import {
  InvalidHeadingError,
  InvalidMemoError,
  MemoAlreadyExistsError,
  MemoNotFoundError,
} from '#article/errors'
import { deriveHeadingTree } from '#article/headings'
import type { MovePositionMapping } from '#article/move-block'
import type { Heading, Memo, MemoData, MemoState } from '#article/types'

type AddMemoInput = {
  id: string
  text: string
  order: number
}

export type MemoAdoptionSnapshot = {
  id: string
  adoptedTo: unknown
  markerIndex: number
  markerOffset?: number
  headingLevel: number
  headingText: string
}

export type MemoTextRange = { from: number; to: number }

function getMemosMap(doc: Y.Doc): Y.Map<MemoData> {
  return doc.getMap('memos')
}

export function observeMemos(doc: Y.Doc, listener: () => void): () => void {
  const memos = getMemosMap(doc)
  memos.observeDeep(listener)

  return () => {
    memos.unobserveDeep(listener)
  }
}

function getMemoMap(doc: Y.Doc, id: string): MemoData | undefined {
  return getMemosMap(doc).get(id)
}

function memoState(
  doc: Y.Doc,
  memo: MemoData,
  headings?: Heading[],
): MemoState {
  if (memo.get('dismissed') === true) return { kind: 'dismissed' }

  const body = getBody(doc)
  const relativePositionValue = memo.get('adoptedTo')
  if (
    relativePositionValue === null ||
    relativePositionValue === undefined ||
    typeof relativePositionValue !== 'object'
  ) {
    return { kind: 'unorganized' }
  }

  const relativePosition = Y.createRelativePositionFromJSON(
    relativePositionValue,
  )
  const absolutePosition = Y.createAbsolutePositionFromRelativePosition(
    relativePosition,
    doc,
  )
  const itemId = relativePosition.item
  if (!absolutePosition || absolutePosition.type !== body || !itemId) {
    return { kind: 'unorganized' }
  }

  // A deleted anchor can resolve to a replacement character at the same index.
  const item = Y.getItem(doc.store, itemId)
  if (item.deleted) return { kind: 'unorganized' }

  const markerIndex = absolutePosition.index - 1
  const heading = findHeadingAtMarker(
    headings ?? deriveHeadingTree(body.toJSON()),
    markerIndex,
  )
  return heading ? { kind: 'adopted', heading } : { kind: 'unorganized' }
}

function findHeadingAtMarker(
  headings: Heading[],
  markerIndex: number,
): Heading | undefined {
  const visit = (headings: Heading[]): Heading | undefined => {
    for (const heading of headings) {
      if (heading.from === markerIndex) return heading
      const nested = visit(heading.children)
      if (nested) return nested
    }
    return undefined
  }

  return visit(headings)
}

function readMemo(
  doc: Y.Doc,
  id: string,
  memo: MemoData,
  headings?: Heading[],
): Memo {
  const text = memo.get('text')
  const order = memo.get('order')

  return {
    id,
    text: typeof text === 'string' ? text : '',
    order: typeof order === 'number' ? order : 0,
    state: memoState(doc, memo, headings),
  }
}

function requireMemo(
  doc: Y.Doc,
  id: string,
): Result<MemoData, MemoNotFoundError> {
  const memo = getMemoMap(doc, id)
  return memo ? ok(memo) : err(new MemoNotFoundError(id))
}

export function listMemos(doc: Y.Doc): Memo[] {
  const headings = deriveHeadingTree(getBody(doc).toJSON())

  return [...getMemosMap(doc).entries()]
    .map(([id, memo]) => readMemo(doc, id, memo, headings))
    .sort(
      (left, right) =>
        left.order - right.order ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )
}

function flattenHeadings(headings: Heading[]): Heading[] {
  return headings.flatMap((heading) => [
    heading,
    ...flattenHeadings(heading.children),
  ])
}

export function captureDeletedMemoAdoptions(
  doc: Y.Doc,
  getPreviousMarkdown: () => string,
  deletedRanges: readonly MemoTextRange[],
): MemoAdoptionSnapshot[] {
  if (deletedRanges.length === 0) return []

  const body = getBody(doc)
  const adoptedMemos: {
    id: string
    adoptedTo: unknown
    markerIndex: number
  }[] = []

  for (const [id, memo] of getMemosMap(doc).entries()) {
    if (memo.get('dismissed') === true) continue
    const adoptedTo = memo.get('adoptedTo')
    if (
      adoptedTo === null ||
      adoptedTo === undefined ||
      typeof adoptedTo !== 'object'
    ) {
      continue
    }

    const relativePosition = Y.createRelativePositionFromJSON(adoptedTo)
    const absolutePosition = Y.createAbsolutePositionFromRelativePosition(
      relativePosition,
      doc,
    )
    const itemId = relativePosition.item
    if (!absolutePosition || absolutePosition.type !== body || !itemId) continue
    if (Y.getItem(doc.store, itemId).deleted) continue

    adoptedMemos.push({
      id,
      adoptedTo,
      markerIndex: absolutePosition.index - 1,
    })
  }

  if (adoptedMemos.length === 0) return []

  const deletedHeadings = flattenHeadings(
    deriveHeadingTree(getPreviousMarkdown()),
  ).filter((heading) =>
    deletedRanges.some(
      (range) => range.from <= heading.from && heading.from < range.to,
    ),
  )

  return adoptedMemos.flatMap((memo) => {
    const deletedRange = deletedRanges.find(
      (range) => range.from <= memo.markerIndex && memo.markerIndex < range.to,
    )
    const heading = deletedHeadings.find(
      (candidate) => candidate.from === memo.markerIndex,
    )
    return heading && deletedRange
      ? [
          {
            ...memo,
            markerOffset: memo.markerIndex - deletedRange.from,
            headingLevel: heading.level,
            headingText: heading.text,
          },
        ]
      : []
  })
}

export function restoreMemoAdoptions(
  doc: Y.Doc,
  snapshots: readonly MemoAdoptionSnapshot[],
  insertedRanges: readonly MemoTextRange[],
): void {
  if (snapshots.length === 0 || insertedRanges.length === 0) return

  const body = getBody(doc)
  const headings = flattenHeadings(deriveHeadingTree(body.toJSON()))
  for (const snapshot of snapshots) {
    const markerOffset = snapshot.markerOffset ?? 0
    const insertion = insertedRanges.find(
      (range) =>
        range.from === snapshot.markerIndex &&
        range.from + markerOffset < range.to,
    )
    if (!insertion) continue
    const markerIndex = insertion.from + markerOffset

    if (markerIndex < insertion.from || markerIndex >= insertion.to) continue

    const memo = getMemoMap(doc, snapshot.id)
    if (
      !memo ||
      memo.get('dismissed') === true ||
      JSON.stringify(memo.get('adoptedTo')) !==
        JSON.stringify(snapshot.adoptedTo)
    ) {
      continue
    }

    const heading = headings.find(
      (candidate) =>
        candidate.from === markerIndex &&
        candidate.level === snapshot.headingLevel &&
        candidate.text === snapshot.headingText,
    )
    if (!heading) continue

    const relativePosition = Y.createRelativePositionFromTypeIndex(
      body,
      markerIndex + 1,
      -1,
    )
    memo.set('adoptedTo', Y.relativePositionToJSON(relativePosition))
  }
}

export function addMemo(
  doc: Y.Doc,
  input: AddMemoInput,
): Result<Memo, InvalidMemoError | MemoAlreadyExistsError> {
  if (input.id.length === 0)
    return err(new InvalidMemoError('Memo ID must not be empty'))
  if (!Number.isFinite(input.order))
    return err(new InvalidMemoError('Memo order must be finite'))
  if (getMemoMap(doc, input.id))
    return err(new MemoAlreadyExistsError(input.id))

  const memo = new Y.Map<unknown>()
  memo.set('text', input.text)
  memo.set('order', input.order)
  getMemosMap(doc).set(input.id, memo)

  return ok(readMemo(doc, input.id, memo))
}

export function updateMemoOrder(
  doc: Y.Doc,
  id: string,
  order: number,
): Result<void, InvalidMemoError | MemoNotFoundError> {
  if (!Number.isFinite(order))
    return err(new InvalidMemoError('Memo order must be finite'))
  return requireMemo(doc, id).map((memo) => {
    memo.set('order', order)
  })
}

export function dismissMemo(
  doc: Y.Doc,
  id: string,
): Result<void, MemoNotFoundError> {
  return requireMemo(doc, id).map((memo) => {
    memo.set('dismissed', true)
  })
}

export function restoreMemo(
  doc: Y.Doc,
  id: string,
): Result<void, MemoNotFoundError> {
  return requireMemo(doc, id).map((memo) => {
    memo.delete('dismissed')
    memo.delete('adoptedTo')
  })
}

export function setMemoAdoptedTo(
  doc: Y.Doc,
  id: string,
  markerIndex: number,
): Result<void, MemoNotFoundError | InvalidHeadingError> {
  const body = getBody(doc)
  const heading = findHeadingAtMarker(
    deriveHeadingTree(body.toJSON()),
    markerIndex,
  )
  if (!heading) return err(new InvalidHeadingError(markerIndex))

  return requireMemo(doc, id).map((memo) => {
    const relativePosition = Y.createRelativePositionFromTypeIndex(
      body,
      markerIndex + 1,
      -1,
    )
    memo.set('adoptedTo', Y.relativePositionToJSON(relativePosition))
    memo.delete('dismissed')
  })
}

export function prepareMemoAnchorMove(
  doc: Y.Doc,
  mapping: MovePositionMapping,
): () => void {
  const body = getBody(doc)
  const relocations: { memo: MemoData; index: number }[] = []

  for (const memo of getMemosMap(doc).values()) {
    const relativePositionValue = memo.get('adoptedTo')
    if (
      relativePositionValue === null ||
      relativePositionValue === undefined ||
      typeof relativePositionValue !== 'object'
    ) {
      continue
    }

    const relativePosition = Y.createRelativePositionFromJSON(
      relativePositionValue,
    )
    const absolutePosition = Y.createAbsolutePositionFromRelativePosition(
      relativePosition,
      doc,
    )
    const itemId = relativePosition.item
    if (!absolutePosition || absolutePosition.type !== body || !itemId) continue
    if (Y.getItem(doc.store, itemId).deleted) continue

    const oldIndex = absolutePosition.index - 1
    const newIndex = mapping.mapPosition(oldIndex)
    if (newIndex === undefined) continue
    relocations.push({ memo, index: newIndex })
  }

  return () => {
    for (const { memo, index } of relocations) {
      const newPosition = Y.createRelativePositionFromTypeIndex(
        body,
        index + 1,
        -1,
      )
      memo.set('adoptedTo', Y.relativePositionToJSON(newPosition))
    }
  }
}

export function getMemoState(
  doc: Y.Doc,
  id: string,
): Result<MemoState, MemoNotFoundError> {
  return requireMemo(doc, id).map((memo) => memoState(doc, memo))
}
