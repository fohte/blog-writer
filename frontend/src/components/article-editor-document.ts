import type { Extension } from '@codemirror/state'
import { useCallback, useSyncExternalStore } from 'react'
import type * as Y from 'yjs'

import { getBody, listMemos } from '#article/index'
import { createMoveHistory, type MoveHistory } from '#outline/index'

// Extension instances may hold article state and must survive StrictMode replays.
const moveHistoriesByDocument = new WeakMap<Y.Doc, MoveHistory>()
const extensionsByDocument = new WeakMap<Y.Doc, Extension[]>()

export function getMoveHistory(doc: Y.Doc) {
  const existing = moveHistoriesByDocument.get(doc)
  if (existing) return existing
  const history = createMoveHistory(doc)
  moveHistoriesByDocument.set(doc, history)
  return history
}

export function getCachedEditorExtensions(
  doc: Y.Doc,
  history: MoveHistory,
  factory: (context: { doc: Y.Doc; history: MoveHistory }) => Extension[],
) {
  const existing = extensionsByDocument.get(doc)
  if (existing) return existing
  const extensions = factory({ doc, history })
  extensionsByDocument.set(doc, extensions)
  return extensions
}

export function useEmptyArticle(doc: Y.Doc | undefined) {
  const subscribe = useCallback(
    (listener: () => void) => {
      doc?.on('update', listener)
      return () => {
        doc?.off('update', listener)
      }
    },
    [doc],
  )
  return useSyncExternalStore(
    subscribe,
    () =>
      doc !== undefined &&
      getBody(doc).length === 0 &&
      listMemos(doc).length === 0,
  )
}
