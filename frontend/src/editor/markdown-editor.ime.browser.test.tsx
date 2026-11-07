import { EditorView } from '@codemirror/view'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { cdp, userEvent } from 'vitest/browser'
import * as Y from 'yjs'

import { getBody, setBody } from '#article/index'
import { MarkdownEditor } from '#components/markdown-editor'
import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'
import { createMoveHistory, createOutlineEditorExtension } from '#outline/index'

type MarkdownEditorOutput = {
  body: string
  lines: (string | null)[]
  visible: string | undefined
}

interface ComposeOutput {
  duringComposition: MarkdownEditorOutput
  committed: MarkdownEditorOutput
}

interface ImeDriver {
  pressKey: (key: string) => Promise<void>
  compose: (
    body: ReturnType<typeof mountMarkdownEditor>['body'],
    content: ReturnType<typeof mountMarkdownEditor>['content'],
    text: string,
  ) => Promise<ComposeOutput>
}

function readOutput(
  body: ReturnType<typeof mountMarkdownEditor>['body'],
  content: ReturnType<typeof mountMarkdownEditor>['content'],
): MarkdownEditorOutput {
  return {
    body: body.toJSON(),
    lines: [...(content?.querySelectorAll<HTMLElement>('.cm-line') ?? [])].map(
      (line) => line.textContent,
    ),
    visible: content?.textContent,
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve()
    })
  })
}

const webkitDriver: ImeDriver = {
  pressKey: async (key) => {
    await userEvent.keyboard(`{${key}}`)
  },
  compose: async (body, content, text) => {
    content?.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true, data: '' }),
    )
    content?.dispatchEvent(
      new CompositionEvent('compositionupdate', {
        bubbles: true,
        data: text,
      }),
    )
    content?.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: text,
        inputType: 'insertCompositionText',
      }),
    )
    for (const char of text) {
      await userEvent.keyboard(char)
      // WebKit's Page.insertText appears to ignore the DOM caret while layout is dirty.
      content?.getBoundingClientRect()
    }
    await nextFrame()
    const duringComposition = readOutput(body, content)

    content?.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: text }),
    )
    await nextFrame()
    const committed = readOutput(body, content)
    return { duringComposition, committed }
  },
}

const chromiumDriver: ImeDriver = {
  pressKey: async (key) => {
    await cdp().send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: key,
    })
    await cdp().send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code: key,
    })
  },
  compose: async (body, content, text) => {
    await cdp().send('Input.imeSetComposition', {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    })
    await nextFrame()
    const duringComposition = readOutput(body, content)

    await cdp().send('Input.insertText', { text })
    await nextFrame()
    const committed = readOutput(body, content)
    return { duringComposition, committed }
  },
}

const imeDriver = navigator.userAgent.includes('Chrome')
  ? chromiumDriver
  : webkitDriver
const { pressKey, compose } = imeDriver

