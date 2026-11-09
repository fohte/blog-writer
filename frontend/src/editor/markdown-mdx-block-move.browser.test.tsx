import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'

const imageSource =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1'%20height='1'%3E%3C/svg%3E"
const firstImage = `![First](${imageSource})`
const secondImage = `![Second](${imageSource})`
const imageGrid = `<ImageGrid>
  ${firstImage}
${secondImage}
</ImageGrid>`
const firstCard = '<CardLink href="https://docs.example.test/first" />'
const secondCard = '<CardLink href="https://docs.example.test/second" />'

describe('MDX component block movement', () => {
  it('moves the complete ImageGrid as one block', async () => {
    const source = `Before.

${imageGrid}

${firstCard}
${secondCard}

After.`
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      initialSelection: { anchor: source.length },
      showMoveHandles: true,
    })
    if (!content) throw new Error('The Markdown editor did not mount')
    const gridHandleIndex = await vi.waitUntil(() => {
      const grid = content.querySelector('.cm-markdown-block-widget .grid')
      const handles = [
        ...content.querySelectorAll<HTMLButtonElement>('.cm-block-drag-handle'),
      ]
      const index = handles.findIndex(
        (handle) =>
          handle
            .closest('.cm-markdown-block-widget')
            ?.contains(grid ?? null) === true,
      )
      return index >= 0 ? index : undefined
    })

    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: 'Move block' }).nth(gridHandleIndex),
      )
      await userEvent.click(page.getByRole('menuitem', { name: 'Move up' }))
    })

    const readOutput = () => ({
      body: body.toJSON(),
      cardCount: content.querySelectorAll('.cm-markdown-block-widget a').length,
      gridCount: content.querySelectorAll('.cm-markdown-block-widget .grid')
        .length,
      imageSources: [
        ...content.querySelectorAll('.cm-markdown-block-widget .grid img'),
      ].map((image) => image.getAttribute('src')),
    })
    expect(readOutput()).toEqual({
      body: `${imageGrid}\n\nBefore.\n\n${firstCard}\n${secondCard}\n\nAfter.`,
      cardCount: 2,
      gridCount: 1,
      imageSources: [imageSource, imageSource],
    })
  })

  it('moves an adjacent CardLink independently', async () => {
    const source = `Before.

${firstCard}
${secondCard}

After.`
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      initialSelection: { anchor: source.length },
      showMoveHandles: true,
    })
    if (!content) throw new Error('The Markdown editor did not mount')
    const cardWidgets = await vi.waitUntil(() => {
      const widgets = [
        ...content.querySelectorAll<HTMLElement>('.cm-markdown-block-widget'),
      ].filter((widget) => widget.querySelector('a'))
      return widgets.length === 2 ? widgets : undefined
    })
    const secondWidget = cardWidgets.find(
      (widget) =>
        widget.querySelector('a')?.getAttribute('href') ===
        'https://docs.example.test/second',
    )
    const secondHandle = secondWidget?.querySelector<HTMLButtonElement>(
      '.cm-block-drag-handle',
    )
    if (!secondHandle) throw new Error('The second CardLink handle is missing')

    await act(async () => {
      await userEvent.click(secondHandle)
      await userEvent.click(page.getByRole('menuitem', { name: 'Move up' }))
    })

    const readOutput = () => ({
      body: body.toJSON(),
      cardHrefs: [
        ...content.querySelectorAll<HTMLAnchorElement>(
          '.cm-markdown-block-widget a',
        ),
      ].map((card) => card.getAttribute('href')),
      cardHandleCounts: [
        ...content.querySelectorAll<HTMLElement>('.cm-markdown-block-widget'),
      ]
        .filter((widget) => widget.querySelector('a'))
        .map(
          (widget) => widget.querySelectorAll('.cm-block-drag-handle').length,
        ),
    })
    expect(readOutput()).toEqual({
      body: `Before.\n\n${secondCard}\n\n${firstCard}\nAfter.`,
      cardHrefs: [
        'https://docs.example.test/second',
        'https://docs.example.test/first',
      ],
      cardHandleCounts: [1, 1],
    })
  })
})
