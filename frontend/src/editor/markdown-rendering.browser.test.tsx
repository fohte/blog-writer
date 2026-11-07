import { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'

import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'

describe('Markdown rendering', () => {
  it('hides link destinations while the cursor is outside the link', () => {
    const { content } = mountMarkdownEditor('before [label](url) after')

    expect(content?.textContent).toEqual('before label after')
  })

  it('shows the editable link source while the cursor is in the link', () => {
    const { content } = mountMarkdownEditor('before [label](url) after')
    content?.focus()
    for (let index = 0; index < 9; index += 1) {
      content?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      )
    }

    expect(content?.textContent).toEqual('before [label](url) after')
  })

  it('shows the editable link source while a selection intersects the link', () => {
    const { content } = mountMarkdownEditor('before [label](url) after')
    const view = content ? EditorView.findFromDOM(content) : null
    view?.dispatch({ selection: { anchor: 8, head: 13 } })

    expect(content?.textContent).toEqual('before [label](url) after')
  })

  it.each([
    {
      name: 'heading',
      markdown: '# Heading',
      cursor: 3,
      expected: '# Heading',
    },
    {
      name: 'bold',
      markdown: '**bold**',
      cursor: 3,
      expected: '**bold**',
    },
    {
      name: 'inline code',
      markdown: '`code`',
      cursor: 2,
      expected: '`code`',
    },
    {
      name: 'strikethrough',
      markdown: '~~strike~~',
      cursor: 3,
      expected: '~~strike~~',
    },
  ])(
    'shows all $name markers while the cursor is inside its span',
    ({ markdown, cursor, expected }) => {
      const { content } = mountMarkdownEditor(markdown)
      const view = content ? EditorView.findFromDOM(content) : null
      view?.dispatch({ selection: { anchor: cursor } })

      expect(content?.textContent).toEqual(expected)
    },
  )

  it.each([
    {
      name: 'heading',
      markdown: 'text\n\n## Heading',
      expected: 'text## Heading',
    },
    { name: 'inline code', markdown: 'text `code`', expected: 'text `code`' },
  ])(
    'keeps $name markers visible while the cursor is elsewhere',
    ({ markdown, expected }) => {
      const { content } = mountMarkdownEditor(markdown)

      expect(content?.textContent).toEqual(expected)
    },
  )

  it('draws heading markers in the primary color at regular weight', async () => {
    const { content } = mountMarkdownEditor('text\n\n## Heading')
    content?.style.setProperty('--primary', '#123456')
    const marker = await vi.waitUntil(() => {
      const walker = document.createTreeWalker(
        content ?? document.body,
        NodeFilter.SHOW_TEXT,
      )
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        if (node.textContent === '##') return node.parentElement
      return undefined
    })
    const readOutput = () => ({
      text: marker.textContent,
      color: getComputedStyle(marker).color,
      fontWeight: getComputedStyle(marker).fontWeight,
    })

    expect(readOutput()).toEqual({
      text: '##',
      color: 'rgb(18, 52, 86)',
      fontWeight: '400',
    })
  })

  it('shows all markers when the selection is inside formatted text', () => {
    const { content } = mountMarkdownEditor('**bold**')
    const view = content ? EditorView.findFromDOM(content) : null
    view?.dispatch({ selection: { anchor: 3, head: 5 } })

    expect(content?.textContent).toEqual('**bold**')
  })

  it('colors language-aware code tokens with shared CSS variables', async () => {
    const { content } = mountMarkdownEditor('```js\nconst value = "text"\n```')
    content?.style.setProperty('--tint-green-foreground', '#123456')
    const stringToken = await vi.waitUntil(() =>
      Array.from(content?.querySelectorAll<HTMLSpanElement>('span') ?? []).find(
        (span) => span.textContent === '"text"',
      ),
    )
    const readOutput = () => ({
      text: stringToken.textContent,
      color: getComputedStyle(stringToken).color,
    })

    expect(readOutput()).toEqual({
      text: '"text"',
      color: 'rgb(18, 52, 86)',
    })
  })

  it('keeps heading text free of the default underline', async () => {
    const { content } = mountMarkdownEditor('# Heading')
    content?.focus()
    content?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    )
    const headingText = await vi.waitUntil(() =>
      Array.from(content?.querySelectorAll<HTMLSpanElement>('span') ?? []).find(
        (span) => span.textContent.trim() === 'Heading',
      ),
    )
    const readOutput = () => ({
      text: headingText.textContent.trim(),
      textDecoration: getComputedStyle(headingText).textDecorationLine,
    })

    expect(readOutput()).toEqual({ text: 'Heading', textDecoration: 'none' })
  })
})
