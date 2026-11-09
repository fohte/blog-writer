import { EditorView } from '@codemirror/view'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'

const cardSource = '<CardLink href="https://docs.example.test/guide" />'
const metadata = {
  available: true,
  description: 'A useful description.',
  final_url: 'https://docs.example.test/guide',
  image:
    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="160" height="100"%3E%3Crect width="160" height="100" fill="%23dbeafe"/%3E%3C/svg%3E',
  title: 'A useful guide',
}

function editorLines(content: HTMLElement | null): string[] {
  return [...(content?.querySelectorAll<HTMLElement>('.cm-line') ?? [])].map(
    (line) => line.textContent,
  )
}

describe('Markdown MDX component previews', () => {
  it('uses the OGP fetcher and displays metadata as text', async () => {
    const fetchOgp = vi.fn(() => okAsync(metadata))
    const source = `before\n${cardSource}`
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      fetchOgp,
    })
    const card = await vi.waitUntil(() => {
      const preview = content?.querySelector<HTMLAnchorElement>('a')
      if (
        preview !== null &&
        preview !== undefined &&
        preview.textContent.includes(metadata.title)
      )
        return preview
      return undefined
    })

    const readOutput = () => ({
      body: body.toJSON(),
      card: {
        description: card.querySelector('p:last-child')?.textContent,
        domain: card.querySelector('p:nth-child(2)')?.textContent,
        href: card.getAttribute('href'),
        image: card.querySelector('img')?.getAttribute('referrerpolicy'),
        title: card.querySelector('p:first-child')?.textContent,
      },
      fetchCalls: fetchOgp.mock.calls,
    })
    expect(readOutput()).toEqual({
      body: source,
      card: {
        description: metadata.description,
        domain: 'docs.example.test',
        href: 'https://docs.example.test/guide',
        image: 'no-referrer',
        title: metadata.title,
      },
      fetchCalls: [['https://docs.example.test/guide']],
    })
  })

  it.each([
    {
      name: 'a rejected OGP request',
      fetchOgp: () => errAsync(new Error('offline')),
    },
    { name: 'no OGP fetcher', fetchOgp: undefined },
  ])('shows the URL and domain for $name', async ({ fetchOgp }) => {
    const source = `before\n${cardSource}`
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      ...(fetchOgp ? { fetchOgp } : {}),
    })
    const card = await vi.waitUntil(
      () => content?.querySelector('a') ?? undefined,
    )

    const readOutput = () => ({
      body: body.toJSON(),
      cardText: card.textContent,
      link: card.getAttribute('href'),
    })
    expect(readOutput()).toEqual({
      body: source,
      cardText: 'https://docs.example.test/guidedocs.example.test',
      link: 'https://docs.example.test/guide',
    })
  })

  it('returns a block component to its source when the cursor enters it', () => {
    const source = `before\n${cardSource}\nafter`
    const { body, content } = mountMarkdownEditor(source)
    const view = content ? EditorView.findFromDOM(content) : null
    view?.dispatch({ selection: { anchor: source.indexOf(cardSource) + 4 } })

    const editingLines = editorLines(content)
    view?.dispatch({ selection: { anchor: source.indexOf('after') } })

    const readOutput = () => ({
      body: body.toJSON(),
      editingLines,
      previewCount: content?.querySelectorAll('.cm-markdown-block-widget')
        .length,
    })
    expect(readOutput()).toEqual({
      body: source,
      editingLines: ['before', cardSource, 'after'],
      previewCount: 1,
    })
  })

  it.each([
    {
      name: 'an alphanumeric id',
      source: 'before\n<SpeakerDeck id="deck123" />',
      expectedSrc: 'https://speakerdeck.com/player/deck123',
      expectedLine: undefined,
    },
    {
      name: 'an id containing punctuation',
      source: 'before\n<SpeakerDeck id="deck-123" />',
      expectedSrc: undefined,
      expectedLine: '<SpeakerDeck id="deck-123" />',
    },
  ])(
    'renders SpeakerDeck only with $name',
    ({ source, expectedSrc, expectedLine }) => {
      const { body, content } = mountMarkdownEditor(source)

      const readOutput = () => ({
        body: body.toJSON(),
        iframeSrc: content?.querySelector('iframe')?.getAttribute('src'),
        lines: editorLines(content),
      })
      expect(readOutput()).toEqual({
        body: source,
        iframeSrc: expectedSrc,
        lines:
          expectedLine === undefined ? ['before'] : ['before', expectedLine],
      })
    },
  )

  it('renders images inside ImageGrid and shows its full source while editing', () => {
    const first = '![First](https://assets.example.test/first.png?w=100&h=80)'
    const second =
      '![Second](https://assets.example.test/second.png?w=120&h=80)'
    const source = `Before\n<ImageGrid>\n  ${first}\n${second}\n</ImageGrid>`
    const { body, content } = mountMarkdownEditor(source)
    const view = content ? EditorView.findFromDOM(content) : null
    const imageSources = [
      ...(content?.querySelectorAll<HTMLImageElement>('img') ?? []),
    ].map((image) => image.getAttribute('src'))
    const imageReferrerPolicies = [
      ...(content?.querySelectorAll<HTMLImageElement>('img') ?? []),
    ].map((image) => image.getAttribute('referrerpolicy'))
    view?.dispatch({ selection: { anchor: source.indexOf('<ImageGrid>') + 1 } })

    const readOutput = () => ({
      body: body.toJSON(),
      editingLines: editorLines(content),
      imageReferrerPolicies,
      imageSources,
    })
    expect(readOutput()).toEqual({
      body: source,
      editingLines: [
        'Before',
        '<ImageGrid>',
        `  ${first}`,
        second,
        '</ImageGrid>',
      ],
      imageReferrerPolicies: ['no-referrer', 'no-referrer'],
      imageSources: [
        'https://assets.example.test/first.png?w=100&h=80',
        'https://assets.example.test/second.png?w=120&h=80',
      ],
    })
  })

  it('leaves lowercase HTML and unknown component tags as editable text', () => {
    const source = '<UnknownWidget />\n<div>plain text</div>'
    const { body, content } = mountMarkdownEditor(source)

    const readOutput = () => ({
      body: body.toJSON(),
      lines: editorLines(content),
      widgets: content?.querySelectorAll('.cm-markdown-block-widget').length,
    })
    expect(readOutput()).toEqual({
      body: source,
      lines: ['<UnknownWidget />', '<div>plain text</div>'],
      widgets: 0,
    })
  })

  it('renders Kbd inline and returns its original tags on click', () => {
    const source = 'Use <Kbd>Ctrl</Kbd> + <Kbd>K</Kbd>'
    const { body, content } = mountMarkdownEditor(source)
    const key = content?.querySelector<HTMLElement>('kbd')
    key?.click()

    const readOutput = () => ({
      body: body.toJSON(),
      keyText: key?.textContent,
      keys: content?.querySelectorAll('kbd').length,
      sourceVisible: content?.textContent,
    })
    expect(readOutput()).toEqual({
      body: source,
      keyText: 'Ctrl',
      keys: 1,
      sourceVisible: 'Use <Kbd>Ctrl</Kbd> + K',
    })
  })

  it('does not rebuild component decorations during Japanese composition', async () => {
    const fetchOgp = vi.fn(() => okAsync(metadata))
    const source = `before\n\n${cardSource}\n\nafter`
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      fetchOgp,
    })
    const view = content ? EditorView.findFromDOM(content) : null
    await vi.waitUntil(() =>
      fetchOgp.mock.calls.length === 1 ? true : undefined,
    )
    const previewBefore = content?.querySelector('.cm-markdown-block-widget')
    content?.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    )
    view?.dispatch({ changes: { from: 0, insert: 'にほんご' } })
    const callsDuringComposition = fetchOgp.mock.calls.length
    const previewDuringComposition = content?.querySelector(
      '.cm-markdown-block-widget',
    )
    content?.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    )

    const readOutput = () => ({
      body: body.toJSON(),
      callsDuringComposition,
      previewRetained: previewDuringComposition === previewBefore,
      title: content?.querySelector('a p')?.textContent,
    })
    expect(readOutput()).toEqual({
      body: `にほんご${source}`,
      callsDuringComposition: 1,
      previewRetained: true,
      title: metadata.title,
    })
  })
})
