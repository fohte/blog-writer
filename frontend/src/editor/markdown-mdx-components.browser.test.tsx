import { EditorView } from '@codemirror/view'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'
import { DomWidget } from '#editor/dom-widget'

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
        imageDraggable: card.querySelector('img')?.getAttribute('draggable'),
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
        imageDraggable: 'false',
        title: metadata.title,
      },
      fetchCalls: [['https://docs.example.test/guide']],
    })
  })

  it('previews a CardLink with an additional title attribute', async () => {
    const source =
      'before\n<CardLink title="Guide" href="https://docs.example.test/guide" />'
    const fetchOgp = vi.fn(() => okAsync(metadata))
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      fetchOgp,
    })
    const card = await vi.waitUntil(() => {
      const preview = content?.querySelector<HTMLAnchorElement>(
        '.cm-markdown-block-widget a',
      )
      return preview?.querySelector('p')?.textContent === metadata.title
        ? preview
        : undefined
    })

    const readOutput = () => ({
      body: body.toJSON(),
      href: card.getAttribute('href'),
      title: card.querySelector('p')?.textContent,
      fetchCalls: fetchOgp.mock.calls,
    })
    expect(readOutput()).toEqual({
      body: source,
      href: 'https://docs.example.test/guide',
      title: metadata.title,
      fetchCalls: [['https://docs.example.test/guide']],
    })
  })

  it('reuses an OGP request when an edit before the card rebuilds its widget', async () => {
    const fetchOgp = vi.fn(() => okAsync(metadata))
    const source = `before\n${cardSource}`
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      fetchOgp,
    })
    const view = content ? EditorView.findFromDOM(content) : null
    await vi.waitUntil(() =>
      fetchOgp.mock.calls.length === 1 ? true : undefined,
    )
    view?.dispatch({ changes: { from: 0, insert: 'updated ' } })
    await vi.waitUntil(() => {
      const title = content?.querySelector('a p')?.textContent
      return title === metadata.title ? title : undefined
    })

    const readOutput = () => ({
      body: body.toJSON(),
      calls: fetchOgp.mock.calls,
      title: content?.querySelector('a p')?.textContent,
    })
    expect(readOutput()).toEqual({
      body: `updated ${source}`,
      calls: [['https://docs.example.test/guide']],
      title: metadata.title,
    })
  })

  it('keeps metadata separate for cards with different URLs', async () => {
    const firstUrl = 'https://docs.example.test/first'
    const secondUrl = 'https://docs.example.test/second'
    const secondMetadata = {
      ...metadata,
      description: 'A different description.',
      final_url: secondUrl,
      image: null,
      title: 'Another guide',
    }
    const fetchOgp = vi.fn((url: string) =>
      okAsync(url === firstUrl ? metadata : secondMetadata),
    )
    const source = [
      'before',
      `<CardLink href="${firstUrl}" />`,
      `<CardLink href="${secondUrl}" />`,
    ].join('\n')
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      fetchOgp,
    })
    await vi.waitUntil(() => {
      const cards = [
        ...(content?.querySelectorAll<HTMLAnchorElement>(
          '.cm-markdown-block-widget a',
        ) ?? []),
      ]
      return cards.length === 2 &&
        cards[0]?.querySelector('p:first-child')?.textContent ===
          metadata.title &&
        cards[1]?.querySelector('p:first-child')?.textContent ===
          secondMetadata.title
        ? true
        : undefined
    })

    const readOutput = () => ({
      body: body.toJSON(),
      cards: [
        ...(content?.querySelectorAll<HTMLAnchorElement>(
          '.cm-markdown-block-widget a',
        ) ?? []),
      ].map((card) => ({
        href: card.getAttribute('href'),
        title: card.querySelector('p:first-child')?.textContent,
      })),
      fetchCalls: fetchOgp.mock.calls,
    })
    expect(readOutput()).toEqual({
      body: source,
      cards: [
        { href: firstUrl, title: metadata.title },
        { href: secondUrl, title: secondMetadata.title },
      ],
      fetchCalls: [[firstUrl], [secondUrl]],
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
    { name: 'Command', modifier: { metaKey: true } },
    { name: 'Control', modifier: { ctrlKey: true } },
  ])(
    'opens a CardLink with $name-click without entering source',
    ({ modifier }) => {
      const source = `before\n${cardSource}`
      const { body, content } = mountMarkdownEditor(source)
      const link = content?.querySelector<HTMLAnchorElement>(
        '[data-mdx-card-link]',
      )
      if (!link) throw new Error('The CardLink preview did not mount')
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        ...modifier,
      })
      const dispatchResult = link.dispatchEvent(event)

      const readOutput = () => ({
        body: body.toJSON(),
        defaultPrevented: event.defaultPrevented,
        dispatchResult,
        draggable: link.getAttribute('draggable'),
        widgetCount: content?.querySelectorAll('.cm-markdown-block-widget')
          .length,
      })
      expect(readOutput()).toEqual({
        body: source,
        defaultPrevented: false,
        dispatchResult: true,
        draggable: 'false',
        widgetCount: 1,
      })
    },
  )

  it('enters CardLink source on an unmodified click', () => {
    const source = `before\n${cardSource}`
    const { body, content } = mountMarkdownEditor(source)
    const link = content?.querySelector<HTMLAnchorElement>(
      '[data-mdx-card-link]',
    )
    if (!link) throw new Error('The CardLink preview did not mount')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    const dispatchResult = link.dispatchEvent(event)

    const readOutput = () => ({
      body: body.toJSON(),
      defaultPrevented: event.defaultPrevented,
      dispatchResult,
      lines: editorLines(content),
      widgetCount: content?.querySelectorAll('.cm-markdown-block-widget')
        .length,
    })
    expect(readOutput()).toEqual({
      body: source,
      defaultPrevented: true,
      dispatchResult: false,
      lines: ['before', cardSource],
      widgetCount: 0,
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
    const grid = content?.querySelector<HTMLElement>(
      '.cm-markdown-block-widget .grid',
    )
    const gridPreview = {
      blockWidgets: content?.querySelectorAll('.cm-markdown-block-widget')
        .length,
      className: grid?.className,
      images: [...(grid?.querySelectorAll<HTMLImageElement>('img') ?? [])].map(
        (image) => ({
          referrerPolicy: image.getAttribute('referrerpolicy'),
          src: image.getAttribute('src'),
        }),
      ),
    }
    view?.dispatch({ selection: { anchor: source.indexOf('<ImageGrid>') + 1 } })

    const readOutput = () => ({
      body: body.toJSON(),
      editingLines: editorLines(content),
      gridPreview,
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
      gridPreview: {
        blockWidgets: 1,
        className:
          'mt-4 grid grid-cols-1 items-center gap-4 sm:auto-cols-fr sm:grid-flow-col [&>figure]:mt-0',
        images: [
          {
            referrerPolicy: 'no-referrer',
            src: 'https://assets.example.test/first.png?w=100&h=80',
          },
          {
            referrerPolicy: 'no-referrer',
            src: 'https://assets.example.test/second.png?w=120&h=80',
          },
        ],
      },
    })
  })

  it.each([
    { name: 'non-image content', content: 'plain content' },
    {
      name: 'multiple images on one line',
      content:
        '![First](https://assets.example.test/first.png) ![Second](https://assets.example.test/second.png)',
    },
  ])('keeps an ImageGrid with $name as source', ({ content: gridContent }) => {
    const source = `<ImageGrid>\n${gridContent}\n</ImageGrid>`
    const { body, content } = mountMarkdownEditor(source)

    const readOutput = () => ({
      body: body.toJSON(),
      gridCount: content?.querySelectorAll('.grid').length,
      imageCount: content?.querySelectorAll('img').length,
      widgetCount: content?.querySelectorAll('.cm-markdown-block-widget')
        .length,
    })
    expect(readOutput()).toEqual({
      body: source,
      gridCount: 0,
      imageCount: 0,
      widgetCount: 0,
    })
  })

  it('does not pair an unclosed ImageGrid with a later grid close', () => {
    const image = '![Sample](https://assets.example.test/sample.png)'
    const source = [
      '<ImageGrid>',
      '## Preserved heading',
      'Preserved paragraph.',
      '<ImageGrid>',
      image,
      '</ImageGrid>',
      '<ImageGrid />',
    ].join('\n')
    const { body, content } = mountMarkdownEditor(source)

    const readOutput = () => ({
      body: body.toJSON(),
      gridCount: content?.querySelectorAll('.grid').length,
      imageCount: content?.querySelectorAll('img').length,
      lines: editorLines(content),
      widgetCount: content?.querySelectorAll('.cm-markdown-block-widget')
        .length,
    })
    expect(readOutput()).toEqual({
      body: source,
      gridCount: 1,
      imageCount: 1,
      lines: [
        '<ImageGrid>',
        '## Preserved heading',
        'Preserved paragraph.',
        '<ImageGrid />',
      ],
      widgetCount: 1,
    })
  })

  it.each([
    { name: 'an indented line', prefix: '  ' },
    { name: 'a list item', prefix: '- ' },
    { name: 'a blockquote line', prefix: '> ' },
  ])('does not render a component from $name', ({ prefix }) => {
    const source = `${prefix}<CardLink href="https://docs.example.test/guide" />`
    const { body, content } = mountMarkdownEditor(source)

    const readOutput = () => ({
      body: body.toJSON(),
      lines: editorLines(content),
      widgetCount: content?.querySelectorAll('.cm-markdown-block-widget')
        .length,
    })
    expect(readOutput()).toEqual({
      body: source,
      lines: [source],
      widgetCount: 0,
    })
  })

  it('does not extract a SpeakerDeck id from another attribute value', () => {
    const source = '<SpeakerDeck title=" id=\'abc\'" id="bad-id" />'
    const { body, content } = mountMarkdownEditor(source)

    const readOutput = () => ({
      body: body.toJSON(),
      iframeCount: content?.querySelectorAll('iframe').length,
      lines: editorLines(content),
      widgetCount: content?.querySelectorAll('.cm-markdown-block-widget')
        .length,
    })
    expect(readOutput()).toEqual({
      body: source,
      iframeCount: 0,
      lines: [source],
      widgetCount: 0,
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

  it('matches Kbd tags only within one line', () => {
    const source = 'A <Kbd>\nB <Kbd>k</Kbd> tail'
    const { body, content } = mountMarkdownEditor(source)

    const readOutput = () => ({
      body: body.toJSON(),
      keyText: content?.querySelector('kbd')?.textContent,
      keyCount: content?.querySelectorAll('kbd').length,
      text: content?.textContent,
    })
    expect(readOutput()).toEqual({
      body: source,
      keyText: 'k',
      keyCount: 1,
      text: 'A <Kbd>B k tail',
    })
  })

  it('shows Kbd source when a selection crosses its range', () => {
    const source = 'Use <Kbd>Ctrl</Kbd> now'
    const { body, content } = mountMarkdownEditor(source)
    const view = content ? EditorView.findFromDOM(content) : null
    if (!view || !content) throw new Error('The Markdown editor did not mount')
    const selection = { anchor: 0, head: source.length }
    view.dispatch({
      selection,
    })

    const readOutput = () => ({
      body: body.toJSON(),
      keyCount: content.querySelectorAll('kbd').length,
      selection: {
        anchor: view.state.selection.main.anchor,
        head: view.state.selection.main.head,
      },
      text: content.textContent,
    })
    expect(readOutput()).toEqual({
      body: source,
      keyCount: 0,
      selection,
      text: source,
    })
  })

  it('keeps the Kbd widget during Japanese composition', () => {
    const source = 'Type <Kbd>Enter</Kbd> to continue'
    const { body, content } = mountMarkdownEditor(source)
    const view = content ? EditorView.findFromDOM(content) : null
    const key = content?.querySelector<HTMLElement>('kbd')
    if (!view || !content || !key)
      throw new Error('The Kbd preview did not mount')
    const toDOM = vi.spyOn(DomWidget.prototype, 'toDOM')
    const initialRenderCount = toDOM.mock.calls.length
    const japaneseInput = 'にほんご '
    const selectionPosition = japaneseInput.length + source.indexOf('Enter') + 1

    content.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    )
    view.dispatch({ changes: { from: 0, insert: japaneseInput } })
    view.dispatch({ selection: { anchor: selectionPosition } })

    const readOutput = () => ({
      body: body.toJSON(),
      keyIsSame: content.querySelector('kbd') === key,
      keyText: content.querySelector('kbd')?.textContent,
      selection: {
        anchor: view.state.selection.main.anchor,
        head: view.state.selection.main.head,
      },
      renderCountDelta: toDOM.mock.calls.length - initialRenderCount,
    })
    const output = readOutput()
    content.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    )
    toDOM.mockRestore()
    expect(output).toEqual({
      body: `${japaneseInput}${source}`,
      keyIsSame: true,
      keyText: 'Enter',
      selection: { anchor: selectionPosition, head: selectionPosition },
      renderCountDelta: 0,
    })
  })

  it('does not rebuild component decorations during Japanese composition', async () => {
    const fetchOgp = vi.fn(() => okAsync(metadata))
    const source = `before\n\n${cardSource}\n\nafter`
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      fetchOgp,
    })
    const view = content ? EditorView.findFromDOM(content) : null
    await vi.waitUntil(() => {
      const title = content?.querySelector('a p')?.textContent
      return title === metadata.title ? title : undefined
    })
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
