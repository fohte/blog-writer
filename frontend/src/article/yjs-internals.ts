import * as Y from 'yjs'

export type TrackedId = { client: number; clock: number }

export type InternalItem = {
  id: TrackedId
  length: number
  deleted: boolean
  countable: boolean
  origin: TrackedId | null
  rightOrigin: TrackedId | null
  right: InternalItem | null
}

export const MOVE_CONFLICT_TRANSACTION_ORIGIN = Symbol('move-conflict')

type InternalText = Y.Text & { _start: InternalItem | null }

export function* internalItems(text: Y.Text): Generator<InternalItem> {
  for (let item = (text as InternalText)._start; item; item = item.right) {
    yield item
  }
}
