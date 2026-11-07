import type { EditorView } from '@codemirror/view'
import { useState } from 'react'
import * as Y from 'yjs'

import type { Memo } from '#article/index'
import { MemoPanelView } from '#components/memo-panel-view'
import { useArticleHeadings } from '#hooks/use-article-headings'
import {
  adoptMemoToHeading,
  insertMemoAsHeading,
  memoAdoptionErrorMessage,
} from '#memos/adoption'
import { useMemos } from '#memos/use-memos'

type MemoPanelProps = {
  doc: Y.Doc
  view?: EditorView
}

export function MemoPanel({ doc, view }: MemoPanelProps) {
  const { memos, add, move, dismiss, restore } = useMemos(doc)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string>()
  const { headings } = useArticleHeadings(doc)
  const [openAdoptionMenuId, setOpenAdoptionMenuId] = useState<string>()
  const [filter, setFilter] = useState<Memo['state']['kind']>('unorganized')
  // A remote edit can move the memo out of the filter, and a stale ID would
  // reopen its menu once the memo returns.
  if (
    openAdoptionMenuId !== undefined &&
    !memos.some(
      (memo) => memo.id === openAdoptionMenuId && memo.state.kind === filter,
    )
  )
    setOpenAdoptionMenuId(undefined)

  const apply = (operation: () => string | undefined) => {
    const nextError = operation()
    setError(nextError)
    return nextError === undefined
  }

  return (
    <MemoPanelView
      draft={draft}
      error={error}
      filter={filter}
      headings={headings}
      memos={memos}
      openAdoptionMenuId={openAdoptionMenuId}
      onAddMemo={() => {
        if (apply(() => add(draft))) setDraft('')
      }}
      onAdoptToHeading={(memoId, markerIndex) => {
        apply(() =>
          memoAdoptionErrorMessage(() =>
            adoptMemoToHeading(doc, memoId, markerIndex),
          ),
        )
      }}
      onDismissMemo={(id) => {
        apply(() => dismiss(id))
      }}
      onDraftChange={setDraft}
      onFilterChange={setFilter}
      {...(view === undefined
        ? {}
        : {
            onInsertAsHeading: (memoId: string, beforeFrom?: number) => {
              apply(() =>
                memoAdoptionErrorMessage(() =>
                  insertMemoAsHeading(doc, view, memoId, beforeFrom),
                ),
              )
            },
          })}
      onMoveMemo={(id, direction) => {
        apply(() => move(id, direction))
      }}
      onOpenAdoptionMenuChange={setOpenAdoptionMenuId}
      onRestoreMemo={(id) => {
        apply(() => restore(id))
      }}
    />
  )
}
