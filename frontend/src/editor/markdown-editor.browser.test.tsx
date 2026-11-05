import { EditorView } from '@codemirror/view'
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { mountMarkdownEditor } from '#editor/markdown-editor.test-utils'

describe('MarkdownEditor', () => {
  it('formats Markdown source', () => {
    const { content, host } = mountMarkdownEditor(
      '## Heading **bold** and `code`',
    )
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
      headingClass: host.querySelector('.cm-line')?.className,
    })

    expect(readOutput()).toEqual({
      text: 'Heading bold and code',
      headingClass: 'cm-line cm-md-heading cm-md-heading-2',
    })
  })

  it('accepts additional CodeMirror extensions', () => {
    const { content } = mountMarkdownEditor('body', [
      EditorView.contentAttributes.of({ 'data-extension': 'included' }),
    ])

    expect(content?.getAttribute('data-extension')).toEqual('included')
  })

  it('reconfigures extensions without remounting the editor', () => {
    const { content, host, updateExtensions } = mountMarkdownEditor('body')
    updateExtensions([
      EditorView.contentAttributes.of({ 'data-extension': 'included' }),
    ])

    const updatedContent = host.querySelector<HTMLElement>('.cm-content')
    const readOutput = () => ({
      sameContentElement: updatedContent === content,
      text: updatedContent?.textContent,
      extension: updatedContent?.getAttribute('data-extension'),
    })

    expect(readOutput()).toEqual({
      sameContentElement: true,
      text: 'body',
      extension: 'included',
    })
  })

  it('shows Markdown markers when the cursor touches them', () => {
    const { content } = mountMarkdownEditor('**bold**')

    expect(content?.textContent).toEqual('**bold')
  })

  it('replaces only changed text while keeping positions in unchanged text', () => {
    const { body, doc, editor } = mountMarkdownEditor(
      'prefix 🦊 original suffix',
    )
    const prefix = Y.createRelativePositionFromTypeIndex(body, 3)
    const suffix = Y.createRelativePositionFromTypeIndex(body, 19)

    act(() => {
      editor.current?.replaceBody('prefix 🦊 new suffix')
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
    const { body, content, editor } = mountMarkdownEditor('before body after')

    act(() => {
      editor.current?.replaceBody('before imported after')
    })
    content?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        bubbles: true,
        [navigator.platform.includes('Mac') ? 'metaKey' : 'ctrlKey']: true,
      }),
    )

    expect(body.toJSON()).toEqual('before body after')
  })
})
