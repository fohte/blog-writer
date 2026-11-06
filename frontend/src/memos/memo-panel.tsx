import type { EditorView } from '@codemirror/view'
import { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'

import { deriveHeadingTree, getBody, readBody } from '#article/index'
import { MemoPanelView } from '#components/memo-panel-view'
import { adoptMemoToHeading, insertMemoAsHeading } from '#memos/adoption'
import { useMemos } from '#memos/use-memos'

type MemoPanelProps = {
  doc: Y.Doc
  view?: EditorView
}

export function MemoPanel({ doc, view }: MemoPanelProps) {
  const { memos, add, move, dismiss, restore } = useMemos(doc)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string>()
  const [markdown, setMarkdown] = useState(() => readBody(doc))
  const [openAdoptionMenuId, setOpenAdoptionMenuId] = useState<string>()
  const headings = useMemo(() => deriveHeadingTree(markdown), [markdown])

  useEffect(() => {
    const body = getBody(doc)
    const update = () => {
      setMarkdown(body.toJSON())
    }
    update()
    body.observe(update)
    return () => {
      body.unobserve(update)
    }
  }, [doc])

  const apply = (operation: () => string | undefined) => {
    const nextError = operation()
    setError(nextError)
    return nextError === undefined
  }

  return (
    <MemoPanelView
      draft={draft}
      error={error}
      headings={headings}
      memos={memos}
      openAdoptionMenuId={openAdoptionMenuId}
      onAddMemo={() => {
        if (apply(() => add(draft))) setDraft('')
      }}
      onAdoptToHeading={(memoId, markerIndex) => {
        apply(() =>
          adoptMemoToHeading(doc, memoId, markerIndex).match(
            () => undefined,
            () => 'メモを更新できませんでした。',
          ),
        )
      }}
      onDismissMemo={(id) => {
        apply(() => dismiss(id))
      }}
      onDraftChange={setDraft}
      {...(view === undefined
        ? {}
        : {
            onInsertAsHeading: (memoId: string, beforeFrom?: number) => {
              apply(() =>
                insertMemoAsHeading(doc, view, memoId, beforeFrom).match(
                  () => undefined,
                  () => 'メモを更新できませんでした。',
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
