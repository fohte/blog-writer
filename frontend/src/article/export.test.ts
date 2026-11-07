import { compile } from '@mdx-js/mdx'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createArticleFrontmatter,
  exportArticleBody,
  getArticleExportFilename,
  prependArticleFrontmatter,
} from '#article/export'

const articleBody = [
  '# Title <T>',
  '',
  'Literal {x}, 1<2, and <https://example.test>.',
  '',
  '`Inline <T> {x}` stays unchanged.',
  '',
  '~~struck~~',
  '',
  '- [x] done',
  '',
  '| Value | Other |',
  '| --- | --- |',
  '| Array<T> | plain |',
  '',
  'Promise<string>, Map<K, V>, Array<T>, Array <T>, f(<T>), <b>, <KbdFoo>, and <br>.',
  'Text before <!-- inline --> after.',
  '<link-card href="/docs">Documentation</link-card> and <source-list>Sources</source-list>.',
  '',
  '<CardLink href="https://example.test/?a=1&b=2">link</CardLink>, <Kbd data-key="a&b">Cmd <T> {x}</Kbd>, <SpeakerDeck id="a&b" />, and <ImageGrid data-name="a&b" />.',
  '',
  '    const value = 1',
  '    return value',
  '',
  '```ts',
  'const value = { item: 1 < 2 }',
  '```',
  '',
  '<!-- note */ stays safe -->',
  '',
  '<br>',
  '<hr>',
  '<img alt="a>b" src="sample.png">',
  '',
  '<details>',
  '<summary>More information</summary>',
  'Unclosed tags remain raw JSX.',
].join('\n')

afterEach(() => {
  vi.doUnmock('remark')
})

describe('exportArticleBody', () => {
  it('returns Markdown without changing the article body', async () => {
    const result = await exportArticleBody(articleBody, 'markdown').match(
      (value) => value,
      () => undefined,
    )

    expect(result).toEqual(articleBody)
  })

  it('converts Markdown to MDX while preserving GFM and editor components', async () => {
    const result = await exportArticleBody(articleBody, 'mdx').match(
      (value) => value,
      () => undefined,
    )

    expect(result).toEqual(
      [
        '# Title \\<T>',
        '',
        'Literal \\{x}, 1\\<2, and [https://example.test](https://example.test).',
        '',
        '`Inline <T> {x}` stays unchanged.',
        '',
        '~~struck~~',
        '',
        '- [x] done',
        '',
        '| Value     | Other |',
        '| --------- | ----- |',
        '| Array\\<T> | plain |',
        '',
        'Promise\\<string>, Map\\<K, V>, Array\\<T>, Array \\<T>, f(\\<T>), \\<b>, \\<KbdFoo>, and <br />.',
        'Text before {/* inline */} after.',
        '<link-card href="/docs">Documentation</link-card> and <source-list>Sources</source-list>.',
        '',
        '<CardLink href="https://example.test/?a=1&b=2">link</CardLink>, <Kbd data-key="a&b">Cmd \\<T> \\{x}</Kbd>, <SpeakerDeck id="a&b" />, and <ImageGrid data-name="a&b" />.',
        '',
        '```',
        'const value = 1',
        'return value',
        '```',
        '',
        '```ts',
        'const value = { item: 1 < 2 }',
        '```',
        '',
        '{/* note *\\/ stays safe */}',
        '',
        '<br />',
        '<hr />',
        '<img alt="a>b" src="sample.png" />',
        '',
        '<details>',
        '<summary>More information</summary>',
        'Unclosed tags remain raw JSX.',
        '',
      ].join('\n'),
    )
  })

  it('produces MDX accepted by the MDX compiler', async () => {
    const source = [
      '# Title <T>',
      '',
      'Text {x}, 1<2, Promise<string>, Array<T>, Array <T>, f(<T>), and <b>.',
      'Text before <!-- inline --> after.',
      '<link-card href="/docs">Documentation</link-card> and <source-list>Sources</source-list>.',
      '',
      '<CardLink href="https://example.test/?a=1&b=2">link</CardLink> <Kbd data-key="a&b">Cmd <T> {x}</Kbd> <SpeakerDeck id="a&b" /> <ImageGrid data-name="a&b" />',
      '',
      '    const value = { item: 1 < 2 }',
      '    return value',
      '',
      '<details><summary>More information</summary><br></details>',
      '<img alt="a>b" src="sample.png">',
    ].join('\n')
    const result = await exportArticleBody(source, 'mdx').match(
      async (value) => ({
        state: 'success' as const,
        messages: (await compile(value)).messages,
      }),
      (error) => ({ state: 'error' as const, message: error.message }),
    )

    expect(result).toEqual({ state: 'success', messages: [] })
  })

  it('returns a wrapped error when the MDX processor fails', async () => {
    vi.doMock('remark', () => ({
      remark: () => {
        throw new Error('parser failed')
      },
    }))

    const result = await exportArticleBody('article body', 'mdx').match(
      (value) => value,
      (error) => error.message,
    )

    expect(result).toEqual('MDX 形式に変換できませんでした。')
  })
})

describe('article frontmatter', () => {
  it('quotes template values and prefixes the exported body', () => {
    const frontmatter = createArticleFrontmatter(
      'title: {{ title }}\ndate: {{ date }}',
      'A title: with punctuation',
      Date.UTC(2026, 0, 15, 23),
    )

    expect(prependArticleFrontmatter(frontmatter, 'Article body')).toEqual(
      '---\ntitle: "A title: with punctuation"\ndate: "2026-01-15"\n---\n\nArticle body',
    )
  })
})

describe('getArticleExportFilename', () => {
  it.each([
    {
      title: 'Sample article',
      articleId: 'sample-id',
      format: 'markdown',
      expected: 'Sample article.md',
    },
    {
      title: 'A / sample: title?',
      articleId: 'sample-id',
      format: 'mdx',
      expected: 'A _ sample_ title_.mdx',
    },
    {
      title: '',
      articleId: 'sample-id',
      format: 'markdown',
      expected: 'sample-id.md',
    },
    {
      title: 'Untitled article',
      articleId: 'sample-id',
      format: 'mdx',
      expected: 'sample-id.mdx',
    },
  ] as const)(
    'uses a safe filename for $title',
    ({ title, articleId, format, expected }) => {
      expect(getArticleExportFilename(title, articleId, format)).toEqual(
        expected,
      )
    },
  )
})
