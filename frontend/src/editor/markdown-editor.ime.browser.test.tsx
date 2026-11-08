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
import { nextFrame } from '#test-support/browser.test-support.test'

type MarkdownEditorOutput = {
  body: string
  lines: (string | null)[]
  visible: string | undefined
}

interface ComposeOutput {
  composingImmediately: boolean
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
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- This inserts one composition string; WebKit keyboard input sends one insertText per character.
    document.execCommand('insertText', false, text)
    await Promise.resolve()
    const composingImmediately = content
      ? EditorView.findFromDOM(content)?.composing === true
      : false
    const duringComposition = readOutput(body, content)
    content?.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: text }),
    )
    await nextFrame()
    const committed = readOutput(body, content)
    return { composingImmediately, duringComposition, committed }
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
    const composingImmediately = content
      ? EditorView.findFromDOM(content)?.composing === true
      : false
    await nextFrame()
    const duringComposition = readOutput(body, content)

    await cdp().send('Input.insertText', { text })
    await nextFrame()
    const committed = readOutput(body, content)
    return { composingImmediately, duringComposition, committed }
  },
}

const isChromium = navigator.userAgent.includes('Chrome')
const imeDriver = isChromium ? chromiumDriver : webkitDriver
const { pressKey, compose } = imeDriver

type ImeScenario = {
  name: string
  initial: string
  beforeComposition: { key: string; capture?: string }[]
  beforeCompositionOutput?: Record<string, MarkdownEditorOutput>
  text: string
  duringComposition: MarkdownEditorOutput
  committed: MarkdownEditorOutput
  afterComposition?: {
    key: string
    capture: string
    output: MarkdownEditorOutput
  }
}

const imeScenarios: ImeScenario[] = [
  {
    name: 'inserts Japanese text after a closed emphasis marker',
    initial: '**word**',
    beforeComposition: [{ key: 'End' }],
    text: '日本語',
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
  },
  {
    name: 'inserts Japanese text at the document start before inline markers',
    initial: 'plain **bold**',
    beforeComposition: [{ key: 'Home' }],
    text: '日本語',
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
  },
  {
    name: 'inserts a newline after Japanese text at the start of a line',
    initial: 'plain',
    beforeComposition: [{ key: 'Home' }],
    text: '日本語',
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
    afterComposition: {
      key: 'Enter',
      capture: 'afterNewline',
      output: {
        body: `日本語
plain`,
        lines: ['日本語', 'plain'],
        visible: '日本語plain',
      },
    },
  },
  {
    name: 'inserts Japanese text after inline code',
    initial: '`code`',
    beforeComposition: [{ key: 'End' }],
    text: '日本語',
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
  },
  {
    name: 'inserts Japanese text after a Markdown link',
    initial: '[label](url)',
    beforeComposition: [{ key: 'End' }],
    text: '日本語',
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
  },
  {
    name: 'inserts Japanese text at the end of a line before a code block',
    initial: `before
\`\`\`ts
const value = 1
\`\`\`
after`,
    beforeComposition: [{ key: 'End' }],
    text: '日本語',
    duringComposition: {
      body: `before日本語
\`\`\`ts
const value = 1
\`\`\`
after`,
      lines: ['before日本語', '```ts', 'const value = 1', '```', 'after'],
      visible: 'before日本語```tsconst value = 1```after',
    },
    committed: {
      body: `before日本語
\`\`\`ts
const value = 1
\`\`\`
after`,
      lines: ['before日本語', '```ts', 'const value = 1', '```', 'after'],
      visible: 'before日本語```tsconst value = 1```after',
    },
  },
  {
    name: 'inserts Japanese text at the start of a line after a code block',
    initial: `before
\`\`\`ts
const value = 1
\`\`\`
after`,
    beforeComposition: [
      { key: 'ArrowDown' },
      { key: 'ArrowDown' },
      { key: 'ArrowDown' },
      { key: 'ArrowDown' },
    ],
    text: '日本語',
    duringComposition: {
      body: `before
\`\`\`ts
const value = 1
\`\`\`
日本語after`,
      lines: ['before', '```ts', 'const value = 1', '```', '日本語after'],
      visible: 'before```tsconst value = 1```日本語after',
    },
    committed: {
      body: `before
\`\`\`ts
const value = 1
\`\`\`
日本語after`,
      lines: ['before', '```ts', 'const value = 1', '```', '日本語after'],
      visible: 'before```tsconst value = 1```日本語after',
    },
  },
  {
    name: 'inserts Japanese text after deleting a list marker',
    initial: '- item',
    beforeComposition: [
      { key: 'End' },
      { key: 'Enter', capture: 'afterEnter' },
      { key: 'Backspace', capture: 'afterBackspace' },
    ],
    beforeCompositionOutput: {
      afterEnter: {
        body: `- item
- `,
        lines: ['- item', '- '],
        visible: '- item- ',
      },
      afterBackspace: {
        body: `- item
  `,
        lines: ['- item', '  '],
        visible: '- item  ',
      },
    },
    text: '日本語',
    duringComposition: {
      body: `- item
  日本語`,
      lines: ['- item', '  日本語'],
      visible: '- item  日本語',
    },
    committed: {
      body: `- item
  日本語`,
      lines: ['- item', '  日本語'],
      visible: '- item  日本語',
    },
  },
  {
    name: 'applies Backspace after committing Japanese text in a heading',
    initial: '## Heading',
    beforeComposition: [{ key: 'End' }],
    text: '日本語',
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
    afterComposition: {
      key: 'Backspace',
      capture: 'afterBackspace',
      output: {
        body: '## Heading日本',
        lines: ['## Heading日本'],
        visible: '## Heading日本',
      },
    },
  },
  {
    name: 'preserves Japanese punctuation and full-width spaces in inserted text',
    initial: 'prefix',
    beforeComposition: [{ key: 'End' }],
    text: '、　日本語。',
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
  },
]

