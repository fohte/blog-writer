import { describe, expect, it } from 'vitest'

import { createMarkdownImagePreview } from '#components/markdown-image-preview'
import { createMarkdownTablePreview } from '#components/markdown-table-preview'
import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'

const previewImageUrl =
  'https://assets.example.test/images/preview.webp?w=320&h=180'
const previewImageSource = `![Preview](${previewImageUrl})`

describe('Markdown preview links and images', () => {
  it('keeps allowed table link URLs exact and renders other protocols as text', () => {
    const source = [
      '| HTTP | HTTPS | Email |',
      '| --- | --- | --- |',
      '| [site](http://example.test/guide%2Fintro?x=Ab%2Fc) | [docs](https://example.test/Guide?x=Ab%2Fc) | [mail](mailto:editor@example.test?subject=Hello%20there) |',
      '| [script](javascript:noop) | [file](ftp://example.test/file) | [relative](/guide) |',
    ].join('\n')
    const { body, content } = mountMarkdownEditor(`before\n\n${source}`)

    const readOutput = () => ({
      body: body.toJSON(),
      links: [...(content?.querySelectorAll('tbody a') ?? [])].map(
        (anchor) => ({
          href: anchor.getAttribute('href'),
          rel: anchor.getAttribute('rel'),
          target: anchor.getAttribute('target'),
          text: anchor.textContent,
        }),
      ),
      rows: [...(content?.querySelectorAll('tbody tr') ?? [])].map((row) =>
        [...row.querySelectorAll('td')].map((cell) => cell.textContent),
      ),
    })

    expect(readOutput()).toEqual({
      body: `before\n\n${source}`,
      links: [
        {
          href: 'http://example.test/guide%2Fintro?x=Ab%2Fc',
          rel: 'noreferrer noopener',
          target: '_blank',
          text: 'site',
        },
        {
          href: 'https://example.test/Guide?x=Ab%2Fc',
          rel: 'noreferrer noopener',
          target: '_blank',
          text: 'docs',
        },
        {
          href: 'mailto:editor@example.test?subject=Hello%20there',
          rel: 'noreferrer noopener',
          target: '_blank',
          text: 'mail',
        },
      ],
      rows: [
        ['site', 'docs', 'mail'],
        [
          '[script](javascript:noop)',
          '[file](ftp://example.test/file)',
          '[relative](/guide)',
        ],
      ],
    })
  })

  it('sets no-referrer on standalone and table cell images', () => {
    const standalone = createMarkdownImagePreview({
      alt: 'Preview',
      source: previewImageSource,
      src: previewImageUrl,
    })
    const table = createMarkdownTablePreview({
      header: ['Preview'],
      alignment: [null],
      rows: [[previewImageSource]],
    })
    const images = [standalone.querySelector('img'), table.querySelector('img')]

    const readOutput = () => ({
      images: images.map((image) =>
        image
          ? {
              alt: image.getAttribute('alt'),
              referrerPolicy: image.referrerPolicy,
              src: image.getAttribute('src'),
            }
          : null,
      ),
    })

    expect(readOutput()).toEqual({
      images: [
        {
          alt: 'Preview',
          referrerPolicy: 'no-referrer',
          src: previewImageUrl,
        },
        {
          alt: 'Preview',
          referrerPolicy: 'no-referrer',
          src: previewImageUrl,
        },
      ],
    })
  })

  it('shows the exact original Markdown when a table cell image fails to load', () => {
    const cellSource = `Before ${previewImageSource} after`
    const source = [
      'before',
      '',
      '| Preview |',
      '| --- |',
      `| ${cellSource} |`,
      '',
      'after',
    ].join('\n')
    const { body, content } = mountMarkdownEditor(source)
    content?.querySelector('tbody img')?.dispatchEvent(new Event('error'))

    const readOutput = () => ({
      body: body.toJSON(),
      cellText: content?.querySelector('tbody td')?.textContent ?? null,
      imageCount: content?.querySelectorAll('tbody img').length ?? 0,
    })

    expect(readOutput()).toEqual({
      body: source,
      cellText: cellSource,
      imageCount: 0,
    })
  })
})
