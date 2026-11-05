import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'

import { mountMarkdownEditor } from '#editor/markdown-editor.test-utils'

describe('MarkdownEditor IME in WebKit', () => {
  it('commits Japanese composition after Markdown punctuation without changing its order', async () => {
    const { body, content } = mountMarkdownEditor(
      '[reference](https://example.test) ',
    )
    content?.focus()
    content?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    )
    content?.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    )
    content?.dispatchEvent(
      new CompositionEvent('compositionupdate', {
        bubbles: true,
        data: 'にほんご',
      }),
    )
    content?.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: '日本語',
        inputType: 'insertCompositionText',
      }),
    )

    if (content) await userEvent.type(content, '日本語')
    content?.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: '日本語' }),
    )

    const readOutput = () => ({
      body: body.toJSON(),
      visible: content?.textContent,
    })

    expect(readOutput()).toEqual({
      body: '[reference](https://example.test) 日本語',
      visible: 'referencehttps://example.test 日本語',
    })
  })
})
