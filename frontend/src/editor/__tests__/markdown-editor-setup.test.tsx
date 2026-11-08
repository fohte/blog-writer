import type { Extension } from '@codemirror/state'
import { act, createRef, type RefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, vi } from 'vitest'
import * as Y from 'yjs'

import { getBody } from '#article/body'
import type { ArticleImageUploader } from '#editor/image-upload'
import { MarkdownEditor, type MarkdownEditorHandle } from '#editor/index'
import { createMoveHistory, type MoveHistory } from '#outline/index'

interface MountedMarkdownEditor {
  body: Y.Text
  content: HTMLElement | null
  doc: Y.Doc
  editor: RefObject<MarkdownEditorHandle | null>
  history: MoveHistory
  host: HTMLDivElement
  updateExtensions: (extensions: Extension[]) => void
}

type MarkdownEditorMountOptions = {
  articleId?: string
  className?: string
  initialSelection?: { anchor: number; head?: number }
  onEvidenceError?: (message: string) => void
  uploadArticleImage?: ArticleImageUploader
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
  const history = createMoveHistory(doc)

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
        {...(options.initialSelection !== undefined
          ? { initialSelection: options.initialSelection }
          : {})}
        {...(options.onEvidenceError !== undefined
          ? { onEvidenceError: options.onEvidenceError }
          : {})}
        {...(options.uploadArticleImage !== undefined
          ? { uploadArticleImage: options.uploadArticleImage }
          : {})}
        history={history}
        ref={editor}
        text={body}
      />,
    )
  })

  cleanups.push(() => {
    act(() => {
      root.unmount()
    })
    history.destroy()
    doc.destroy()
    host.remove()
  })

  return {
    body,
    content: host.querySelector<HTMLElement>('.cm-content'),
    doc,
    editor,
    history,
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
            {...(options.initialSelection !== undefined
              ? { initialSelection: options.initialSelection }
              : {})}
            {...(options.onEvidenceError !== undefined
              ? { onEvidenceError: options.onEvidenceError }
              : {})}
            {...(options.uploadArticleImage !== undefined
              ? { uploadArticleImage: options.uploadArticleImage }
              : {})}
            history={history}
            ref={editor}
            text={body}
          />,
        )
      })
    },
  }
}
