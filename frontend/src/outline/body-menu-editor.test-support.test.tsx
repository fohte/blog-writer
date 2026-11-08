import type { EditorView } from '@codemirror/view'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import * as Y from 'yjs'

import { getBody, setBody } from '#article/index'
import { MarkdownEditor } from '#components/markdown-editor'
import { createMoveHistory, createOutlineEditorExtension } from '#outline/index'

export function createBodyMenuEditor(markdownText: string) {
  const doc = new Y.Doc()
  setBody(doc, markdownText)
  const body = getBody(doc)
  const history = createMoveHistory(doc)
  const editorHost = document.createElement('div')
  document.body.append(editorHost)
  const root: Root = createRoot(editorHost)
  const viewRef: { current: EditorView | null } = { current: null }
  act(() => {
    root.render(
      createElement(MarkdownEditor, {
        extensions: [createOutlineEditorExtension(history)],
        history,
        onViewChange: (view) => {
          viewRef.current = view
        },
        text: body,
      }),
    )
  })
  const view = viewRef.current
  if (!view) throw new Error('The markdown editor did not mount')

  const cleanup = () => {
    act(() => {
      root.unmount()
    })
    history.destroy()
    doc.destroy()
    editorHost.remove()
  }

  return { body, cleanup, doc, history, view }
}
