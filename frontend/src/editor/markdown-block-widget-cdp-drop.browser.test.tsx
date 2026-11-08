import { okAsync } from 'neverthrow'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { cdp, commands } from 'vitest/browser'

import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'
import type { ArticleImageUploader } from '#editor/image-upload'

const tableSource = [
  '| Feature | Guide |',
  '| --- | --- |',
  '| Links | [Open](https://assets.example.test/guide) |',
].join('\n')
const plainTableSource = [
  '| Feature | Offline |',
  '| :--- | ---: |',
  '| Tables | Yes |',
].join('\n')
const localImageSource =
  "![Sample](data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='160'%20height='100'%3E%3C/svg%3E)"
const mermaidSource = '```mermaid\ngraph LR\n  Draft --> Preview\n```'
const uploadedImageUrl =
  'https://assets.example.test/images/uploaded.webp?w=320&h=200'
const uploadedImageMarkdown = `![](${uploadedImageUrl})`

declare module 'vitest/browser' {
  interface BrowserCommands {
    getWidgetDropFixturePaths: () => Promise<{ image: string; text: string }>
  }
}

const widgetDropCases = [
  {
    name: 'a table cell',
    source: `${tableSource}\n\nAfter paragraph.`,
    expectedBody: `${tableSource}\n\n${uploadedImageMarkdown}\n\nAfter paragraph.`,
    selector: 'table td',
    previewSelector: 'table',
    showMoveHandles: false,
  },
  {
    name: 'an image',
    source: `${localImageSource}\n\nAfter paragraph.`,
    expectedBody: `${localImageSource}\n\n${uploadedImageMarkdown}\n\nAfter paragraph.`,
    selector: 'figure img',
    previewSelector: 'figure img',
    showMoveHandles: false,
  },
  {
    name: 'an SVG diagram',
    source: `${mermaidSource}\n\nAfter paragraph.`,
    expectedBody: `${mermaidSource}\n\n${uploadedImageMarkdown}\n\nAfter paragraph.`,
    selector: 'svg',
    previewSelector: 'svg',
    showMoveHandles: false,
  },
  {
    name: 'a table link',
    source: `${tableSource}\n\nAfter paragraph.`,
    expectedBody: `${tableSource}\n\n${uploadedImageMarkdown}\n\nAfter paragraph.`,
    selector: 'table a',
    previewSelector: 'table a',
    showMoveHandles: false,
  },
  {
    name: 'a widget move handle',
    source: `${plainTableSource}\n\nAfter paragraph.`,
    expectedBody: `${plainTableSource}\n\n${uploadedImageMarkdown}\n\nAfter paragraph.`,
    selector: '.cm-markdown-block-widget-handle .cm-block-drag-handle',
    previewSelector: 'table',
    showMoveHandles: true,
  },
]

function viewportPoint(target: HTMLElement): { x: number; y: number } {
  const targetRect = target.getBoundingClientRect()
  const frameRect = window.frameElement?.getBoundingClientRect()
  return {
    x: Math.round(
      (frameRect?.left ?? 0) + targetRect.left + targetRect.width / 2,
    ),
    y: Math.round(
      (frameRect?.top ?? 0) + targetRect.top + targetRect.height / 2,
    ),
  }
}

async function dispatchFileDrop(target: HTMLElement, path: string) {
  const { x, y } = viewportPoint(target)
  const data = { dragOperationsMask: 1, files: [path], items: [] }
  const session = cdp()
  await session.send('Input.dispatchDragEvent', {
    data,
    type: 'dragEnter',
    x,
    y,
  })
  await session.send('Input.dispatchDragEvent', {
    data,
    type: 'dragOver',
    x,
    y,
  })
  await session.send('Input.dispatchDragEvent', {
    data,
    type: 'drop',
    x,
    y,
  })
}

function listenForFileDragEvents(host: HTMLElement) {
  const events: Array<{
    defaultPrevented: boolean
    files: Array<{ name: string; type: string }>
    inWidget: boolean
    type: string
  }> = []
  const record = (event: Event) => {
    const dataTransfer =
      event instanceof DragEvent ? event.dataTransfer : undefined
    const target = event.target
    events.push({
      defaultPrevented: event.defaultPrevented,
      files: [...(dataTransfer?.files ?? [])].map(({ name, type }) => ({
        name,
        type,
      })),
      inWidget:
        target instanceof Element &&
        target.closest('.cm-markdown-block-widget') !== null,
      type: event.type,
    })
  }
  host.addEventListener('dragover', record)
  host.addEventListener('drop', record)
  return {
    events,
    remove: () => {
      host.removeEventListener('dragover', record)
      host.removeEventListener('drop', record)
    },
  }
}

