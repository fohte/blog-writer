import { useMemo, useSyncExternalStore } from 'react'
import { v7 } from 'uuid'
import * as Y from 'yjs'

import type { Memo } from '#article/index'
import {
  addMemo,
  dismissMemo,
  listMemos,
  restoreMemo,
  updateMemoOrder,
} from '#article/index'

type MemoStore = {
  getSnapshot: () => Memo[]
  subscribe: (listener: () => void) => () => void
}

function createMemoStore(doc: Y.Doc): MemoStore {
  let snapshot = listMemos(doc)
  const listeners = new Set<() => void>()

  const onUpdate = () => {
    snapshot = listMemos(doc)
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      if (listeners.size === 0) doc.on('update', onUpdate)
      listeners.add(listener)
      snapshot = listMemos(doc)

      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) doc.off('update', onUpdate)
      }
    },
  }
}

function getOperationError(): string {
  return 'メモを更新できませんでした。'
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

      return result.match(
        () => undefined,
        () => getOperationError(),
      )
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
      const errors = results.map((result) =>
        result.match(
          () => undefined,
          () => getOperationError(),
        ),
      )

      return errors.find((error) => error !== undefined)
    },
    dismiss: (id: string): string | undefined => {
      const result = dismissMemo(doc, id)
      return result.match(
        () => undefined,
        () => getOperationError(),
      )
    },
    restore: (id: string): string | undefined => {
      const result = restoreMemo(doc, id)
      return result.match(
        () => undefined,
        () => getOperationError(),
      )
    },
  }
}
