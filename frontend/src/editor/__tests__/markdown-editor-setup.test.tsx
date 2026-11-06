import type { Extension } from '@codemirror/state'
import { act, createRef, type RefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, vi } from 'vitest'
import * as Y from 'yjs'

import { getBody } from '#article/body'
import { MarkdownEditor, type MarkdownEditorHandle } from '#editor/index'

interface MountedMarkdownEditor {
  body: Y.Text
  content: HTMLElement | null
  doc: Y.Doc
  editor: RefObject<MarkdownEditorHandle | null>
  host: HTMLDivElement
  updateExtensions: (extensions: Extension[]) => void
}

type MarkdownEditorMountOptions = {
  articleId?: string
  className?: string
  onEvidenceError?: (message: string) => void
  prepareDoc?: (doc: Y.Doc) => void
}

const cleanups: (() => void)[] = []

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  for (const cleanup of cleanups) cleanup()
  cleanups.length = 0
  vi.unstubAllGlobals()
})

export function mountMarkdownEditor(
  value: string,
  extensions: Extension[] = [],
  extensionFactory?: (doc: Y.Doc) => Extension[],
  options: MarkdownEditorMountOptions = {},
): MountedMarkdownEditor {
  const host = document.createElement('div')
  document.body.append(host)
  const root: Root = createRoot(host)
  const doc = new Y.Doc()
  const body = getBody(doc)
  body.insert(0, value)
  options.prepareDoc?.(doc)
  const mountedExtensions = [...extensions, ...(extensionFactory?.(doc) ?? [])]
  const editor = createRef<MarkdownEditorHandle>()

  act(() => {
    root.render(
      <MarkdownEditor
        {...(options.articleId !== undefined
          ? { articleId: options.articleId }
          : {})}
        extensions={mountedExtensions}
        {...(options.className !== undefined
          ? { className: options.className }
          : {})}
        {...(options.onEvidenceError !== undefined
          ? { onEvidenceError: options.onEvidenceError }
          : {})}
        ref={editor}
        text={body}
      />,
    )
  })

  cleanups.push(() => {
    act(() => {
      root.unmount()
    })
    doc.destroy()
    host.remove()
  })

  return {
    body,
    content: host.querySelector<HTMLElement>('.cm-content'),
    doc,
    editor,
    host,
    updateExtensions: (extensions) => {
      act(() => {
        root.render(
          <MarkdownEditor
            {...(options.articleId !== undefined
              ? { articleId: options.articleId }
              : {})}
            extensions={extensions}
            {...(options.className !== undefined
              ? { className: options.className }
              : {})}
            {...(options.onEvidenceError !== undefined
              ? { onEvidenceError: options.onEvidenceError }
              : {})}
            ref={editor}
            text={body}
          />,
        )
      })
    },
  }
}