describe('Markdown block widget file drops through Chromium CDP', () => {
  it.each(widgetDropCases)(
    'uploads an image dropped on $name after the block source',
    async ({
      source,
      expectedBody,
      selector,
      previewSelector,
      showMoveHandles,
    }) => {
      const { image: imageFixturePath } =
        await commands.getWidgetDropFixturePaths()
      const uploadedFiles: string[] = []
      const uploader: ArticleImageUploader = (file) => {
        uploadedFiles.push(file.name)
        return okAsync({ src: uploadedImageUrl })
      }
      const { body, host } = mountMarkdownEditor(source, [], undefined, {
        uploadArticleImage: uploader,
        initialSelection: { anchor: source.length },
        showMoveHandles,
      })
      await act(async () => {
        await vi.waitUntil(() => host.querySelector(previewSelector) !== null)
      })
      const target = host.querySelector<HTMLElement>(selector)
      if (!target) throw new Error('The file drop target did not mount')
      target.scrollIntoView({ block: 'center', inline: 'center' })
      const recorded = listenForFileDragEvents(host)

      try {
        await act(async () => {
          await dispatchFileDrop(target, imageFixturePath)
          await new Promise((resolve) => setTimeout(resolve, 0))
        })

        const readOutput = () => ({
          body: body.toJSON(),
          events: recorded.events,
          uploadedFiles,
        })
        expect(readOutput()).toEqual({
          body: expectedBody,
          events: [
            {
              defaultPrevented: true,
              files: [],
              inWidget: true,
              type: 'dragover',
            },
            {
              defaultPrevented: true,
              files: [],
              inWidget: true,
              type: 'dragover',
            },
            {
              defaultPrevented: true,
              files: [{ name: 'drop-image.svg', type: 'image/svg+xml' }],
              inWidget: true,
              type: 'drop',
            },
          ],
          uploadedFiles: ['drop-image.svg'],
        })
      } finally {
        recorded.remove()
      }
    },
  )

  it('cancels a real image drop when no uploader is configured', async () => {
    const { image: imageFixturePath } =
      await commands.getWidgetDropFixturePaths()
    const source = `${plainTableSource}\n\nAfter paragraph.`
    const { body, host } = mountMarkdownEditor(source, [], undefined, {
      initialSelection: { anchor: source.length },
    })
    await act(async () => {
      await vi.waitUntil(() => host.querySelector('table td') !== null)
    })
    const target = host.querySelector<HTMLElement>('table td')
    if (!target) throw new Error('The table cell did not mount')
    target.scrollIntoView({ block: 'center', inline: 'center' })
    const recorded = listenForFileDragEvents(host)

    try {
      await act(async () => {
        await dispatchFileDrop(target, imageFixturePath)
      })

      const readOutput = () => ({
        body: body.toJSON(),
        events: recorded.events,
      })
      expect(readOutput()).toEqual({
        body: source,
        events: [
          {
            defaultPrevented: true,
            files: [],
            inWidget: true,
            type: 'dragover',
          },
          {
            defaultPrevented: true,
            files: [],
            inWidget: true,
            type: 'dragover',
          },
          {
            defaultPrevented: true,
            files: [{ name: 'drop-image.svg', type: 'image/svg+xml' }],
            inWidget: true,
            type: 'drop',
          },
        ],
      })
    } finally {
      recorded.remove()
    }
  })

  it('cancels a real non-image file drop on a widget control', async () => {
    const { text: textFixturePath } = await commands.getWidgetDropFixturePaths()
    const source = `${plainTableSource}\n\nAfter paragraph.`
    const uploadedFiles: string[] = []
    const uploader: ArticleImageUploader = (file) => {
      uploadedFiles.push(file.name)
      return okAsync({ src: uploadedImageUrl })
    }
    const { body, host } = mountMarkdownEditor(source, [], undefined, {
      uploadArticleImage: uploader,
      initialSelection: { anchor: source.length },
      showMoveHandles: true,
    })
    await act(async () => {
      await vi.waitUntil(
        () =>
          host.querySelector(
            '.cm-markdown-block-widget-handle .cm-block-drag-handle',
          ) !== null,
      )
    })
    const target = host.querySelector<HTMLElement>(
      '.cm-markdown-block-widget-handle .cm-block-drag-handle',
    )
    if (!target) throw new Error('The widget move handle did not mount')
    target.scrollIntoView({ block: 'center', inline: 'center' })
    const recorded = listenForFileDragEvents(host)

    try {
      await act(async () => {
        await dispatchFileDrop(target, textFixturePath)
      })

      const readOutput = () => ({
        body: body.toJSON(),
        events: recorded.events,
        uploadedFiles,
      })
      expect(readOutput()).toEqual({
        body: source,
        events: [
          {
            defaultPrevented: true,
            files: [],
            inWidget: true,
            type: 'dragover',
          },
          {
            defaultPrevented: true,
            files: [],
            inWidget: true,
            type: 'dragover',
          },
          {
            defaultPrevented: true,
            files: [{ name: 'drop-text.txt', type: 'text/plain' }],
            inWidget: true,
            type: 'drop',
          },
        ],
        uploadedFiles: [],
      })
    } finally {
      recorded.remove()
    }
  })
})
