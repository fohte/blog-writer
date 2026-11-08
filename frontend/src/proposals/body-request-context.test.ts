import { describe, expect, it } from 'vitest'

import {
  getBodyRequestContext,
  sectionHeadingText,
} from '#proposals/body-request-context'

describe('sectionHeadingText', () => {
  it.each([
    {
      name: 'the heading that starts the section',
      section: '## First\n⟪依頼範囲の開始⟫body⟪依頼範囲の終了⟫',
      expected: 'First',
    },
    {
      name: 'a heading that is itself the request target',
      section: '⟪依頼範囲の開始⟫## First⟪依頼範囲の終了⟫\nbody',
      expected: 'First',
    },
    {
      name: 'nothing for text before the first heading',
      section: '⟪依頼範囲の開始⟫body⟪依頼範囲の終了⟫\n\nmore',
      expected: '',
    },
    {
      name: 'nothing for a heading without text',
      section: '##\n⟪依頼範囲の開始⟫body⟪依頼範囲の終了⟫',
      expected: '',
    },
  ])('returns $name', ({ section, expected }) => {
    expect(sectionHeadingText(section)).toBe(expected)
  })
})

describe('getBodyRequestContext', () => {
  it('uses the paragraph at the cursor and includes its containing section', () => {
    const text =
      '# Article\n\n## First\nfirst paragraph\ncontinued line\n\n## Second\nother text'
    const cursor = text.indexOf('continued') + 2

    expect(getBodyRequestContext(text, { from: cursor, to: cursor })).toEqual({
      headings: ['# Article', '## First', '## Second'],
      section:
        '## First\n⟪依頼範囲の開始⟫first paragraph\ncontinued line⟪依頼範囲の終了⟫',
      target: 'first paragraph\ncontinued line',
      range: {
        from: text.indexOf('first paragraph'),
        to: text.indexOf('\n\n## Second'),
      },
    })
  })

  it('keeps a previous paragraph outside the cursor paragraph range', () => {
    const text = 'first paragraph\n\nsecond paragraph'
    const cursor = text.indexOf('second') + 2

    expect(getBodyRequestContext(text, { from: cursor, to: cursor })).toEqual({
      headings: [],
      section:
        'first paragraph\n\n⟪依頼範囲の開始⟫second paragraph⟪依頼範囲の終了⟫',
      target: 'second paragraph',
      range: {
        from: text.indexOf('second paragraph'),
        to: text.length,
      },
    })
  })

  it('keeps the exact selection as the replacement range', () => {
    const text = '# Article\n\n## First\nrewrite this sentence'
    const from = text.indexOf('this')

    expect(getBodyRequestContext(text, { from, to: from + 4 })).toEqual({
      headings: ['# Article', '## First'],
      section:
        '## First\nrewrite ⟪依頼範囲の開始⟫this⟪依頼範囲の終了⟫ sentence',
      target: 'this',
      range: { from, to: from + 4 },
    })
  })

  it('uses an empty range on a blank line', () => {
    const text = '# Article\n\n## First\n\nfollowing paragraph'
    const position = text.indexOf('\n\nfollowing') + 1

    expect(
      getBodyRequestContext(text, { from: position, to: position }),
    ).toEqual({
      headings: ['# Article', '## First'],
      section:
        '## First\n\n⟪依頼範囲の開始⟫⟪依頼範囲の終了⟫\n\nfollowing paragraph',
      target: '',
      range: { from: position, to: position },
    })
  })

  it('separates a blank-line insertion from both surrounding paragraphs', () => {
    const text = 'first paragraph\n\nsecond paragraph'
    const position = text.indexOf('\n\n') + 1

    expect(
      getBodyRequestContext(text, { from: position, to: position }),
    ).toEqual({
      headings: [],
      section:
        'first paragraph\n\n⟪依頼範囲の開始⟫⟪依頼範囲の終了⟫\n\nsecond paragraph',
      target: '',
      range: { from: position, to: position },
    })
  })

  it('uses a leading blank line as an insertion target before a fence', () => {
    const text = '\n```md\nconst value = 1\n```'

    expect(getBodyRequestContext(text, { from: 0, to: 0 })).toEqual({
      headings: [],
      section:
        '⟪依頼範囲の開始⟫⟪依頼範囲の終了⟫\n\n```md\nconst value = 1\n```',
      target: '',
      range: { from: 0, to: 0 },
    })
  })

  it('uses only the heading line when the cursor is on a heading', () => {
    const text = '# Main\n\n## Child\nparagraph'
    const headingStart = text.indexOf('## Child')
    const cursor = headingStart + 4

    expect(getBodyRequestContext(text, { from: cursor, to: cursor })).toEqual({
      headings: ['# Main', '## Child'],
      section: '⟪依頼範囲の開始⟫## Child⟪依頼範囲の終了⟫\nparagraph',
      target: '## Child',
      range: { from: headingStart, to: headingStart + '## Child'.length },
    })
  })

  it('uses the whole fenced code block when the cursor is inside it', () => {
    const codeBlock = '```md\n## code heading\n\ncode paragraph\n```'
    const text = `# Main\n\nBefore.\n\n${codeBlock}\n\nAfter.`
    const codeStart = text.indexOf(codeBlock)
    const cursor = text.indexOf('code heading') + 2

    expect(getBodyRequestContext(text, { from: cursor, to: cursor })).toEqual({
      headings: ['# Main'],
      section: `# Main\n\nBefore.\n\n⟪依頼範囲の開始⟫${codeBlock}⟪依頼範囲の終了⟫\n\nAfter.`,
      target: codeBlock,
      range: { from: codeStart, to: codeStart + codeBlock.length },
    })
  })

  it('keeps a paragraph before a fenced code block as a separate range', () => {
    const codeBlock = '```ts\nconst first = 1\n\nconst second = 2\n```'
    const paragraph = 'paragraph before the fence'
    const text = `# Main\n\n${paragraph}\n${codeBlock}\n\nAfter.`
    const from = text.indexOf(paragraph)
    const to = from + paragraph.length

    expect(
      getBodyRequestContext(text, { from: from + 2, to: from + 2 }),
    ).toEqual({
      headings: ['# Main'],
      section: `# Main\n\n⟪依頼範囲の開始⟫${paragraph}⟪依頼範囲の終了⟫\n${codeBlock}\n\nAfter.`,
      target: paragraph,
      range: { from, to },
    })
  })

  it('keeps a paragraph after a fenced code block as a separate range', () => {
    const codeBlock = '```ts\nconst first = 1\n\nconst second = 2\n```'
    const paragraph = 'paragraph after the fence\ncontinued line'
    const text = `# Main\n\n${codeBlock}\n${paragraph}\n\nAfter.`
    const from = text.indexOf(paragraph)
    const to = from + paragraph.length

    expect(
      getBodyRequestContext(text, {
        from: from + 'paragraph after'.length,
        to: from + 'paragraph after'.length,
      }),
    ).toEqual({
      headings: ['# Main'],
      section: `# Main\n\n${codeBlock}\n⟪依頼範囲の開始⟫${paragraph}⟪依頼範囲の終了⟫\n\nAfter.`,
      target: paragraph,
      range: { from, to },
    })
  })

  it('uses a nested fenced code block range across its blank line', () => {
    const codeBlock = '```ts\n  const first = 1\n\n  const second = 2\n  ```'
    const text = `# Main\n\n- item\n  ${codeBlock}\n\nAfter.`
    const from = text.indexOf(codeBlock)
    const to = from + codeBlock.length
    const position = text.indexOf('\n\n', from) + 1

    expect(
      getBodyRequestContext(text, { from: position, to: position }),
    ).toEqual({
      headings: ['# Main'],
      section: `# Main\n\n- item\n  ⟪依頼範囲の開始⟫${codeBlock}⟪依頼範囲の終了⟫\n\nAfter.`,
      target: codeBlock,
      range: { from, to },
    })
  })

  it('uses a list-nested fence when the cursor is in its indentation prefix', () => {
    const codeBlock = '```ts\n  const first = 1\n\n  const second = 2\n  ```'
    const text = `# Main\n\n- item\n  ${codeBlock}\n\nAfter.`
    const from = text.indexOf(codeBlock)
    const to = from + codeBlock.length
    const position = text.indexOf('\n  ```ts') + 1

    expect(
      getBodyRequestContext(text, { from: position, to: position }),
    ).toEqual({
      headings: ['# Main'],
      section: `# Main\n\n- item\n  ⟪依頼範囲の開始⟫${codeBlock}⟪依頼範囲の終了⟫\n\nAfter.`,
      target: codeBlock,
      range: { from, to },
    })
  })

  it('uses a blockquote fence when the cursor is on its quote prefix', () => {
    const codeBlock = '```ts\n> const first = 1\n>\n> const second = 2\n> ```'
    const text = `# Main\n\n> ${codeBlock}\n\nAfter.`
    const from = text.indexOf(codeBlock)
    const to = from + codeBlock.length
    const position = text.indexOf('> ```ts')

    expect(
      getBodyRequestContext(text, { from: position, to: position }),
    ).toEqual({
      headings: ['# Main'],
      section: `# Main\n\n> ⟪依頼範囲の開始⟫${codeBlock}⟪依頼範囲の終了⟫\n\nAfter.`,
      target: codeBlock,
      range: { from, to },
    })
  })

  it('ends an H1 introduction at the next heading of any level', () => {
    const text =
      '# Main\nintroduction paragraph\n\n## Section\nsection paragraph\n\n# Later\nlater paragraph'
    const from = text.indexOf('introduction paragraph')

    expect(
      getBodyRequestContext(text, {
        from,
        to: from + 'introduction paragraph'.length,
      }),
    ).toEqual({
      headings: ['# Main', '## Section', '# Later'],
      section: '# Main\n⟪依頼範囲の開始⟫introduction paragraph⟪依頼範囲の終了⟫',
      target: 'introduction paragraph',
      range: { from, to: from + 'introduction paragraph'.length },
    })
  })

  it('preserves the complete section when the article has no headings', () => {
    const text = '\n\nFirst paragraph\n\nSecond paragraph'
    const from = text.indexOf('Second')

    expect(getBodyRequestContext(text, { from, to: from + 6 })).toEqual({
      headings: [],
      section:
        '\n\nFirst paragraph\n\n⟪依頼範囲の開始⟫Second⟪依頼範囲の終了⟫ paragraph',
      target: 'Second',
      range: { from, to: from + 6 },
    })
  })
})
