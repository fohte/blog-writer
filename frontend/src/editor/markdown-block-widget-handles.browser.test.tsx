import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'

import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'
import { createSuggestionLayer } from '#editor/suggestion-layer'
import { blockStarts } from '#outline/block-ranges'

const tableSource = [
  '| Feature | Offline |',
  '| --- | --- |',
  '| Tables | Yes |',
].join('\n')
const imageSource =
  "![Sample](data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1'%20height='1'%3E%3C/svg%3E)"
const mermaidSource = '```mermaid\ngraph LR\n  Draft --> Preview\n```'

describe('Markdown block widget handles', () => {
  it('reuses block starts for editor states that share a document', () => {
    const source = Array.from(
      { length: 199 },
      (_, index) => `Paragraph ${String(index)}.`,
    ).join('\n\n')
    const state = EditorState.create({ doc: source })
    const selectionState = state.update({ selection: { anchor: 1 } }).state
    const changedState = state.update({
      changes: { from: 0, insert: 'A new paragraph.\n\n' },
    }).state
    const starts = blockStarts(state)
    const selectionStarts = blockStarts(selectionState)
    const changedStarts = blockStarts(changedState)

    const readOutput = () => ({
      changedDocumentHasNewStarts: selectionStarts !== changedStarts,
      changedDocumentStartCount: changedStarts.length,
      sameDocumentStartCount: starts.length,
      sameDocumentSharesStarts: starts === selectionStarts,
    })
    expect(readOutput()).toEqual({
      changedDocumentHasNewStarts: true,
      changedDocumentStartCount: 200,
      sameDocumentStartCount: 199,
      sameDocumentSharesStarts: true,
    })
  })

  it.each([
    {
      scenario: 'a paragraph followed by an image',
      source: `Before paragraph.\n${imageSource}\n\nAfter paragraph.`,
      expectedOwners: ['inline', 'inline'],
      expectedPreviewCount: 1,
    },
    {
      scenario: 'two adjacent images',
      source: `![First](data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1'%20height='1'%3E%3C/svg%3E)\n![Second](data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1'%20height='1'%3E%3C/svg%3E)\n\nAfter paragraph.`,
      expectedOwners: ['widget', 'inline'],
      expectedPreviewCount: 2,
    },
    {
      scenario: 'a table inside a blockquote',
      source: `> | Feature | Offline |\n> | --- | --- |\n> | Tables | Yes |\n\nAfter paragraph.`,
      expectedOwners: ['inline', 'inline'],
      expectedPreviewCount: 1,
    },
    {
      scenario: 'a Mermaid diagram inside a list item',
      source: `- A diagram\n  ${mermaidSource.replaceAll('\n', '\n  ')}\n\nAfter paragraph.`,
      expectedOwners: ['inline', 'inline'],
      expectedPreviewCount: 1,
    },
  ])(
    'shows one move handle for each top-level block in $scenario',
    async ({ source, expectedOwners, expectedPreviewCount }) => {
      const { body, content, host } = mountMarkdownEditor(
        source,
        [],
        undefined,
        {
          initialSelection: {
            anchor: source.indexOf('After paragraph.') + 1,
          },
          showMoveHandles: true,
        },
      )
      const view = content ? EditorView.findFromDOM(content) : null
      if (!content || !view)
        throw new Error('The Markdown editor did not mount')
      await act(async () => {
        await vi.waitUntil(
          () =>
            content.querySelectorAll('table, figure').length ===
            expectedPreviewCount,
        )
      })

      const readOutput = () => ({
        body: body.toJSON(),
        blockCount: blockStarts(view.state).length,
        handleOwners: [
          ...host.querySelectorAll<HTMLButtonElement>('.cm-block-drag-handle'),
        ].map((handle) =>
          handle.closest('.cm-markdown-block-widget') ? 'widget' : 'inline',
        ),
        previewCount: content.querySelectorAll('table, figure').length,
      })
      expect(readOutput()).toEqual({
        body: source,
        blockCount: 2,
        handleOwners: expectedOwners,
        previewCount: expectedPreviewCount,
      })
    },
  )

  it('shows one move handle for each CardLink and the whole ImageGrid', async () => {
    const firstUrl = 'https://docs.example.test/first'
    const secondUrl = 'https://docs.example.test/second'
    const firstImage =
      '![First](data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%271%27%20height=%271%27%3E%3C/svg%3E)'
    const secondImage =
      '![Second](data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%271%27%20height=%271%27%3E%3C/svg%3E)'
    const source = [
      'Before paragraph.',
      '',
      `<CardLink href="${firstUrl}" />`,
      `<CardLink href="${secondUrl}" />`,
      '<ImageGrid>',
      `  ${firstImage}`,
      secondImage,
      '</ImageGrid>',
      '',
      'After paragraph.',
    ].join('\n')
    const { body, content, host } = mountMarkdownEditor(source, [], undefined, {
      initialSelection: { anchor: source.indexOf('After paragraph.') + 1 },
      showMoveHandles: true,
    })
    const view = content ? EditorView.findFromDOM(content) : null
    if (!content || !view) throw new Error('The Markdown editor did not mount')
    await act(async () => {
      await vi.waitUntil(
        () =>
          content.querySelectorAll('.cm-markdown-block-widget').length === 3,
      )
    })

    const readOutput = () => ({
      body: body.toJSON(),
      blockCount: blockStarts(view.state).length,
      handleOwners: [
        ...host.querySelectorAll<HTMLButtonElement>('.cm-block-drag-handle'),
      ].map((handle) =>
        handle.closest('.cm-markdown-block-widget') ? 'widget' : 'inline',
      ),
      widgetHandles: [
        ...content.querySelectorAll<HTMLElement>('.cm-markdown-block-widget'),
      ].map(
        (widget) =>
          widget.querySelectorAll(
            '.cm-markdown-block-widget-handle .cm-block-drag-handle',
          ).length,
      ),
      widgetLinks: [
        ...content.querySelectorAll<HTMLElement>('.cm-markdown-block-widget'),
      ].map(
        (widget) => widget.querySelector('a')?.getAttribute('href') ?? null,
      ),
    })
    expect(readOutput()).toEqual({
      body: source,
      blockCount: 5,
      handleOwners: ['inline', 'widget', 'widget', 'widget', 'inline'],
      widgetHandles: [1, 1, 1],
      widgetLinks: [firstUrl, secondUrl, null],
    })
  })

  it('shows a move handle for a CardLink directly after a paragraph', async () => {
    const href = 'https://docs.example.test/guide'
    const cardSource = `<CardLink href="${href}" />`
    const source = `A paragraph.\n${cardSource}\n\nAfter paragraph.`
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      initialSelection: { anchor: source.indexOf('After paragraph.') + 1 },
      showMoveHandles: true,
    })
    if (!content) throw new Error('The Markdown editor did not mount')
    await act(async () => {
      await vi.waitUntil(() => {
        const widgets = [
          ...content.querySelectorAll<HTMLElement>('.cm-markdown-block-widget'),
        ]
        return widgets.some(
          (widget) => widget.querySelector('a')?.getAttribute('href') === href,
        )
      })
    })
    const cardWidget = [
      ...content.querySelectorAll<HTMLElement>('.cm-markdown-block-widget'),
    ].find((widget) => widget.querySelector('a')?.getAttribute('href') === href)
    if (!cardWidget) throw new Error('The CardLink preview did not mount')

    const readOutput = () => ({
      body: body.toJSON(),
      cardHref: cardWidget.querySelector('a')?.getAttribute('href'),
      cardHandleCount: cardWidget.querySelectorAll(
        '.cm-markdown-block-widget-handle .cm-block-drag-handle',
      ).length,
    })
    expect(readOutput()).toEqual({
      body: source,
      cardHref: href,
      cardHandleCount: 1,
    })
  })

  it.each([1, 2, 3])(
    'shows one move handle for an image with %i leading spaces',
    async (indent) => {
      const source = `${' '.repeat(indent)}${imageSource}\n\nAfter paragraph.`
      const { body, content, host } = mountMarkdownEditor(
        source,
        [],
        undefined,
        {
          initialSelection: {
            anchor: source.indexOf('After paragraph.') + 1,
          },
          showMoveHandles: true,
        },
      )
      const view = content ? EditorView.findFromDOM(content) : null
      if (!content || !view)
        throw new Error('The Markdown editor did not mount')
      await act(async () => {
        await vi.waitUntil(() => content.querySelector('figure') !== null)
      })

      const readOutput = () => ({
        body: body.toJSON(),
        blockCount: blockStarts(view.state).length,
        handleOwners: [
          ...host.querySelectorAll<HTMLButtonElement>('.cm-block-drag-handle'),
        ].map((handle) =>
          handle.closest('.cm-markdown-block-widget') ? 'widget' : 'inline',
        ),
        previewCount: content.querySelectorAll('figure').length,
      })
      expect(readOutput()).toEqual({
        body: source,
        blockCount: 2,
        handleOwners: ['widget', 'inline'],
        previewCount: 1,
      })
    },
  )

  it('updates the image move handle when an equal-length edit changes block ownership', () => {
    const source = `x\n${imageSource}\n\nAfter paragraph.`
    const replaced = `#\n${imageSource}\n\nAfter paragraph.`
    const { body, content, host } = mountMarkdownEditor(source, [], undefined, {
      initialSelection: {
        anchor: source.indexOf('After paragraph.') + 1,
      },
      showMoveHandles: true,
    })
    const view = content ? EditorView.findFromDOM(content) : null
    if (!content || !view) throw new Error('The Markdown editor did not mount')

    const readOutput = () => ({
      body: body.toJSON(),
      previewCount: content.querySelectorAll('figure').length,
      widgetHandleCount: host.querySelectorAll(
        '.cm-markdown-block-widget-handle',
      ).length,
    })
    const before = readOutput()
    act(() => {
      view.dispatch({ changes: { from: 0, to: 1, insert: '#' } })
    })
    const afterHeading = readOutput()
    act(() => {
      view.dispatch({ changes: { from: 0, to: 1, insert: 'x' } })
    })

    const readTransitions = () => ({
      before,
      afterHeading,
      restored: readOutput(),
    })
    const expectedTransitions = {
      before: {
        body: source,
        previewCount: 1,
        widgetHandleCount: 0,
      },
      afterHeading: {
        body: replaced,
        previewCount: 1,
        widgetHandleCount: 1,
      },
      restored: {
        body: source,
        previewCount: 1,
        widgetHandleCount: 0,
      },
    }
    expect(readTransitions()).toEqual(expectedTransitions)
  })

  it('opens the rendered block menu on Enter without editing the body', async () => {
    const source = `Before paragraph.\n\n${tableSource}\n\nAfter paragraph.`
    const { body, content, host } = mountMarkdownEditor(source, [], undefined, {
      initialSelection: { anchor: 1 },
      showMoveHandles: true,
    })
    const handle = host.querySelector<HTMLButtonElement>(
      '.cm-markdown-block-widget-handle .cm-block-drag-handle',
    )
    if (!content || !handle)
      throw new Error('The rendered table handle did not mount')
    handle.focus()

    await act(async () => {
      await userEvent.keyboard('{Enter}')
    })

    const readOutput = () => ({
      body: body.toJSON(),
      menuItems: [
        ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      ].map((item) => item.textContent),
      previewCount: content.querySelectorAll('table').length,
    })
    expect(readOutput()).toEqual({
      body: source,
      menuItems: ['Move up', 'Move down'],
      previewCount: 1,
    })
  })

  it('does not send a paste from a focused widget handle to the editor', () => {
    const source = `top\n\n${tableSource}\n\nafter`
    const { body, content, host } = mountMarkdownEditor(source, [], undefined, {
      initialSelection: { anchor: 1 },
      showMoveHandles: true,
    })
    const handle = host.querySelector<HTMLButtonElement>(
      '.cm-markdown-block-widget-handle .cm-block-drag-handle',
    )
    if (!content || !handle)
      throw new Error('The rendered table handle did not mount')
    handle.focus()

    const event = new Event('paste', { bubbles: true, cancelable: true })
    const transfer = new DataTransfer()
    transfer.setData('text/plain', 'PASTED')
    Object.defineProperty(event, 'clipboardData', { value: transfer })
    act(() => {
      handle.dispatchEvent(event)
    })

    const readOutput = () => ({
      body: body.toJSON(),
      focusedHandle: document.activeElement === handle,
      previewCount: content.querySelectorAll('table').length,
    })
    expect(readOutput()).toEqual({
      body: source,
      focusedHandle: true,
      previewCount: 1,
    })
  })

  it('enters the Markdown source when a rendered block is clicked with handles enabled', async () => {
    const source = `Before paragraph.\n\n${tableSource}\n\nAfter paragraph.`
    const from = source.indexOf(tableSource)
    const to = from + tableSource.length
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      initialSelection: { anchor: 1 },
      showMoveHandles: true,
    })
    const view = content ? EditorView.findFromDOM(content) : null
    const cell = content?.querySelector('table td')
    if (!content || !view || !cell)
      throw new Error('The rendered table did not mount')

    await act(async () => {
      await userEvent.click(cell)
    })

    const readOutput = () => ({
      body: body.toJSON(),
      cursorInsideBlock:
        view.state.selection.main.head >= from &&
        view.state.selection.main.head <= to,
      renderedTableCount: content.querySelectorAll('table').length,
    })
    expect(readOutput()).toEqual({
      body: source,
      cursorInsideBlock: true,
      renderedTableCount: 0,
    })
  })

  it.each([
    {
      initial: `${mermaidSource}\n\nAfter paragraph.`,
      next: `- A diagram\n  ${mermaidSource.replaceAll('\n', '\n  ')}\n\nAfter paragraph.`,
      expectedWidgetHandleCount: 0,
    },
    {
      initial: `- A diagram\n  ${mermaidSource.replaceAll('\n', '\n  ')}\n\nAfter paragraph.`,
      next: `${mermaidSource}\n\nAfter paragraph.`,
      expectedWidgetHandleCount: 1,
    },
  ])(
    'updates the move handle when a Mermaid block changes top-level status',
    async ({ initial, next, expectedWidgetHandleCount }) => {
      const { body, content, doc, host } = mountMarkdownEditor(
        initial,
        [],
        undefined,
        {
          initialSelection: {
            anchor: initial.indexOf('After paragraph.') + 1,
          },
          showMoveHandles: true,
        },
      )
      const view = content ? EditorView.findFromDOM(content) : null
      if (!content || !view)
        throw new Error('The Markdown editor did not mount')

      await act(async () => {
        await vi.waitUntil(() => content.querySelector('figure') !== null)
      })

      act(() => {
        doc.transact(() => {
          body.delete(0, body.length)
          body.insert(0, next)
        })
        view.dispatch({
          selection: { anchor: next.indexOf('After paragraph.') + 1 },
        })
      })

      const readOutput = () => ({
        body: body.toJSON(),
        previewCount: content.querySelectorAll('.cm-markdown-block-widget')
          .length,
        widgetHandleCount: host.querySelectorAll(
          '.cm-markdown-block-widget-handle',
        ).length,
      })
      expect(readOutput()).toEqual({
        body: next,
        previewCount: 1,
        widgetHandleCount: expectedWidgetHandleCount,
      })
    },
  )

  it.each([
    { key: 'Backspace', altKey: false, withSuggestion: false },
    { key: 'Delete', altKey: false, withSuggestion: false },
    {
      key: 'Alt+ArrowDown',
      altKey: true,
      withSuggestion: false,
    },
    { key: 'Tab', altKey: false, withSuggestion: true },
  ])(
    'keeps $key on a rendered block handle out of the editor keymaps',
    ({ key, altKey, withSuggestion }) => {
      const source = `Before paragraph.\n\n${tableSource}\n\nAfter paragraph.`
      const suggestion = withSuggestion
        ? createSuggestionLayer({
            initialSuggestions: [
              {
                id: 'paragraph-suggestion',
                from: 0,
                to: 'Before paragraph.'.length,
                replacement: 'Revised paragraph.',
              },
            ],
          })
        : undefined
      const { body, content, host } = mountMarkdownEditor(
        source,
        suggestion ? [suggestion.extension] : [],
        undefined,
        { initialSelection: { anchor: 1 }, showMoveHandles: true },
      )
      const handle = host.querySelector<HTMLButtonElement>(
        '.cm-markdown-block-widget-handle .cm-block-drag-handle',
      )
      if (!content || !handle)
        throw new Error('The rendered table handle did not mount')
      handle.focus()

      act(() => {
        handle.dispatchEvent(
          new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: key === 'Alt+ArrowDown' ? 'ArrowDown' : key,
            altKey,
          }),
        )
      })

      const readOutput = () => ({
        body: body.toJSON(),
        previewCount: content.querySelectorAll('table').length,
      })
      expect(readOutput()).toEqual({ body: source, previewCount: 1 })
    },
  )
})
