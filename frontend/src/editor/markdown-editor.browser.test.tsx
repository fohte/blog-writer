import { EditorView } from '@codemirror/view'
import { act, createRef, type RefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { getBody } from '#article/body'
import { MarkdownEditor, type MarkdownEditorHandle } from '#editor/index'

let host: HTMLDivElement | undefined
let root: Root | undefined
let editor: RefObject<MarkdownEditorHandle | null> | undefined
let doc = new Y.Doc()

function mountEditor(value: string) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  doc.destroy()
  doc = new Y.Doc()
  getBody(doc).insert(0, value)
  editor = createRef<MarkdownEditorHandle>()

  act(() => {
    root?.render(
      <MarkdownEditor
        ariaLabel="Draft body"
        extensions={[
          EditorView.contentAttributes.of({ 'data-extension': 'included' }),
        ]}
        ref={editor}
        text={getBody(doc)}
      />,
    )
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  doc.destroy()
  root = undefined
  host?.remove()
  host = undefined
  editor = undefined
  doc = new Y.Doc()
  vi.unstubAllGlobals()
})

describe('MarkdownEditor', () => {
  it('formats Markdown and accepts extra extensions', () => {
    mountEditor('## Heading **bold** and `code`')
    const content = host?.querySelector<HTMLElement>('.cm-content')
    content?.focus()
    content?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    )
    content?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    )
    content?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    )

    const readOutput = () => ({
      text: content?.textContent,
      extension: content?.getAttribute('data-extension'),
      headingClass: host?.querySelector('.cm-line')?.className,
    })

    expect(readOutput()).toEqual({
      text: 'Heading bold and code',
      extension: 'included',
      headingClass: 'cm-line cm-md-heading cm-md-heading-2',
    })
  })

  it('replaces only changed text while keeping positions in unchanged text', () => {
    mountEditor('prefix 🦊 original suffix')
    const body = getBody(doc)
    const prefix = Y.createRelativePositionFromTypeIndex(body, 3)
    const suffix = Y.createRelativePositionFromTypeIndex(body, 19)

    act(() => {
      editor?.current?.replaceBody('prefix 🦊 new suffix')
    })

    const readOutput = () => ({
      body: body.toJSON(),
      prefix: Y.createAbsolutePositionFromRelativePosition(prefix, doc)?.index,
      suffix: Y.createAbsolutePositionFromRelativePosition(suffix, doc)?.index,
    })

    expect(readOutput()).toEqual({
      body: 'prefix 🦊 new suffix',
      prefix: 3,
      suffix: 14,
    })
  })

  it('undoes a body replacement in one Yjs undo step', () => {
    mountEditor('before body after')
    const content = host?.querySelector<HTMLElement>('.cm-content')

    act(() => {
      editor?.current?.replaceBody('before imported after')
    })
    content?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        bubbles: true,
        [navigator.platform.includes('Mac') ? 'metaKey' : 'ctrlKey']: true,
      }),
    )

    expect(getBody(doc).toJSON()).toEqual('before body after')
  })
})
