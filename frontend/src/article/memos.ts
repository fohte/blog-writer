import { err, ok, Result } from 'neverthrow'
import * as Y from 'yjs'

import {
  InvalidHeadingError,
  InvalidMemoError,
  MemoAlreadyExistsError,
  MemoNotFoundError,
} from '#article/errors'
import { deriveHeadingTree } from '#article/headings'
import type { Heading, Memo, MemoData, MemoState } from '#article/types'

type AddMemoInput = {
  id: string
  text: string
  order: number
}

function getMemosMap(doc: Y.Doc): Y.Map<MemoData> {
  return doc.getMap('memos')
}

function getMemoMap(doc: Y.Doc, id: string): MemoData | undefined {
  return getMemosMap(doc).get(id)
}

function memoState(doc: Y.Doc, memo: MemoData): MemoState {
  if (memo.get('dismissed') === true) return { kind: 'dismissed' }

  const body = doc.getText('body')
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
  const heading = findHeadingAtMarker(body.toJSON(), markerIndex)
  return heading ? { kind: 'adopted', heading } : { kind: 'unorganized' }
}

function findHeadingAtMarker(
  markdown: string,
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

  return visit(deriveHeadingTree(markdown))
}

function readMemo(doc: Y.Doc, id: string, memo: MemoData): Memo {
  const text = memo.get('text')
  const order = memo.get('order')

  return {
    id,
    text: typeof text === 'string' ? text : '',
    order: typeof order === 'number' ? order : 0,
    state: memoState(doc, memo),
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
  return [...getMemosMap(doc).entries()]
    .map(([id, memo]) => readMemo(doc, id, memo))
    .sort(
      (left, right) =>
        left.order - right.order ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )
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
  const body = doc.getText('body')
  const heading = findHeadingAtMarker(body.toJSON(), markerIndex)
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

export function getMemoState(
  doc: Y.Doc,
  id: string,
): Result<MemoState, MemoNotFoundError> {
  return requireMemo(doc, id).map((memo) => memoState(doc, memo))
}
