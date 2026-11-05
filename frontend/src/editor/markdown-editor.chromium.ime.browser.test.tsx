import { describe, expect, it } from 'vitest'
import { cdp } from 'vitest/browser'

import { mountMarkdownEditor } from '#editor/markdown-editor.test-utils'

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve()
    })
  })
}

describe('MarkdownEditor IME in Chromium', () => {
  it('keeps source markup visible during Japanese composition and commits it once', async () => {
    const { body, content } = mountMarkdownEditor('**word')
    content?.focus()
    content?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    )

    await cdp().send('Input.imeSetComposition', {
      text: '**日本語',
      selectionStart: 5,
      selectionEnd: 5,
    })
    await nextFrame()

    const composingOutput = {
      body: body.toJSON(),
      visible: content?.textContent,
    }
    await cdp().send('Input.insertText', { text: '**日本語' })
    await nextFrame()

    const readOutput = () => ({
      duringComposition: composingOutput,
      committedBody: body.toJSON(),
      committedVisible: content?.textContent,
    })

    expect(readOutput()).toEqual({
      duringComposition: { body: '**word**日本語', visible: '**word**日本語' },
      committedBody: '**word**日本語',
      committedVisible: 'word日本語',
    })
  })

  it('keeps later Markdown decorations aligned while composing at the start', async () => {
    const { body, content } = mountMarkdownEditor('**before** **after**')
    content?.focus()

    await cdp().send('Input.imeSetComposition', {
      text: '日本語',
      selectionStart: 3,
      selectionEnd: 3,
    })
    await nextFrame()

    const composingOutput = {
      body: body.toJSON(),
      visible: content?.textContent,
    }
    await cdp().send('Input.insertText', { text: '日本語' })
    await nextFrame()

    const readOutput = () => ({
      duringComposition: composingOutput,
      committedBody: body.toJSON(),
      committedVisible: content?.textContent,
    })

    expect(readOutput()).toEqual({
      duringComposition: {
        body: '日本語**before** **after**',
        visible: '日本語**before after',
      },
      committedBody: '日本語**before** **after**',
      committedVisible: '日本語**before after',
    })
  })
})
