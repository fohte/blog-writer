import { useState } from 'react'
import * as Y from 'yjs'

import { MemoPanelView } from '#components/memo-panel-view'
import { useMemos } from '#memos/use-memos'

type MemoPanelProps = {
  doc: Y.Doc
}

export function MemoPanel({ doc }: MemoPanelProps) {
  const { memos, add, move, dismiss, restore } = useMemos(doc)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string>()

  const apply = (operation: () => string | undefined) => {
    const nextError = operation()
    setError(nextError)
    return nextError === undefined
  }

  return (
    <MemoPanelView
      draft={draft}
      error={error}
      memos={memos}
      onAddMemo={() => {
        if (apply(() => add(draft))) setDraft('')
      }}
      onDismissMemo={(id) => {
        apply(() => dismiss(id))
      }}
      onDraftChange={setDraft}
      onMoveMemo={(id, direction) => {
        apply(() => move(id, direction))
      }}
      onRestoreMemo={(id) => {
        apply(() => restore(id))
      }}
    />
  )
}
