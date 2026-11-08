import { useEffect, useState } from 'react'
import type * as Y from 'yjs'

import { countBodyCharacters, getBody } from '#article/index'
import { EditorStatusBar } from '#components/editor-status-bar'
import { loadLlmSettings } from '#lib/llm-settings'
import type { SyncState } from '#lib/sync-client'

type EditorStatusBarContainerProps = {
  doc: Y.Doc | undefined
  syncStatus: SyncState | undefined
  syncedAt: number | undefined
}

export function EditorStatusBarContainer({
  doc,
  syncStatus,
  syncedAt,
}: EditorStatusBarContainerProps) {
  const [characterCount, setCharacterCount] = useState<number>()
  const [llmRoute] = useState(() =>
    loadLlmSettings(() => window.localStorage).match(
      ({ route }) => route,
      () => undefined,
    ),
  )

  useEffect(() => {
    if (!doc) return
    const body = getBody(doc)
    const update = () => {
      setCharacterCount(countBodyCharacters(body.toJSON()))
    }
    update()
    body.observe(update)
    return () => {
      body.unobserve(update)
    }
  }, [doc])

  return (
    <EditorStatusBar
      characterCount={characterCount}
      llmRoute={llmRoute}
      syncStatus={syncStatus}
      syncedAt={syncedAt}
    />
  )
}
