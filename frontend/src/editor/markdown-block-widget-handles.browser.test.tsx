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
