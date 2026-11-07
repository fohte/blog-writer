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
  observeMemos,
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
  const body = getBody(doc)
  let stopObservingMemos: (() => void) | undefined

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
        stopObservingMemos = observeMemos(doc, refresh)
        body.observe(onBodyUpdate)
      }
      listeners.add(listener)
      snapshot = listMemos(doc)

      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          stopObservingMemos?.()
          stopObservingMemos = undefined
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
      const memo = current.find((candidate) => candidate.id === id)
      if (memo === undefined) return undefined
      // The panel lists one state at a time, so a move passes over memos in
      // the other states instead of swapping with an invisible neighbor.
      const peers = current.filter(
        (candidate) => candidate.state.kind === memo.state.kind,
      )
      const peerIndex = peers.indexOf(memo)
      const neighbor = peers[direction === 'up' ? peerIndex - 1 : peerIndex + 1]
      if (neighbor === undefined) return undefined

      const reordered = current.filter((candidate) => candidate !== memo)
      const neighborIndex = reordered.indexOf(neighbor)
      reordered.splice(
        direction === 'up' ? neighborIndex : neighborIndex + 1,
        0,
        memo,
      )

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
