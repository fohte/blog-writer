import { describe, expect, it } from 'vitest'
import { cdp } from 'vitest/browser'

import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'

type MarkdownEditorOutput = {
  body: string
  lines: (string | null)[]
  visible: string | undefined
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

function readCompositionOutput(
  duringComposition: MarkdownEditorOutput,
  committed: MarkdownEditorOutput,
): {
  duringComposition: MarkdownEditorOutput
  committed: MarkdownEditorOutput
} {
  return { duringComposition, committed }
}

function readNewlineOutput(
  duringComposition: MarkdownEditorOutput,
  committed: MarkdownEditorOutput,
  afterNewline: MarkdownEditorOutput,
): {
  duringComposition: MarkdownEditorOutput
  committed: MarkdownEditorOutput
  afterNewline: MarkdownEditorOutput
} {
  return { duringComposition, committed, afterNewline }
}

function readBackspaceOutput(
  afterBackspace: MarkdownEditorOutput,
  duringComposition: MarkdownEditorOutput,
  committed: MarkdownEditorOutput,
): {
  afterBackspace: MarkdownEditorOutput
  duringComposition: MarkdownEditorOutput
  committed: MarkdownEditorOutput
} {
  return { afterBackspace, duringComposition, committed }
}

function readCompositionBackspaceOutput(
  duringComposition: MarkdownEditorOutput,
  committed: MarkdownEditorOutput,
  afterBackspace: MarkdownEditorOutput,
): {
  duringComposition: MarkdownEditorOutput
  committed: MarkdownEditorOutput
  afterBackspace: MarkdownEditorOutput
} {
  return { duringComposition, committed, afterBackspace }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve()
    })
  })
}

async function pressKey(key: string, modifiers = 0): Promise<void> {
  await cdp().send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code: key,
    modifiers,
  })
  await cdp().send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code: key,
    modifiers,
  })
}

async function compose(
  body: ReturnType<typeof mountMarkdownEditor>['body'],
  content: ReturnType<typeof mountMarkdownEditor>['content'],
  text: string,
): Promise<{
  committed: MarkdownEditorOutput
  duringComposition: MarkdownEditorOutput
}> {
  await cdp().send('Input.imeSetComposition', {
    text,
    selectionStart: text.length,
    selectionEnd: text.length,
  })
  await nextFrame()
  const duringComposition = readOutput(body, content)

  await cdp().send('Input.insertText', { text })
  await nextFrame()

  return { committed: readOutput(body, content), duringComposition }
}

describe('MarkdownEditor IME in Chromium', () => {
  it('keeps a closed emphasis marker visible while composing after it', async () => {
    const { body, content } = mountMarkdownEditor('**word**')
    content?.focus()
    await pressKey('End')

    const { committed, duringComposition } = await compose(
      body,
      content,
      '日本語',
    )
    const actual = readCompositionOutput(duringComposition, committed)

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

    const { committed, duringComposition } = await compose(
      body,
      content,
      '日本語',
    )
    const actual = readCompositionOutput(duringComposition, committed)

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

    const { committed, duringComposition } = await compose(
      body,
      content,
      '日本語',
    )
    await pressKey('Enter')
    await nextFrame()
    const actual = readNewlineOutput(
      duringComposition,
      committed,
      readOutput(body, content),
    )

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

    const { committed, duringComposition } = await compose(
      body,
      content,
      '日本語',
    )
    const actual = readCompositionOutput(duringComposition, committed)

    expect(actual).toEqual({
      duringComposition: {
        body: '`code`日本語',
        lines: ['code`日本語'],
        visible: 'code`日本語',
      },
      committed: {
        body: '`code`日本語',
        lines: ['code日本語'],
        visible: 'code日本語',
      },
    })
  })

  it('inserts composed text at the end of a line before a code block', async () => {
    const { body, content } = mountMarkdownEditor(
      'before\n```ts\nconst value = 1\n```\nafter',
    )
    content?.focus()
    await pressKey('End')

    const { committed, duringComposition } = await compose(
      body,
      content,
      '日本語',
    )
    const actual = readCompositionOutput(duringComposition, committed)

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

    const { committed, duringComposition } = await compose(
      body,
      content,
      '日本語',
    )
    const actual = readCompositionOutput(duringComposition, committed)

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

  it('inserts composed text after backspacing a new list marker', async () => {
    const { body, content } = mountMarkdownEditor('- ')
    content?.focus()
    await pressKey('End')
    await pressKey('Backspace')
    await pressKey('Backspace')
    const afterBackspace = readOutput(body, content)

    const { committed, duringComposition } = await compose(
      body,
      content,
      '日本語',
    )
    const actual = readBackspaceOutput(
      afterBackspace,
      duringComposition,
      committed,
    )

    expect(actual).toEqual({
      afterBackspace: { body: '', lines: [''], visible: '' },
      duringComposition: {
        body: '日本語',
        lines: ['日本語'],
        visible: '日本語',
      },
      committed: {
        body: '日本語',
        lines: ['日本語'],
        visible: '日本語',
      },
    })
  })

  it('composes after a heading before backspacing', async () => {
    const { body, content } = mountMarkdownEditor('## Heading')
    content?.focus()
    await pressKey('End')

    const { committed, duringComposition } = await compose(
      body,
      content,
      '日本語',
    )
    await pressKey('Backspace')
    await nextFrame()
    const afterBackspace = readOutput(body, content)
    const actual = readCompositionBackspaceOutput(
      duringComposition,
      committed,
      afterBackspace,
    )

    expect(actual).toEqual({
      duringComposition: {
        body: '## Heading日本語',
        lines: ['Heading日本語'],
        visible: 'Heading日本語',
      },
      committed: {
        body: '## Heading日本語',
        lines: ['Heading日本語'],
        visible: 'Heading日本語',
      },
      afterBackspace: {
        body: '## Heading日本',
        lines: ['Heading日本'],
        visible: 'Heading日本',
      },
    })
  })

  it('preserves Japanese punctuation and full-width spaces in saved text', async () => {
    const { body, content } = mountMarkdownEditor('prefix')
    content?.focus()
    await pressKey('End')

    const { committed, duringComposition } = await compose(
      body,
      content,
      '、　日本語。',
    )
    const actual = readCompositionOutput(duringComposition, committed)

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
