import { EditorView } from '@codemirror/view'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { addEvidence } from '#article/evidence'
import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'
import { DomWidget } from '#editor/dom-widget'
import { SuggestionLayerController } from '#editor/suggestion-layer'
import { dispatchDragEvents } from '#test-support/browser.test-support.test'

const tableSource = [
  '| Feature | Offline |',
  '| :--- | ---: |',
  '| Tables | Yes |',
].join('\n')
const imageSource =
  '![Sample](https://assets.example.test/images/sample.webp?w=640&h=360)'
const clickableImageSource = imageSource
const mermaidSource = '```mermaid\ngraph LR\n  Draft --> Preview\n```'
const localImageSource =
  "![Sample](data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1'%20height='1'%3E%3C/svg%3E)"
const linkTableSource = [
  '| Feature | Guide |',
  '| --- | --- |',
  '| Links | [Open](https://assets.example.test/guide) |',
].join('\n')

function hasEditorSource(content: HTMLElement, source: string): boolean {
  const visibleText = [...content.querySelectorAll<HTMLElement>('.cm-line')]
    .map((line) => line.textContent)
    .join('')
  return visibleText.includes(source.replaceAll('\n', ''))
}

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

  it('keeps a table link clickable without opening the Markdown source', async () => {
    const source = `before\n\n${linkTableSource}\n\nafter`
    const { body, content } = mountMarkdownEditor(source)
    const anchor = content?.querySelector<HTMLAnchorElement>('table a')
    if (!content || !anchor) throw new Error('The table link did not mount')
    let clicked = false
    anchor.addEventListener('click', (event) => {
      clicked = true
      event.preventDefault()
    })

    await act(async () => {
      await userEvent.click(anchor)
    })

    const readOutput = () => ({
      body: body.toJSON(),
      clicked,
      href: anchor.getAttribute('href'),
      renderedTableCount: content.querySelectorAll('table').length,
      sourceVisible: hasEditorSource(content, '| Feature | Guide |'),
    })
    expect(readOutput()).toEqual({
      body: source,
      clicked: true,
      href: 'https://assets.example.test/guide',
      renderedTableCount: 1,
      sourceVisible: false,
    })
  })

  it('activates a focused table link with Enter without editing the body', async () => {
    const source = `top\n\n${linkTableSource}\n\nafter`
    const { body, content } = mountMarkdownEditor(source)
    const anchor = content?.querySelector<HTMLAnchorElement>('table a')
    if (!content || !anchor) throw new Error('The table link did not mount')
    let clicked = false
    anchor.addEventListener('click', (event) => {
      clicked = true
      event.preventDefault()
    })
    anchor.focus()

    await act(async () => {
      await userEvent.keyboard('{Enter}')
    })

    const readOutput = () => ({
      body: body.toJSON(),
      clicked,
      previewCount: content.querySelectorAll('table').length,
      sourceVisible: hasEditorSource(content, linkTableSource),
    })
    expect(readOutput()).toEqual({
      body: source,
      clicked: true,
      previewCount: 1,
      sourceVisible: false,
    })
  })

  it('keeps a touch scroll on a table preview and enters only on tap', () => {
    const source = `before\n\n${tableSource}\n\nafter`
    const from = source.indexOf(tableSource)
    const to = from + tableSource.length
    const { body, content } = mountMarkdownEditor(source)
    const view = content ? EditorView.findFromDOM(content) : null
    const table = content?.querySelector('table')
    if (!view || !content || !table)
      throw new Error('The table preview did not mount')

    act(() => {
      table.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: 'touch',
          button: 0,
        }),
      )
      table.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 1,
          pointerType: 'touch',
          button: -1,
          clientY: 40,
        }),
      )
      table.dispatchEvent(
        new PointerEvent('pointercancel', {
          bubbles: true,
          pointerId: 1,
          pointerType: 'touch',
          button: -1,
        }),
      )
    })
    const afterScroll = {
      body: body.toJSON(),
      cursorInsideTable:
        view.state.selection.main.head >= from &&
        view.state.selection.main.head <= to,
      renderedTableCount: content.querySelectorAll('table').length,
      sourceVisible: hasEditorSource(content, tableSource),
    }

    act(() => {
      table.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          pointerId: 2,
          pointerType: 'touch',
          button: 0,
        }),
      )
      table.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      )
      table.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 2,
          pointerType: 'touch',
          button: 0,
        }),
      )
      table.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, button: 0 }),
      )
      table.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      )
    })

    const afterTap = {
      body: body.toJSON(),
      cursorInsideTable:
        view.state.selection.main.head >= from &&
        view.state.selection.main.head <= to,
      renderedTableCount: content.querySelectorAll('table').length,
      sourceVisible: hasEditorSource(content, tableSource),
    }
    const readOutput = () => ({ afterScroll, afterTap })
    expect(readOutput()).toEqual({
      afterScroll: {
        body: source,
        cursorInsideTable: false,
        renderedTableCount: 1,
        sourceVisible: false,
      },
      afterTap: {
        body: source,
        cursorInsideTable: true,
        renderedTableCount: 0,
        sourceVisible: true,
      },
    })
  })

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

  it('preserves block previews when text above them changes with move handles enabled', async () => {
    const source = [
      'top',
      '',
      tableSource,
      '',
      mermaidSource,
      '',
      tableSource,
      '',
      localImageSource,
      '',
      'end',
    ].join('\n')
    const { body, content, host } = mountMarkdownEditor(source, [], undefined, {
      initialSelection: { anchor: 'top'.length },
      showMoveHandles: true,
    })
    const view = content ? EditorView.findFromDOM(content) : null
    if (!view || !content) throw new Error('The Markdown editor did not mount')
    const toDOM = vi.spyOn(DomWidget.prototype, 'toDOM')
    await act(async () => {
      await vi.waitUntil(
        () =>
          content.querySelector('svg') !== null &&
          content.querySelectorAll('table').length === 2 &&
          content.querySelector('figure img') !== null,
      )
    })
    const initialRenderCount = toDOM.mock.calls.length
    const initialSvg = content.querySelector('svg')

    try {
      await act(async () => {
        view.focus()
        await userEvent.type(view.contentDOM, ' updated')
      })

      const readOutput = () => ({
        body: body.toJSON(),
        diagramCount: content.querySelectorAll('svg').length,
        previewCount: content.querySelectorAll('table, figure').length,
        handleCount: host.querySelectorAll('.cm-block-drag-handle').length,
        renderCount: toDOM.mock.calls.length,
        svgReused: content.querySelector('svg') === initialSvg,
      })
      expect(readOutput()).toEqual({
        body: source.replace('top', 'top updated'),
        diagramCount: 1,
        previewCount: 4,
        handleCount: 6,
        renderCount: initialRenderCount,
        svgReused: true,
      })
    } finally {
      toDOM.mockRestore()
    }
  })

  it.each([
    { block: 'table', markdown: tableSource, previewSelector: 'table' },
    { block: 'image', markdown: imageSource, previewSelector: 'figure' },
    {
      block: 'Mermaid diagram',
      markdown: mermaidSource,
      previewSelector: 'figure',
    },
  ])(
    'keeps an evidence marker visible over a $block instead of replacing its source',
    ({ block, markdown, previewSelector }) => {
      const source = `before\n\n${markdown}\n\nafter`
      const from = source.indexOf(markdown)
      const { body, content } = mountMarkdownEditor(source, [], undefined, {
        prepareDoc: (doc) => {
          addEvidence(doc, {
            id: `evidence-${block}`,
            from,
            to: from + markdown.length,
            claim: markdown,
            sourceId: null,
            quote: 'The block provides supporting information.',
            verdict: 'supported',
            checkedAt: '2026-02-01T00:00:00.000Z',
          })._unsafeUnwrap()
        },
      })
      if (!content) throw new Error('The Markdown editor did not mount')

      const readOutput = () => ({
        body: body.toJSON(),
        evidenceMarker:
          content.querySelector('.cm-evidence-marker')?.textContent ?? null,
        sourceVisible: hasEditorSource(content, markdown),
        renderedPreviewCount: content.querySelectorAll(previewSelector).length,
      })
      expect(readOutput()).toEqual({
        body: source,
        evidenceMarker: '[?]',
        sourceVisible: true,
        renderedPreviewCount: 0,
      })
    },
  )

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
    const { body, content, host } = mountMarkdownEditor(source, [], undefined, {
      showMoveHandles: true,
      initialSelection: { anchor: 0 },
    })
    if (!content) throw new Error('The Markdown editor did not mount')
    const handles = host.querySelectorAll<HTMLButtonElement>(
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
      previewCount: content.querySelectorAll('table, figure').length,
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
      previewCount: 3,
    })
  })

  it.each([
    {
      scenario: 'at the start of the document',
      block: 'table',
      markdown: tableSource,
      previewSelector: 'table',
      source: `${tableSource}\n\nAfter paragraph.`,
      handleIndex: 0,
      expectedBody: `After paragraph.\n\n${tableSource}\n`,
      expectedHandleCount: 2,
      expectedMoveResult: 'success',
    },
    {
      scenario: 'at the start of the document',
      block: 'image',
      markdown: imageSource,
      previewSelector: 'figure',
      source: `${imageSource}\n\nAfter paragraph.`,
      handleIndex: 0,
      expectedBody: `After paragraph.\n\n${imageSource}\n`,
      expectedHandleCount: 2,
      expectedMoveResult: 'success',
    },
    {
      scenario: 'at the start of the document',
      block: 'Mermaid diagram',
      markdown: mermaidSource,
      previewSelector: 'figure',
      source: `${mermaidSource}\n\nAfter paragraph.`,
      handleIndex: 0,
      expectedBody: `After paragraph.\n\n${mermaidSource}\n`,
      expectedHandleCount: 2,
      expectedMoveResult: 'success',
    },
    {
      scenario: 'after a paragraph',
      block: 'table',
      markdown: tableSource,
      previewSelector: 'table',
      source: `Before paragraph.\n\n${tableSource}\n\nAfter paragraph.`,
      handleIndex: 1,
      expectedBody: `Before paragraph.\n\nAfter paragraph.\n\n${tableSource}\n`,
      expectedHandleCount: 3,
      expectedMoveResult: 'success',
    },
  ])(
    'uses the $block handle position for a drag $scenario',
    async ({
      block,
      expectedBody,
      expectedHandleCount,
      expectedMoveResult,
      handleIndex,
      markdown,
      previewSelector,
      source,
    }) => {
      const { body, content, history, host } = mountMarkdownEditor(
        source,
        [],
        undefined,
        {
          initialSelection: { anchor: source.length },
          showMoveHandles: true,
        },
      )
      const handle = host.querySelectorAll<HTMLButtonElement>(
        '.cm-block-drag-handle',
      )[handleIndex]
      const target = [
        ...(content?.querySelectorAll<HTMLElement>('.cm-line') ?? []),
      ].find((line) => line.textContent.includes('After paragraph.'))
      if (!content || !handle || !target)
        throw new Error(
          `The leading ${block} handle or drop target did not mount`,
        )
      const targetText = [...target.childNodes].find(
        (node): node is Text =>
          node.nodeType === Node.TEXT_NODE &&
          node.textContent?.includes('After paragraph.') === true,
      )
      if (!targetText)
        throw new Error('The drop target paragraph did not render as text')
      const targetTextOffset =
        targetText.textContent.indexOf('After paragraph.')
      const targetRange = document.createRange()
      targetRange.setStart(targetText, targetTextOffset)
      targetRange.setEnd(targetText, targetTextOffset + 1)
      const view = EditorView.findFromDOM(content)
      if (!view) throw new Error('The Markdown editor did not mount')
      await act(async () => {
        await vi.waitUntil(() => {
          const textBounds = targetRange.getBoundingClientRect()
          const lineBounds = target.getBoundingClientRect()
          return (
            view.posAtCoords({
              x: textBounds.left + textBounds.width / 2,
              y: lineBounds.bottom - 1,
            }) !== null
          )
        })
      })
      const textBounds = targetRange.getBoundingClientRect()
      const lineBounds = target.getBoundingClientRect()
      const moveResults: string[] = []
      const moveHistory = history.move.bind(history)
      const move = vi
        .spyOn(history, 'move')
        .mockImplementation((input, view) => {
          const result = moveHistory(input, view)
          moveResults.push(
            result.match(
              () => 'success',
              (error) => error.message,
            ),
          )
          return result
        })
      act(() => {
        dispatchDragEvents(handle, target, {
          x: textBounds.left + textBounds.width / 2,
          y: lineBounds.bottom - 1,
        })
      })

      const readOutput = () => ({
        body: body.toJSON(),
        handleCount: host.querySelectorAll('.cm-block-drag-handle').length,
        moveCalls: move.mock.calls.map(([input]) => input),
        moveResults,
        previewCount: content.querySelectorAll(previewSelector).length,
      })
      expect(readOutput()).toEqual({
        body: expectedBody,
        handleCount: expectedHandleCount,
        moveCalls: [
          { from: source.indexOf(markdown), destination: source.length },
        ],
        moveResults: [expectedMoveResult],
        previewCount: 1,
      })
    },
  )

  it('opens the Mermaid handle beside a table without changing source rejected by move validation', async () => {
    const source = `${tableSource}\n${mermaidSource}\n\nAfter paragraph.`
    const { body, content, history, host } = mountMarkdownEditor(
      source,
      [],
      undefined,
      {
        initialSelection: { anchor: source.length },
        showMoveHandles: true,
      },
    )
    const handle = host.querySelectorAll<HTMLButtonElement>(
      '.cm-block-drag-handle',
    )[1]
    if (!content || !handle)
      throw new Error('The adjacent Mermaid handle did not mount')
    const moveResults: string[] = []
    const moveHistory = history.move.bind(history)
    const move = vi.spyOn(history, 'move').mockImplementation((input, view) => {
      const result = moveHistory(input, view)
      moveResults.push(
        result.match(
          () => 'success',
          (error) => error.message,
        ),
      )
      return result
    })
    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: 'Move block' }).nth(1),
      )
    })
    const moveDown = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === 'Move down')
    if (!moveDown) throw new Error('The Mermaid Move down action did not mount')
    await act(async () => {
      await userEvent.click(moveDown)
    })

    const readOutput = () => ({
      body: body.toJSON(),
      editorSourceVisible: hasEditorSource(content, mermaidSource),
      handleCount: host.querySelectorAll('.cm-block-drag-handle').length,
      moveCalls: move.mock.calls.map(([input]) => input),
      moveResults,
      previewCount: content.querySelectorAll('table, figure').length,
    })
    expect(readOutput()).toEqual({
      body: source,
      editorSourceVisible: false,
      handleCount: 3,
      moveCalls: [
        {
          from: source.indexOf(mermaidSource),
          destination: source.length,
        },
      ],
      moveResults: ['The move would change Markdown block structure'],
      previewCount: 2,
    })
  })

  it.each([
    { block: 'table', markdown: tableSource, previewSelector: 'table' },
    { block: 'image', markdown: imageSource, previewSelector: 'figure' },
    {
      block: 'Mermaid diagram',
      markdown: mermaidSource,
      previewSelector: 'figure',
    },
  ])(
    'keeps the leading $block move handle usable',
    async ({ block, markdown, previewSelector }) => {
      const source = `${markdown}\n\nAfter paragraph.`
      const { body, content, host } = mountMarkdownEditor(
        source,
        [],
        undefined,
        {
          initialSelection: { anchor: source.length },
          showMoveHandles: true,
        },
      )
      const handle = host.querySelector<HTMLButtonElement>(
        '.cm-block-drag-handle',
      )
      if (!content || !handle)
        throw new Error(`The leading ${block} handle did not mount`)
      await act(async () => {
        await userEvent.click(
          page.getByRole('button', { name: 'Move block' }).first(),
        )
      })
      const menu = document.querySelector('[role="menu"]')
      const menuItems =
        menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
      if (!menuItems)
        throw new Error(`The leading ${block} move menu did not mount`)
      const moveDown = [...menuItems].find(
        (item) => item.textContent === 'Move down',
      )
      if (!moveDown)
        throw new Error(`The leading ${block} Move down action is missing`)
      await act(async () => {
        await userEvent.click(moveDown)
      })

      const readOutput = () => ({
        body: body.toJSON(),
        handleCount: host.querySelectorAll('.cm-block-drag-handle').length,
        menuItems: [...menuItems].map((item) => item.textContent),
        sourceVisible: hasEditorSource(content, markdown),
        previewCount: content.querySelectorAll(previewSelector).length,
      })
      expect(readOutput()).toEqual({
        body: `After paragraph.\n\n${markdown}\n`,
        handleCount: 2,
        menuItems: ['Move up', 'Move down'],
        sourceVisible: false,
        previewCount: 1,
      })
    },
  )

  it('keeps paragraph and adjacent block handles on separate rows', async () => {
    const source = `Top paragraph.\n${tableSource}\n${mermaidSource}`
    const { content, host } = mountMarkdownEditor(source, [], undefined, {
      initialSelection: { anchor: source.length },
      showMoveHandles: true,
    })
    const handles = host.querySelectorAll<HTMLButtonElement>(
      '.cm-block-drag-handle',
    )
    const table = content?.querySelector('table')
    if (!content || !table || handles.length < 2)
      throw new Error('The paragraph or adjacent block handle did not mount')

    await act(async () => {
      await vi.waitUntil(() => {
        const first = handles[0]?.getBoundingClientRect()
        const second = handles[1]?.getBoundingClientRect()
        return (
          first !== undefined &&
          second !== undefined &&
          (first.bottom <= second.top || second.bottom <= first.top)
        )
      })
    })

    const paragraph = handles[0]?.getBoundingClientRect()
    const block = handles[1]?.getBoundingClientRect()
    if (!paragraph || !block) throw new Error('A move handle has no geometry')

    const readOutput = () => ({
      handleCount: handles.length,
      handlesOverlap:
        paragraph.left < block.right &&
        block.left < paragraph.right &&
        paragraph.top < block.bottom &&
        block.top < paragraph.bottom,
      previewCount: content.querySelectorAll('table, figure').length,
    })
    expect(readOutput()).toEqual({
      handleCount: 3,
      handlesOverlap: false,
      previewCount: 2,
    })
  })

  it.each([
    {
      block: 'table',
      markdown: tableSource,
      previewSelector: 'table',
      sourcePreviewCount: 0,
    },
    {
      block: 'image',
      markdown: imageSource,
      previewSelector: 'figure',
      sourcePreviewCount: 1,
    },
    {
      block: 'Mermaid diagram',
      markdown: mermaidSource,
      previewSelector: 'figure',
      sourcePreviewCount: 1,
    },
  ])(
    'keeps the $block handle usable after entering its Markdown source',
    async ({ block, markdown, previewSelector, sourcePreviewCount }) => {
      const source = `Before paragraph.\n\n${markdown}\n\nAfter paragraph.`
      const { body, content, host, history } = mountMarkdownEditor(
        source,
        [],
        undefined,
        {
          showMoveHandles: true,
          initialSelection: { anchor: source.indexOf(markdown) + 2 },
        },
      )
      if (!content) throw new Error('The Markdown editor did not mount')
      if (block === 'Mermaid diagram') {
        await act(async () => {
          await vi.waitUntil(() => content.querySelector('svg') !== null)
        })
      }
      const afterSource = {
        body: body.toJSON(),
        previewCount: content.querySelectorAll(previewSelector).length,
        sourceVisible: hasEditorSource(content, markdown),
        handleCount: host.querySelectorAll('.cm-block-drag-handle').length,
      }
      const handle = host.querySelectorAll<HTMLButtonElement>(
        '.cm-block-drag-handle',
      )[1]
      if (!handle) throw new Error(`The ${block} move handle did not mount`)

      const move = vi.spyOn(history, 'move')
      await act(async () => {
        await userEvent.click(
          page.getByRole('button', { name: 'Move block' }).nth(1),
        )
      })
      const menuItemElements = [
        ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      ]
      const afterHandle = {
        previewCount: content.querySelectorAll(previewSelector).length,
        sourceVisible: hasEditorSource(content, markdown),
        menuItems: menuItemElements.map((item) => item.textContent),
        handleCount: host.querySelectorAll('.cm-block-drag-handle').length,
      }
      const moveDown = menuItemElements.find(
        (item) => item.textContent === 'Move down',
      )
      if (!moveDown)
        throw new Error(`The ${block} Move down action did not mount`)
      await act(async () => {
        await userEvent.click(moveDown)
      })

      const readOutput = () => ({
        afterSource,
        afterHandle,
        body: body.toJSON(),
        moveCalls: move.mock.calls.map(([input]) => input),
      })
      expect(readOutput()).toEqual({
        afterSource: {
          body: source,
          previewCount: sourcePreviewCount,
          sourceVisible: true,
          handleCount: 3,
        },
        afterHandle: {
          previewCount: sourcePreviewCount,
          sourceVisible: true,
          menuItems: ['Move up', 'Move down'],
          handleCount: 3,
        },
        body: `Before paragraph.\n\nAfter paragraph.\n\n${markdown}\n`,
        moveCalls: [
          { from: source.indexOf(markdown), destination: source.length },
        ],
      })
    },
  )

  it('moves a block from its handle after earlier text shifts its position', async () => {
    const source = [
      'Before paragraph.',
      '',
      tableSource,
      '',
      imageSource,
      '',
      'After paragraph.',
    ].join('\n')
    const { body, content, host } = mountMarkdownEditor(source, [], undefined, {
      showMoveHandles: true,
      initialSelection: { anchor: 0 },
    })
    const view = content ? EditorView.findFromDOM(content) : null
    const initialTableHandle = host.querySelectorAll<HTMLButtonElement>(
      '.cm-block-drag-handle',
    )[1]
    if (!view || !content || !initialTableHandle)
      throw new Error('The table move handle did not mount')

    act(() => {
      view.dispatch({
        changes: {
          from: 'Before paragraph.'.length,
          insert: ' revised',
        },
      })
    })
    const tableHandle = host.querySelectorAll<HTMLButtonElement>(
      '.cm-block-drag-handle',
    )[1]
    if (!tableHandle)
      throw new Error('The updated table move handle did not mount')

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
      handleCount: host.querySelectorAll('.cm-block-drag-handle').length,
      menuItems,
    })
    expect(readOutput()).toEqual({
      body: [
        'Before paragraph. revised',
        '',
        imageSource,
        '',
        tableSource,
        '',
        'After paragraph.',
      ].join('\n'),
      handleCount: 4,
      menuItems: ['Move up', 'Move down'],
    })
  })

  it.each([
    { block: 'table', markdown: tableSource, previewSelector: 'table' },
    { block: 'image', markdown: imageSource, previewSelector: 'figure' },
    {
      block: 'Mermaid diagram',
      markdown: mermaidSource,
      previewSelector: 'figure',
    },
  ])(
    'keeps suggestion markers and focused diffs visible over a $block',
    ({ block, markdown, previewSelector }) => {
      const source = `before\n\n${markdown}\n\nafter`
      const from = source.indexOf(markdown)
      const suggestionId = `${block}-suggestion`
      const layer = new SuggestionLayerController({
        initialSuggestions: [
          {
            id: suggestionId,
            from,
            to: from + markdown.length,
            replacement: 'A revised block.',
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
        renderedPreviewCount: content.querySelectorAll(previewSelector).length,
      }

      act(() => {
        layer.focus(suggestionId)
      })

      const focused = {
        body: body.toJSON(),
        diff:
          content.querySelector('.suggestion-diff-text')?.textContent ?? null,
        renderedPreviewCount: content.querySelectorAll(previewSelector).length,
      }
      const readOutput = () => ({ unfocused, focused })
      expect(readOutput()).toEqual({
        unfocused: {
          body: source,
          marker: '提案',
          renderedPreviewCount: 0,
        },
        focused: {
          body: source,
          diff: markdown + 'A revised block.',
          renderedPreviewCount: 0,
        },
      })
    },
  )

  it('restores image source when a suggestion is added after mounting', () => {
    const source = `before\n\n${imageSource}\n\nafter`
    const from = source.indexOf(imageSource)
    const layer = new SuggestionLayerController()
    const { body, content } = mountMarkdownEditor(
      source,
      [layer.extension],
      undefined,
      { initialSelection: { anchor: 0 } },
    )
    if (!content) throw new Error('The Markdown editor did not mount')
    const initial = {
      body: body.toJSON(),
      renderedPreviewCount: content.querySelectorAll('figure').length,
      sourceVisible: hasEditorSource(content, imageSource),
    }
    let suggestionSet = false

    act(() => {
      suggestionSet = layer
        .setSuggestions([
          {
            id: 'image-suggestion',
            from,
            to: from + imageSource.length,
            replacement: 'A revised image.',
          },
        ])
        .isOk()
    })

    const readOutput = () => ({
      initial,
      afterSuggestion: {
        body: body.toJSON(),
        renderedPreviewCount: content.querySelectorAll('figure').length,
        sourceVisible: hasEditorSource(content, imageSource),
        suggestionMarker:
          content.querySelector('.cm-suggestion-marker')?.textContent ?? null,
      },
      suggestionSet,
    })
    expect(readOutput()).toEqual({
      initial: {
        body: source,
        renderedPreviewCount: 1,
        sourceVisible: false,
      },
      afterSuggestion: {
        body: source,
        renderedPreviewCount: 0,
        sourceVisible: true,
        suggestionMarker: '提案',
      },
      suggestionSet: true,
    })
  })
})
