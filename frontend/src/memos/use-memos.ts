import type { Result } from 'neverthrow'
import { useMemo, useSyncExternalStore } from 'react'
import { v7 } from 'uuid'
import * as Y from 'yjs'

import type { Heading, Memo } from '#article/index'
import {
  addMemo,
  dismissMemo,
  getBody,
  listMemos,
  restoreMemo,
  updateMemoOrder,
} from '#article/index'

type MemoStore = {
  getSnapshot: () => Memo[]
  subscribe: (listener: () => void) => () => void
}

function haveSameHeadings(left: Memo['state'], right: Memo['state']): boolean {
  if (left.kind !== 'adopted' || right.kind !== 'adopted')
    return left.kind === right.kind

  const sameHeading = (leftHeading: Heading, rightHeading: Heading): boolean =>
    leftHeading.level === rightHeading.level &&
    leftHeading.text === rightHeading.text &&
    leftHeading.from === rightHeading.from &&
    leftHeading.to === rightHeading.to &&
    leftHeading.children.length === rightHeading.children.length &&
    leftHeading.children.every((child, index) => {
      const otherChild = rightHeading.children[index]
      return otherChild !== undefined && sameHeading(child, otherChild)
    })

  return sameHeading(left.heading, right.heading)
}

function haveSameMemos(left: Memo[], right: Memo[]): boolean {
  return (
    left.length === right.length &&
    left.every((memo, index) => {
      const otherMemo = right[index]
      return (
        otherMemo !== undefined &&
        memo.id === otherMemo.id &&
        memo.text === otherMemo.text &&
        memo.order === otherMemo.order &&
        haveSameHeadings(memo.state, otherMemo.state)
      )
    })
  )
}

function createMemoStore(doc: Y.Doc): MemoStore {
  let snapshot = listMemos(doc)
  const listeners = new Set<() => void>()
  const memos = doc.getMap('memos')
  const body = getBody(doc)

  const refresh = () => {
    const nextSnapshot = listMemos(doc)
    if (haveSameMemos(snapshot, nextSnapshot)) return
    snapshot = nextSnapshot
    for (const listener of listeners) listener()
  }
  const onBodyUpdate = () => {
    if (!snapshot.some((memo) => memo.state.kind === 'adopted')) return
    refresh()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      if (listeners.size === 0) {
        memos.observeDeep(refresh)
        body.observe(onBodyUpdate)
      }
      listeners.add(listener)
      snapshot = listMemos(doc)

      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          memos.unobserveDeep(refresh)
          body.unobserve(onBodyUpdate)
        }
      }
    },
  }
}

const OPERATION_ERROR = 'メモを更新できませんでした。'

function toOperationError<T, E>(result: Result<T, E>): string | undefined {
  return result.match(
    () => undefined,
    () => OPERATION_ERROR,
  )
}

export function useMemos(doc: Y.Doc) {
  const store = useMemo(() => createMemoStore(doc), [doc])
  const memos = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  )

  return {
    memos,
    add: (text: string): string | undefined => {
      const result = addMemo(doc, {
        id: v7(),
        text,
        order: listMemos(doc).length,
      })

      return toOperationError(result)
    },
    move: (id: string, direction: 'up' | 'down'): string | undefined => {
      const current = listMemos(doc)
      const index = current.findIndex((memo) => memo.id === id)
      const nextIndex = direction === 'up' ? index - 1 : index + 1
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length)
        return undefined

      const reordered = [...current]
      const [memo] = reordered.splice(index, 1)
      if (memo === undefined) return undefined
      reordered.splice(nextIndex, 0, memo)

      const results = doc.transact(() =>
        reordered.map((orderedMemo, order) =>
          updateMemoOrder(doc, orderedMemo.id, order),
        ),
      )
      const errors = results.map(toOperationError)

      return errors.find((error) => error !== undefined)
    },
    dismiss: (id: string): string | undefined => {
      const result = dismissMemo(doc, id)
      return toOperationError(result)
    },
    restore: (id: string): string | undefined => {
      const result = restoreMemo(doc, id)
      return toOperationError(result)
    },
  }
}
