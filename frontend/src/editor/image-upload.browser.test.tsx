import { EditorView } from '@codemirror/view'
import { okAsync } from 'neverthrow'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'
import type { ArticleImageUploader } from '#editor/image-upload'

const tableSource = [
  '| Feature | Offline |',
  '| --- | --- |',
  '| Tables | Yes |',
].join('\n')
const uploadedImageUrl =
  'https://assets.example.test/images/uploaded.webp?w=320&h=200'
const uploadedImageMarkdown = `![](${uploadedImageUrl})`
const sourceAfterBlock = 'After paragraph.'

function imageFile(): File {
  return new File(['image data'], 'sample.png', { type: 'image/png' })
}

function dispatchFileDrop(
  content: HTMLElement,
  target: HTMLElement,
): DragEvent {
  const view = EditorView.findFromDOM(content)
  const coords = view?.coordsAtPos(0)
  const transfer = new DataTransfer()
  transfer.items.add(imageFile())
  const event = new DragEvent('drop', {
    bubbles: true,
    cancelable: true,
    dataTransfer: transfer,
    clientX: (coords?.left ?? 0) + 1,
    clientY: (coords?.top ?? 0) + 1,
  })
  target.dispatchEvent(event)
  return event
}

function imageUploader(): ArticleImageUploader {
  return () => okAsync({ src: uploadedImageUrl })
}

async function waitForTable(content: HTMLElement): Promise<void> {
  await act(async () => {
    await vi.waitUntil(() => content.querySelector('table td') !== null)
  })
}

describe('image drops on rendered Markdown blocks', () => {
  it.each([
    { edit: 'the editor', method: 'local' },
    { edit: 'Y.Text', method: 'shared' },
  ])(
    'uses the current widget position after editing through $edit',
    async ({ method }) => {
      const source = `Heading\n\n${tableSource}\n\n${sourceAfterBlock}`
      const editedSource = `Longer Heading\n\n${tableSource}\n\n${sourceAfterBlock}`
      const expectedBody = `Longer Heading\n\n${tableSource}\n\n${uploadedImageMarkdown}\n\n${sourceAfterBlock}`
      const { body, content } = mountMarkdownEditor(source, [], undefined, {
        uploadArticleImage: imageUploader(),
        initialSelection: { anchor: source.length },
      })
      if (!content) throw new Error('The Markdown editor did not mount')
      const view = EditorView.findFromDOM(content)
      if (!view) throw new Error('The Markdown editor view did not mount')
      await waitForTable(content)

      await act(async () => {
        if (method === 'local')
          view.dispatch({ changes: { from: 0, insert: 'Longer ' } })
        else body.insert(0, 'Longer ')
        await vi.waitUntil(() => body.toJSON() === editedSource)
      })

      const target = content.querySelector<HTMLElement>('table td')
      if (!target) throw new Error('The table cell did not mount')
      await act(async () => {
        dispatchFileDrop(content, target)
        await vi.waitUntil(() => body.toJSON() !== editedSource)
      })

      expect(body.toJSON()).toEqual(expectedBody)
    },
  )

  it.each([
    {
      container: 'a blockquote',
      block: [
        '> Before the table.',
        '>',
        ...tableSource.split('\n').map((line) => `> ${line}`),
        '>',
        '> After the table.',
      ].join('\n'),
    },
    {
      container: 'a list',
      block: [
        '- Before the table.',
        '',
        ...tableSource.split('\n').map((line) => `  ${line}`),
        '',
        '- After the table.',
      ].join('\n'),
    },
  ])('inserts after the whole top-level $container', async ({ block }) => {
    const source = `${block}\n\n${sourceAfterBlock}`
    const expectedBody = `${block}\n\n${uploadedImageMarkdown}\n\n${sourceAfterBlock}`
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      uploadArticleImage: imageUploader(),
      initialSelection: { anchor: source.length },
    })
    if (!content) throw new Error('The Markdown editor did not mount')
    await waitForTable(content)
    const target = content.querySelector<HTMLElement>('table td')
    if (!target) throw new Error('The table cell did not mount')

    await act(async () => {
      dispatchFileDrop(content, target)
      await vi.waitUntil(() => body.toJSON() !== source)
    })

    expect(body.toJSON()).toEqual(expectedBody)
  })

  it('inserts after a long list when dropping on its table', async () => {
    const block = [
      '- Before the table.',
      '',
      ...tableSource.split('\n').map((line) => `  ${line}`),
      '',
      '- After the table.',
    ].join('\n')
    const continuedItems = Array.from(
      { length: 180 },
      (_, index) => `- Continued item ${index.toString().padStart(3, '0')}`,
    ).join('\n')
    const source = `${block}\n${continuedItems}\n\n${sourceAfterBlock}`
    const expectedBody = `${block}\n${continuedItems}\n\n${uploadedImageMarkdown}\n\n${sourceAfterBlock}`
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      uploadArticleImage: imageUploader(),
      initialSelection: { anchor: source.length },
    })
    if (!content) throw new Error('The Markdown editor did not mount')
    await waitForTable(content)
    const target = content.querySelector<HTMLElement>('table td')
    if (!target) throw new Error('The Markdown table did not mount')

    await act(async () => {
      dispatchFileDrop(content, target)
      await vi.waitUntil(() => body.toJSON() !== source)
    })

    expect(body.toJSON()).toEqual(expectedBody)
  })

  it('does not append blank lines after a block at the end of the document', async () => {
    const source = `${tableSource}\n`
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      uploadArticleImage: imageUploader(),
      initialSelection: { anchor: source.length },
    })
    if (!content) throw new Error('The Markdown editor did not mount')
    await waitForTable(content)
    const target = content.querySelector<HTMLElement>('table td')
    if (!target) throw new Error('The table cell did not mount')
    const expectedBody = `${tableSource}\n\n${uploadedImageMarkdown}\n`

    await act(async () => {
      dispatchFileDrop(content, target)
      await vi.waitUntil(() => body.toJSON() !== source)
    })

    expect(body.toJSON()).toEqual(expectedBody)
  })

  it('adds no blank lines when the source document is deleted during upload', async () => {
    const source = `${tableSource}\n\n${sourceAfterBlock}`
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      uploadArticleImage: imageUploader(),
      initialSelection: { anchor: source.length },
    })
    if (!content) throw new Error('The Markdown editor did not mount')
    await waitForTable(content)
    const target = content.querySelector<HTMLElement>('table td')
    if (!target) throw new Error('The table cell did not mount')

    await act(async () => {
      dispatchFileDrop(content, target)
      body.delete(0, body.length)
      await vi.waitUntil(() => body.toJSON().length > 0)
    })

    expect(body.toJSON()).toEqual(uploadedImageMarkdown)
  })
})
