import { MergeView } from '@codemirror/merge'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useRef } from 'react'

import { editorTheme } from '#editor/theme'

type TextDiffViewProps = {
  original: string
  modified: string
  originalLabel?: string | undefined
  modifiedLabel?: string | undefined
}

export function TextDiffView({
  original,
  modified,
  originalLabel = '変更前',
  modifiedLabel = '変更後',
}: TextDiffViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const parent = hostRef.current
    if (!parent) return

    const readOnlyExtensions = [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      editorTheme,
    ]
    const view = new MergeView({
      a: { doc: original, extensions: readOnlyExtensions },
      b: { doc: modified, extensions: readOnlyExtensions },
      collapseUnchanged: { margin: 3, minSize: 4 },
      highlightChanges: true,
      orientation: 'a-b',
      parent,
    })

    return () => {
      view.destroy()
    }
  }, [modified, original])

  return (
    <section
      aria-label="本文の差分"
      className="overflow-hidden rounded-md border border-border"
      role="region"
    >
      <div className="grid grid-cols-2 border-b border-border bg-muted/30 text-sm font-medium">
        <span className="border-r border-border px-3 py-2">
          {originalLabel}
        </span>
        <span className="px-3 py-2">{modifiedLabel}</span>
      </div>
      <div className="max-h-96 overflow-auto" ref={hostRef} />
    </section>
  )
}