describe('MarkdownEditor IME', () => {
  it.skipIf(!navigator.userAgent.includes('Chrome'))(
    'keeps move handles stable and ignores block movement during composition',
    async () => {
      const initial = 'first\n\ntwo\n'
      const doc = new Y.Doc()
      setBody(doc, initial)
      const body = getBody(doc)
      const history = createMoveHistory(doc)
      const host = document.createElement('div')
      document.body.append(host)
      const root = createRoot(host)
      const viewRef: { current: EditorView | null } = { current: null }
      act(() => {
        root.render(
          createElement(MarkdownEditor, {
            extensions: [createOutlineEditorExtension(history)],
            history,
            onViewChange: (view: EditorView | null) => {
              viewRef.current = view
            },
            text: body,
          }),
        )
      })
      const content = host.querySelector<HTMLElement>('.cm-content')
      const view = viewRef.current
      const initialHandle = host.querySelector('.cm-block-drag-handle')
      if (!content || !view || !initialHandle)
        throw new Error('The MarkdownEditor move handles did not mount')

      try {
        content.focus()
        content.dispatchEvent(
          new CompositionEvent('compositionstart', {
            bubbles: true,
            data: '',
          }),
        )
        await cdp().send('Input.imeSetComposition', {
          text: '日本語',
          selectionStart: 3,
          selectionEnd: 3,
        })
        await nextFrame()
        const duringComposition = body.toJSON()
        const handleCountDuringComposition = host.querySelectorAll(
          '.cm-block-drag-handle',
        ).length
        await cdp().send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'ArrowDown',
          code: 'ArrowDown',
          modifiers: 1,
          windowsVirtualKeyCode: 40,
        })
        await cdp().send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'ArrowDown',
          code: 'ArrowDown',
          modifiers: 1,
          windowsVirtualKeyCode: 40,
        })
        const afterShortcut = body.toJSON()
        await cdp().send('Input.insertText', { text: '日本語' })
        content.dispatchEvent(
          new CompositionEvent('compositionend', {
            bubbles: true,
            data: '日本語',
          }),
        )
        await nextFrame()
        const afterComposition = body.toJSON()

        const readOutput = () => ({
          duringComposition,
          handleCountDuringComposition,
          afterShortcut,
          afterComposition,
          editor: view.state.doc.toString(),
        })
        expect(readOutput()).toEqual({
          duringComposition: '日本語first\n\ntwo\n',
          handleCountDuringComposition: 2,
          afterShortcut: '日本語first\n\ntwo\n',
          afterComposition: '日本語first\n\ntwo\n',
          editor: '日本語first\n\ntwo\n',
        })
      } finally {
        act(() => {
          root.unmount()
        })
        history.destroy()
        doc.destroy()
        host.remove()
      }
    },
  )

  it('keeps a closed emphasis marker visible while composing after it', async () => {
    const { body, content } = mountMarkdownEditor('**word**')
    content?.focus()
    await pressKey('End')

    const actual = await compose(body, content, '日本語')
    expect(actual).toEqual({
      duringComposition: {
        body: '**word**日本語',
        lines: ['word**日本語'],
        visible: 'word**日本語',
      },
      committed: {
        body: '**word**日本語',
        lines: ['word日本語'],
        visible: 'word日本語',
      },
    })
  })

  it('maps later Markdown markers while composing at the start of the document', async () => {
    const { body, content } = mountMarkdownEditor('plain **bold**')
    content?.focus()
    await pressKey('Home')

    const actual = await compose(body, content, '日本語')
    expect(actual).toEqual({
      duringComposition: {
        body: '日本語plain **bold**',
        lines: ['日本語plain bold'],
        visible: '日本語plain bold',
      },
      committed: {
        body: '日本語plain **bold**',
        lines: ['日本語plain bold'],
        visible: '日本語plain bold',
      },
    })
  })

  it('inserts a newline immediately after committing at the start of a line', async () => {
    const { body, content } = mountMarkdownEditor('plain')
    content?.focus()
    await pressKey('Home')

    const composition = await compose(body, content, '日本語')
    await pressKey('Enter')
    await nextFrame()
    const actual = Object.assign({}, composition, {
      afterNewline: readOutput(body, content),
    })
    expect(actual).toEqual({
      duringComposition: {
        body: '日本語plain',
        lines: ['日本語plain'],
        visible: '日本語plain',
      },
      committed: {
        body: '日本語plain',
        lines: ['日本語plain'],
        visible: '日本語plain',
      },
      afterNewline: {
        body: '日本語\nplain',
        lines: ['日本語', 'plain'],
        visible: '日本語plain',
      },
    })
  })

  it('inserts composed text immediately after inline code', async () => {
    const { body, content } = mountMarkdownEditor('`code`')
    content?.focus()
    await pressKey('End')

    const actual = await compose(body, content, '日本語')
    expect(actual).toEqual({
      duringComposition: {
        body: '`code`日本語',
        lines: ['`code`日本語'],
        visible: '`code`日本語',
      },
      committed: {
        body: '`code`日本語',
        lines: ['`code`日本語'],
        visible: '`code`日本語',
      },
    })
  })

  it('inserts composed text immediately after a Markdown link', async () => {
    const { body, content } = mountMarkdownEditor('[label](url)')
    content?.focus()
    await pressKey('End')

    const actual = await compose(body, content, '日本語')
    expect(actual).toEqual({
      duringComposition: {
        body: '[label](url)日本語',
        lines: ['label日本語'],
        visible: 'label日本語',
      },
      committed: {
        body: '[label](url)日本語',
        lines: ['label日本語'],
        visible: 'label日本語',
      },
    })
  })

  it('inserts composed text at the end of a line before a code block', async () => {
    const { body, content } = mountMarkdownEditor(
      'before\n```ts\nconst value = 1\n```\nafter',
    )
    content?.focus()
    await pressKey('End')

    const actual = await compose(body, content, '日本語')
    expect(actual).toEqual({
      duringComposition: {
        body: 'before日本語\n```ts\nconst value = 1\n```\nafter',
        lines: ['before日本語', '```ts', 'const value = 1', '```', 'after'],
        visible: 'before日本語```tsconst value = 1```after',
      },
      committed: {
        body: 'before日本語\n```ts\nconst value = 1\n```\nafter',
        lines: ['before日本語', '```ts', 'const value = 1', '```', 'after'],
        visible: 'before日本語```tsconst value = 1```after',
      },
    })
  })

  it('inserts composed text at the start of a line after a code block', async () => {
    const { body, content } = mountMarkdownEditor(
      'before\n```ts\nconst value = 1\n```\nafter',
    )
    content?.focus()
    for (let line = 0; line < 4; line += 1) await pressKey('ArrowDown')

    const actual = await compose(body, content, '日本語')
    expect(actual).toEqual({
      duringComposition: {
        body: 'before\n```ts\nconst value = 1\n```\n日本語after',
        lines: ['before', '```ts', 'const value = 1', '```', '日本語after'],
        visible: 'before```tsconst value = 1```日本語after',
      },
      committed: {
        body: 'before\n```ts\nconst value = 1\n```\n日本語after',
        lines: ['before', '```ts', 'const value = 1', '```', '日本語after'],
        visible: 'before```tsconst value = 1```日本語after',
      },
    })
  })

  it('continues a list, deletes its marker, and composes text', async () => {
    const { body, content } = mountMarkdownEditor('- item')
    content?.focus()
    await pressKey('End')
    await pressKey('Enter')
    const afterEnter = readOutput(body, content)
    await pressKey('Backspace')
    const afterBackspace = readOutput(body, content)

    const composition = await compose(body, content, '日本語')
    const actual = Object.assign({}, composition, {
      afterEnter,
      afterBackspace,
    })
    expect(actual).toEqual({
      afterEnter: {
        body: '- item\n- ',
        lines: ['- item', '- '],
        visible: '- item- ',
      },
      afterBackspace: {
        body: '- item\n  ',
        lines: ['- item', '  '],
        visible: '- item  ',
      },
      duringComposition: {
        body: '- item\n  日本語',
        lines: ['- item', '  日本語'],
        visible: '- item  日本語',
      },
      committed: {
        body: '- item\n  日本語',
        lines: ['- item', '  日本語'],
        visible: '- item  日本語',
      },
    })
  })

  it('composes after a heading before backspacing', async () => {
    const { body, content } = mountMarkdownEditor('## Heading')
    content?.focus()
    await pressKey('End')

    const composition = await compose(body, content, '日本語')
    await pressKey('Backspace')
    await nextFrame()
    const actual = Object.assign({}, composition, {
      afterBackspace: readOutput(body, content),
    })
    expect(actual).toEqual({
      duringComposition: {
        body: '## Heading日本語',
        lines: ['## Heading日本語'],
        visible: '## Heading日本語',
      },
      committed: {
        body: '## Heading日本語',
        lines: ['## Heading日本語'],
        visible: '## Heading日本語',
      },
      afterBackspace: {
        body: '## Heading日本',
        lines: ['## Heading日本'],
        visible: '## Heading日本',
      },
    })
  })

  it('preserves Japanese punctuation and full-width spaces in saved text', async () => {
    const { body, content } = mountMarkdownEditor('prefix')
    content?.focus()
    await pressKey('End')

    const actual = await compose(body, content, '、　日本語。')
    expect(actual).toEqual({
      duringComposition: {
        body: 'prefix、　日本語。',
        lines: ['prefix、　日本語。'],
        visible: 'prefix、　日本語。',
      },
      committed: {
        body: 'prefix、　日本語。',
        lines: ['prefix、　日本語。'],
        visible: 'prefix、　日本語。',
      },
    })
  })
})
