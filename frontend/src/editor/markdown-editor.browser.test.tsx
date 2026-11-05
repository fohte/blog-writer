import { EditorView } from '@codemirror/view'
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import * as Y from 'yjs'

import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'

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

  it('shows the opening Markdown marker when the cursor touches it', () => {
    const { content } = mountMarkdownEditor('**bold**')

    expect(content?.textContent).toEqual('**bold')
  })

  it('shows Markdown markers touched by the selection', () => {
    const { content } = mountMarkdownEditor('**bold**')
    const view = content ? EditorView.findFromDOM(content) : null
    view?.dispatch({ selection: { anchor: 0, head: 8 } })

    expect(content?.textContent).toEqual('**bold**')
  })

  it('preserves positions between separated body edits', () => {
    const { body, doc, editor } = mountMarkdownEditor('red 🦊 middle blue')
    const middle = Y.createRelativePositionFromTypeIndex(body, 9)

    act(() => {
      editor.current?.replaceBody('longer 🦊 middle gold')
    })

    const readOutput = () => ({
      body: body.toJSON(),
      middle: Y.createAbsolutePositionFromRelativePosition(middle, doc)?.index,
    })

    expect(readOutput()).toEqual({
      body: 'longer 🦊 middle gold',
      middle: 12,
    })
  })

  it('undoes a body replacement in one Yjs undo step', () => {
    const { body, content, editor } = mountMarkdownEditor('red 🦊 middle blue')

    act(() => {
      editor.current?.replaceBody('longer 🦊 middle gold')
    })
    content?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        bubbles: true,
        [navigator.platform.includes('Mac') ? 'metaKey' : 'ctrlKey']: true,
      }),
    )

    expect(body.toJSON()).toEqual('red 🦊 middle blue')
  })

  it('applies a capped body replacement in one Yjs undo step', () => {
    const unchanged = ' anchor '
    const previous = `${'a'.repeat(4_000)}${unchanged}${'a'.repeat(4_000)}\n`
    const replacement = `${'b'.repeat(4_000)}${unchanged}${'b'.repeat(4_000)}\n`
    const { body, content, editor } = mountMarkdownEditor(previous)

    act(() => {
      editor.current?.replaceBody(replacement)
    })
    const bodyAfterReplace = body.toJSON()
    content?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        bubbles: true,
        [navigator.platform.includes('Mac') ? 'metaKey' : 'ctrlKey']: true,
      }),
    )

    const readOutput = () => ({
      bodyAfterReplace,
      bodyAfterUndo: body.toJSON(),
    })

    expect(readOutput()).toEqual({
      bodyAfterReplace: replacement,
      bodyAfterUndo: previous,
    })
  })

  it('keeps typing before a body replacement in a separate Yjs undo step', async () => {
    const { body, content, editor } = mountMarkdownEditor('original body')
    content?.focus()
    await userEvent.keyboard('{End}')
    await userEvent.keyboard('!')

    act(() => {
      editor.current?.replaceBody('imported body')
    })
    content?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        bubbles: true,
        [navigator.platform.includes('Mac') ? 'metaKey' : 'ctrlKey']: true,
      }),
    )

    expect(body.toJSON()).toEqual('original body!')
  })
})
