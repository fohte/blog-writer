import { EditorView } from '@codemirror/view'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'

import { addEvidence } from '#article/evidence'
import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'
import { DomWidget } from '#editor/dom-widget'
import { SuggestionLayerController } from '#editor/suggestion-layer'

const tableSource = [
  '| Feature | Offline |',
  '| :--- | ---: |',
  '| Tables | Yes |',
].join('\n')
const imageSource =
  '![Sample](https://assets.example.test/images/sample.webp?w=640&h=360)'
const clickableImageSource = imageSource
const mermaidSource = '```mermaid\ngraph LR\n  Draft --> Preview\n```'

describe('Markdown block widget interactions', () => {
  it.each([
    {
      block: 'table',
      markdown: tableSource,
      selector: 'table td',
      previewSelector: 'table',
    },
    {
      block: 'image',
      markdown: clickableImageSource,
      selector: 'figure',
      previewSelector: 'figure',
    },
    {
      block: 'Mermaid diagram',
      markdown: mermaidSource,
      selector: 'figure',
      previewSelector: 'figure',
    },
  ])(
    'opens the Markdown source when the rendered $block is clicked',
    async ({ block, markdown, selector, previewSelector }) => {
      const source = `before\n\n${markdown}\n\nafter`
      const from = source.indexOf(markdown)
      const to = from + markdown.length
      const { body, content } = mountMarkdownEditor(source)
      const view = content ? EditorView.findFromDOM(content) : null
      const target = content?.querySelector(selector)
      if (!view || !content || !target)
        throw new Error(`The ${block} preview did not mount`)

      await act(async () => {
        await userEvent.click(target)
      })

      const readOutput = () => ({
        body: body.toJSON(),
        cursorInsideBlock:
          view.state.selection.main.head >= from &&
          view.state.selection.main.head <= to,
        renderedPreviewCount: content.querySelectorAll(previewSelector).length,
      })
      expect(readOutput()).toEqual({
        body: source,
        cursorInsideBlock: true,
        renderedPreviewCount: block === 'table' ? 0 : 1,
      })
    },
  )

  it.each([
    {
      block: 'table',
      markdown: tableSource,
      direction: 'down',
      key: 'ArrowDown',
      fromBefore: true,
    },
    {
      block: 'table',
      markdown: tableSource,
      direction: 'up',
      key: 'ArrowUp',
      fromBefore: false,
    },
    {
      block: 'image',
      markdown: clickableImageSource,
      direction: 'down',
      key: 'ArrowDown',
      fromBefore: true,
    },
    {
      block: 'image',
      markdown: clickableImageSource,
      direction: 'up',
      key: 'ArrowUp',
      fromBefore: false,
    },
    {
      block: 'Mermaid diagram',
      markdown: mermaidSource,
      direction: 'down',
      key: 'ArrowDown',
      fromBefore: true,
    },
    {
      block: 'Mermaid diagram',
      markdown: mermaidSource,
      direction: 'up',
      key: 'ArrowUp',
      fromBefore: false,
    },
  ])(
    'enters a rendered $block with Arrow $direction',
    async ({ block, markdown, key, fromBefore }) => {
      const source = `before\n\n${markdown}\n\nafter`
      const from = source.indexOf(markdown)
      const to = from + markdown.length
      const { body, content } = mountMarkdownEditor(source, [], undefined, {
        initialSelection: {
          anchor: fromBefore ? 'before'.length : to + 2,
        },
      })
      const view = content ? EditorView.findFromDOM(content) : null
      if (!view || !content)
        throw new Error('The Markdown editor did not mount')
      content.focus()

      await act(async () => {
        await userEvent.keyboard(`{${key}}`)
      })

      const readOutput = () => ({
        body: body.toJSON(),
        cursorInsideBlock:
          view.state.selection.main.head >= from &&
          view.state.selection.main.head <= to,
        renderedPreviewCount: content.querySelectorAll('figure, table').length,
      })
      expect(readOutput()).toEqual({
        body: source,
        cursorInsideBlock: true,
        renderedPreviewCount: block === 'table' ? 0 : 1,
      })
    },
  )

  it.each([
    { name: 'start', boundary: 'start' },
    { name: 'end', boundary: 'end' },
  ] as const)(
    'inserts typed text at the table $name boundary',
    async ({ boundary }) => {
      const source = `b\n${tableSource}\n\nz`
      const from = 2
      const to = from + tableSource.length
      const position = boundary === 'start' ? from : to
      const expected =
        boundary === 'start'
          ? `b\nZ${tableSource}\n\nz`
          : `b\n${tableSource}Z\n\nz`
      const { body, content } = mountMarkdownEditor(source)
      const view = content ? EditorView.findFromDOM(content) : null
      if (!view || !content)
        throw new Error('The Markdown editor did not mount')
      view.dispatch({ selection: { anchor: position } })
      view.focus()

      await act(async () => {
        await userEvent.keyboard('Z')
      })

      const readOutput = () => ({
        body: body.toJSON(),
        head: view.state.selection.main.head,
      })
      expect(readOutput()).toEqual({
        body: expected,
        head: position + 1,
      })
    },
  )

  it.each([
    { name: 'paste', method: 'paste' },
    { name: 'drop', method: 'drop' },
  ])(
    'does not process an image $name without an uploader',
    async ({ method }) => {
      const source = 'Keep this paragraph.'
      const { body, content, host } = mountMarkdownEditor(source)
      if (!content) throw new Error('The Markdown editor did not mount')
      const transfer = new DataTransfer()
      transfer.items.add(
        new File(['image data'], 'sample.png', { type: 'image/png' }),
      )
      const event =
        method === 'paste'
          ? new Event('paste', { bubbles: true, cancelable: true })
          : new DragEvent('drop', {
              bubbles: true,
              cancelable: true,
              dataTransfer: transfer,
              clientX: 1,
              clientY: 1,
            })
      if (method === 'paste')
        Object.defineProperty(event, 'clipboardData', { value: transfer })
      await act(async () => {
        content.dispatchEvent(event)
        await Promise.resolve()
      })

      const readOutput = () => ({
        body: body.toJSON(),
        defaultPrevented: event.defaultPrevented,
        error: host.querySelector('[role="alert"]')?.textContent ?? null,
      })
      expect(readOutput()).toEqual({
        body: source,
        defaultPrevented: true,
        error: null,
      })
    },
  )

  it('renders a tail table when background parsing reaches it after scrolling', async () => {
    const prefix = 'A sentence for delayed Markdown parsing.\n\n'.repeat(360)
    const source = `${prefix}${tableSource}`
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      initialSelection: { anchor: 0 },
    })
    const view = content ? EditorView.findFromDOM(content) : null
    if (!view || !content) throw new Error('The Markdown editor did not mount')
    const initialTableCount = content.querySelectorAll('table').length
    view.dispatch({
      effects: EditorView.scrollIntoView(source.length, { y: 'end' }),
    })

    await act(async () => {
      await vi.waitUntil(() => content.querySelector('table') !== null, {
        timeout: 10_000,
      })
    })

    const readOutput = () => ({
      bodyLength: body.length,
      cursor: view.state.selection.main.head,
      initialTableCount,
      renderedTableCount: content.querySelectorAll('table').length,
      tailCell: content.querySelector('tbody tr td')?.textContent ?? null,
    })
    expect(readOutput()).toEqual({
      bodyLength: source.length,
      cursor: 0,
      initialTableCount: 0,
      renderedTableCount: 1,
      tailCell: 'Tables',
    })
  })

  it('preserves a rendered Mermaid diagram when text above it changes', async () => {
    const source = `before\n\n${mermaidSource}\n\nafter`
    const { body, content } = mountMarkdownEditor(source)
    const view = content ? EditorView.findFromDOM(content) : null
    if (!view || !content) throw new Error('The Markdown editor did not mount')
    const toDOM = vi.spyOn(DomWidget.prototype, 'toDOM')
    await act(async () => {
      await vi.waitUntil(() => content.querySelector('svg') !== null)
    })
    const initialRenderCount = toDOM.mock.calls.length

    try {
      act(() => {
        view.dispatch({
          changes: { from: 'before'.length, insert: ' updated' },
        })
      })

      const readOutput = () => ({
        body: body.toJSON(),
        diagramCount: content.querySelectorAll('svg').length,
        renderCount: toDOM.mock.calls.length,
      })
      expect(readOutput()).toEqual({
        body: `before updated\n\n${mermaidSource}\n\nafter`,
        diagramCount: 1,
        renderCount: initialRenderCount,
      })
    } finally {
      toDOM.mockRestore()
    }
  })

  it('keeps an evidence marker visible over a table instead of replacing its source', () => {
    const source = `before\n\n${tableSource}\n\nafter`
    const from = source.indexOf(tableSource)
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      prepareDoc: (doc) => {
        addEvidence(doc, {
          id: 'evidence-table',
          from,
          to: from + tableSource.length,
          claim: tableSource,
          sourceId: null,
          quote: 'The table provides supporting values.',
          verdict: 'supported',
          checkedAt: '2026-02-01T00:00:00.000Z',
        })._unsafeUnwrap()
      },
    })

    const readOutput = () => ({
      body: body.toJSON(),
      evidenceMarker:
        content?.querySelector('.cm-evidence-marker')?.textContent ?? null,
      renderedTableCount: content?.querySelectorAll('table').length ?? 0,
    })
    expect(readOutput()).toEqual({
      body: source,
      evidenceMarker: '[?]',
      renderedTableCount: 0,
    })
  })

  it('keeps move handles on rendered blocks and moves a table from its menu', async () => {
    const source = [
      'Before paragraph.',
      '',
      tableSource,
      '',
      imageSource,
      '',
      mermaidSource,
      '',
      'After paragraph.',
    ].join('\n')
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      showMoveHandles: true,
      initialSelection: { anchor: 0 },
    })
    if (!content) throw new Error('The Markdown editor did not mount')
    const handles = content.querySelectorAll<HTMLButtonElement>(
      '.cm-block-drag-handle',
    )
    const tableHandle = handles[1]
    if (!tableHandle) throw new Error('The table move handle did not mount')

    await act(async () => {
      await userEvent.click(tableHandle)
    })
    const menuItemElements = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ]
    const moveDown = menuItemElements.find(
      (item) => item.textContent === 'Move down',
    )
    const menuItems = menuItemElements.map((item) => item.textContent)
    if (!moveDown) throw new Error('The table Move down action did not mount')
    await act(async () => {
      await userEvent.click(moveDown)
    })

    const readOutput = () => ({
      body: body.toJSON(),
      handleCount: handles.length,
      menuItems,
    })
    expect(readOutput()).toEqual({
      body: [
        'Before paragraph.',
        '',
        imageSource,
        '',
        tableSource,
        '',
        mermaidSource,
        '',
        'After paragraph.',
      ].join('\n'),
      handleCount: 5,
      menuItems: ['Move up', 'Move down'],
    })
  })

  it('keeps suggestion markers and focused diffs visible over a table', () => {
    const source = `before\n\n${tableSource}\n\nafter`
    const from = source.indexOf(tableSource)
    const layer = new SuggestionLayerController({
      initialSuggestions: [
        {
          id: 'table-suggestion',
          from,
          to: from + tableSource.length,
          replacement: 'A revised table.',
        },
      ],
    })
    const { body, content } = mountMarkdownEditor(
      source,
      [layer.extension],
      undefined,
      { initialSelection: { anchor: 0 } },
    )
    if (!content) throw new Error('The Markdown editor did not mount')
    const unfocused = {
      body: body.toJSON(),
      marker:
        content.querySelector('.cm-suggestion-marker')?.textContent ?? null,
      renderedTableCount: content.querySelectorAll('table').length,
    }

    act(() => {
      layer.focus('table-suggestion')
    })

    const focused = {
      body: body.toJSON(),
      diff: content.querySelector('.suggestion-diff-text')?.textContent ?? null,
      renderedTableCount: content.querySelectorAll('table').length,
    }
    const readOutput = () => ({ unfocused, focused })
    expect(readOutput()).toEqual({
      unfocused: {
        body: source,
        marker: '提案',
        renderedTableCount: 0,
      },
      focused: {
        body: source,
        diff: tableSource + 'A revised table.',
        renderedTableCount: 0,
      },
    })
  })
})