const webkitCommittedTextScenarios = imeScenarios.filter(
  (scenario) => scenario.afterComposition === undefined,
)

async function runImeScenario(scenario: ImeScenario) {
  const { body, content } = mountMarkdownEditor(scenario.initial)
  content?.focus()
  const captured: Record<string, MarkdownEditorOutput> = {}
  for (const { key, capture } of scenario.beforeComposition) {
    await pressKey(key)
    if (capture !== undefined) {
      captured[capture] = readOutput(body, content)
    }
  }

  const composition = await compose(body, content, scenario.text)
  if (scenario.afterComposition) {
    await pressKey(scenario.afterComposition.key)
    await nextFrame()
    captured[scenario.afterComposition.capture] = readOutput(body, content)
  }
  return { ...captured, ...composition }
}

function expectedImeScenario(scenario: ImeScenario) {
  return {
    ...scenario.beforeCompositionOutput,
    composingImmediately: true,
    duringComposition: scenario.duringComposition,
    committed: scenario.committed,
    ...(scenario.afterComposition
      ? {
          [scenario.afterComposition.capture]: scenario.afterComposition.output,
        }
      : {}),
  }
}

describe('MarkdownEditor IME', () => {
  it.each([
    { side: 'before', target: 'before' },
    { side: 'after', target: 'after' },
  ])('preserves Japanese input $side of a block widget', async ({ target }) => {
    const image =
      "![Sample](data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1'%20height='1'%3E%3C/svg%3E)"
    const initial = `before\n${image}\nafter`
    const position =
      target === 'before' ? 'before'.length : initial.indexOf('after')
    const { body, content } = mountMarkdownEditor(initial, [], undefined, {
      initialSelection: { anchor: position },
    })
    const initialPreviewCount = content?.querySelectorAll('figure').length ?? 0
    const initialSourceLineCount = [
      ...(content?.querySelectorAll<HTMLElement>('.cm-line') ?? []),
    ].filter((line) => line.textContent === image).length
    content?.focus()
    const composition = await compose(body, content, '日本語')

    const readOutput = () => ({
      during: composition.duringComposition.body,
      committed: composition.committed.body,
      initialPreviewCount,
      initialSourceLineCount,
      finalPreviewCount: content?.querySelectorAll('figure').length ?? 0,
      finalSourceLineCount: [
        ...(content?.querySelectorAll<HTMLElement>('.cm-line') ?? []),
      ].filter((line) => line.textContent === image).length,
    })
    expect(readOutput()).toEqual({
      during:
        target === 'before'
          ? `before日本語\n${image}\nafter`
          : `before\n${image}\n日本語after`,
      committed:
        target === 'before'
          ? `before日本語\n${image}\nafter`
          : `before\n${image}\n日本語after`,
      initialPreviewCount: 1,
      initialSourceLineCount: 0,
      finalPreviewCount: 1,
      finalSourceLineCount: 0,
    })
  })

  it.each([
    { name: 'table start', boundary: 'start' },
    { name: 'table end', boundary: 'end' },
  ] as const)(
    'inserts Japanese text at the $name boundary without moving it',
    async ({ boundary }) => {
      const table = '| Feature | Value |\n| --- | --- |\n| Table | Visible |'
      const initial = `b\n${table}\n\nz`
      const position = boundary === 'start' ? 2 : 2 + table.length
      const expected =
        boundary === 'start'
          ? `b\n日本語${table}\n\nz`
          : `b\n${table}日本語\n\nz`
      const { body, content } = mountMarkdownEditor(initial, [], undefined, {
        initialSelection: { anchor: position },
      })
      content?.focus()
      const composition = await compose(body, content, '日本語')

      const readOutput = () => ({
        composingImmediately: composition.composingImmediately,
        duringComposition: composition.duringComposition.body,
        committed: composition.committed.body,
      })
      expect(readOutput()).toEqual({
        composingImmediately: true,
        duringComposition: expected,
        committed: expected,
      })
    },
  )

  it.skipIf(!isChromium)(
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

  describe.skipIf(!isChromium)('composition', () => {
    it.each(imeScenarios)('$name', async (scenario) => {
      expect(await runImeScenario(scenario)).toEqual(
        expectedImeScenario(scenario),
      )
    })
  })

  describe.skipIf(isChromium)(
    'WebKit committed text insertion without post-composition Enter or Backspace checks',
    () => {
      it.each(webkitCommittedTextScenarios)('$name', async (scenario) => {
        expect(await runImeScenario(scenario)).toEqual(
          expectedImeScenario(scenario),
        )
      })
    },
  )
})
