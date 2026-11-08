import { EditorView } from '@codemirror/view'
import { errAsync, okAsync } from 'neverthrow'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'
import { DomWidget } from '#editor/dom-widget'
import { evidenceDrop } from '#editor/evidence-drop'
import type { ArticleImageUploader } from '#editor/image-upload'

const tableSource = [
  '| Feature | Offline |',
  '| :--- | ---: |',
  '| Tables | Yes |',
].join('\n')
const imageSource =
  '![Sample](https://assets.example.test/images/sample.webp?w=640&h=360)'
const mermaidSource = '```mermaid\ngraph LR\n  Draft --> Preview\n```'

function readTableRows(content: HTMLElement | null) {
  return [...(content?.querySelectorAll('table tr') ?? [])].map((row) =>
    [...row.querySelectorAll('th, td')].map((cell) => cell.textContent),
  )
}

function readTableAlignments(content: HTMLElement | null) {
  return [...(content?.querySelectorAll('table thead th') ?? [])].map(
    (cell) =>
      ['left', 'center', 'right'].find((alignment) =>
        cell.classList.contains(`text-${alignment}`),
      ) ?? null,
  )
}

function imageFile(): File {
  return new File(['image data'], 'sample.png', { type: 'image/png' })
}

function fileTransfer(file: File): DataTransfer {
  const transfer = new DataTransfer()
  transfer.items.add(file)
  return transfer
}

function dispatchImagePaste(content: HTMLElement | null, file: File): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: fileTransfer(file),
  })
  content?.dispatchEvent(event)
  return event
}

function dispatchImageDrop(content: HTMLElement | null, file: File): DragEvent {
  const view = content ? EditorView.findFromDOM(content) : null
  const coords = view?.coordsAtPos(0)
  const event = new DragEvent('drop', {
    bubbles: true,
    cancelable: true,
    dataTransfer: fileTransfer(file),
    clientX: (coords?.left ?? 0) + 1,
    clientY: (coords?.top ?? 0) + 1,
  })
  content?.dispatchEvent(event)
  return event
}

describe('Markdown block previews', () => {
  it('draws a GFM table outside the block and restores its exact source inside', () => {
    const { body, content } = mountMarkdownEditor(tableSource)
    const view = content ? EditorView.findFromDOM(content) : null
    const read = () => ({
      body: body.toJSON(),
      alignment: readTableAlignments(content),
      rows: readTableRows(content),
      sourceVisible:
        content?.textContent.includes('| Feature | Offline |') ?? false,
    })
    const outside = read()
    const cursor = tableSource.indexOf('Tables') + 2
    view?.dispatch({ selection: { anchor: cursor } })
    const inside = read()
    const readOutput = () => ({ outside, inside })

    expect(readOutput()).toEqual({
      outside: {
        body: tableSource,
        alignment: ['left', 'right'],
        rows: [
          ['Feature', 'Offline'],
          ['Tables', 'Yes'],
        ],
        sourceVisible: false,
      },
      inside: {
        body: tableSource,
        alignment: [],
        rows: [],
        sourceVisible: true,
      },
    })
  })

  it('renders inline GFM syntax in table cells', () => {
    const source = [
      '| Feature | Guide | Code |',
      '| --- | --- | --- |',
      '| **Bold** | [site](https://assets.example.test/guide?w=320&h=200) | `code` |',
      '| *Italic* | ~~Old~~ | ![Sample](https://assets.example.test/images/sample.webp?w=20&h=10) |',
    ].join('\n')
    const { body, content } = mountMarkdownEditor(source)

    const readOutput = () => ({
      body: body.toJSON(),
      cells: [...(content?.querySelectorAll('tbody td') ?? [])].map((cell) => ({
        alt: cell.querySelector('img')?.getAttribute('alt') ?? null,
        href: cell.querySelector('a')?.getAttribute('href') ?? null,
        tags: [...cell.children].map(({ tagName }) => tagName),
        text: cell.textContent,
        src: cell.querySelector('img')?.getAttribute('src') ?? null,
      })),
    })

    expect(readOutput()).toEqual({
      body: source,
      cells: [
        {
          alt: null,
          href: null,
          tags: ['STRONG'],
          text: 'Bold',
          src: null,
        },
        {
          alt: null,
          href: 'https://assets.example.test/guide?w=320&h=200',
          tags: ['A'],
          text: 'site',
          src: null,
        },
        {
          alt: null,
          href: null,
          tags: ['CODE'],
          text: 'code',
          src: null,
        },
        {
          alt: null,
          href: null,
          tags: ['EM'],
          text: 'Italic',
          src: null,
        },
        {
          alt: null,
          href: null,
          tags: ['DEL'],
          text: 'Old',
          src: null,
        },
        {
          alt: 'Sample',
          href: null,
          tags: ['IMG'],
          text: '',
          src: 'https://assets.example.test/images/sample.webp?w=20&h=10',
        },
      ],
    })
  })

  it('keeps block widgets while a composition is changing the document', () => {
    const source = `before\n\n${tableSource}\n\nafter`
    const { body, content } = mountMarkdownEditor(source)
    const view = content ? EditorView.findFromDOM(content) : null
    const toDOM = vi.spyOn(DomWidget.prototype, 'toDOM')
    const initialWidgetCount = toDOM.mock.calls.length

    act(() => {
      content?.dispatchEvent(
        new CompositionEvent('compositionstart', { bubbles: true }),
      )
      view?.dispatch({ changes: { from: 0, insert: 'changed ' } })
    })

    const readOutput = () => ({
      body: body.toJSON(),
      widgetRecreated: toDOM.mock.calls.length !== initialWidgetCount,
    })
    expect(readOutput()).toEqual({
      body: `changed ${source}`,
      widgetRecreated: false,
    })
    toDOM.mockRestore()
  })

  it('draws an image outside its source and keeps the preview below editable source', () => {
    const { body, content } = mountMarkdownEditor(imageSource)
    const view = content ? EditorView.findFromDOM(content) : null
    const read = () => ({
      body: body.toJSON(),
      imageSrc: content?.querySelector('img')?.getAttribute('src') ?? null,
      sourceVisible: content?.textContent.includes(imageSource) ?? false,
    })
    const outside = read()
    const viewPosition = imageSource.indexOf('sample') + 2
    view?.dispatch({ selection: { anchor: viewPosition } })
    const inside = read()
    const readOutput = () => ({ outside, inside })

    expect(readOutput()).toEqual({
      outside: {
        body: imageSource,
        imageSrc: 'https://assets.example.test/images/sample.webp?w=640&h=360',
        sourceVisible: false,
      },
      inside: {
        body: imageSource,
        imageSrc: 'https://assets.example.test/images/sample.webp?w=640&h=360',
        sourceVisible: true,
      },
    })
  })

  it('shows the original image Markdown when the image cannot load', () => {
    const { body, content } = mountMarkdownEditor(imageSource)
    content?.querySelector('img')?.dispatchEvent(new Event('error'))

    const readOutput = () => ({
      body: body.toJSON(),
      fallback: content?.textContent ?? null,
    })
    expect(readOutput()).toEqual({ body: imageSource, fallback: imageSource })
  })

  it('loads Mermaid only for a visible diagram and leaves source visible while editing', async () => {
    const { body, content } = mountMarkdownEditor(mermaidSource)
    const view = content ? EditorView.findFromDOM(content) : null
    await act(async () => {
      await vi.waitUntil(() => content?.querySelector('svg') !== null)
    })
    const outside = {
      body: body.toJSON(),
      sourceVisible: content?.textContent.includes(mermaidSource) ?? false,
      diagramCount: content?.querySelectorAll('svg').length ?? 0,
    }
    const cursor = mermaidSource.indexOf('Draft') + 2
    view?.dispatch({ selection: { anchor: cursor } })
    const inside = {
      body: body.toJSON(),
      sourceVisible:
        content?.textContent.includes('Draft --> Preview') ?? false,
      diagramCount: content?.querySelectorAll('svg').length ?? 0,
    }
    const readOutput = () => ({ outside, inside })

    expect(readOutput()).toEqual({
      outside: {
        body: mermaidSource,
        sourceVisible: false,
        diagramCount: 1,
      },
      inside: {
        body: mermaidSource,
        sourceVisible: true,
        diagramCount: 1,
      },
    })
  })

  it('shows the Mermaid source and parser error when the diagram is invalid', async () => {
    const source = '```mermaid\ngraph LR\n  Draft -->\n```'
    const { body, content } = mountMarkdownEditor(source)
    await act(async () => {
      await vi.waitUntil(
        () => content?.querySelector('[role="alert"]') !== null,
      )
    })

    const readOutput = () => ({
      body: body.toJSON(),
      hasError: content?.querySelector('[role="alert"]') !== null,
      sourceInPreview:
        content?.querySelector('figure pre code')?.textContent ?? null,
      sourceVisible: content?.textContent.includes('Draft -->') ?? false,
    })
    expect(readOutput()).toEqual({
      body: source,
      hasError: true,
      sourceInPreview: 'graph LR\n  Draft -->',
      sourceVisible: true,
    })
  })
})

describe('image paste and drop uploads', () => {
  it('leaves non-image file drops to CodeMirror with an image uploader configured', async () => {
    const uploadedFiles: string[] = []
    const uploader: ArticleImageUploader = (file) => {
      uploadedFiles.push(file.name)
      return okAsync({
        src: 'https://assets.example.test/images/uploaded.webp?w=320&h=200',
      })
    }
    const { body, content } = mountMarkdownEditor(
      'A research sentence.',
      [],
      (doc) => [
        evidenceDrop(
          doc,
          'article-example',
          () => undefined,
          () => undefined,
        ),
      ],
      { uploadArticleImage: uploader },
    )
    vi.spyOn(EditorView.prototype, 'posAtCoords').mockReturnValue(5)
    const transfer = new DataTransfer()
    transfer.items.add(
      new File(['source text'], 'source.txt', { type: 'text/plain' }),
    )
    const drop = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    })
    content?.dispatchEvent(drop)

    await vi.waitUntil(
      () => body.toJSON() === 'A ressource textearch sentence.',
    )

    const readOutput = () => ({
      body: body.toJSON(),
      defaultPrevented: drop.defaultPrevented,
      uploadedFiles,
    })
    expect(readOutput()).toEqual({
      body: 'A ressource textearch sentence.',
      defaultPrevented: true,
      uploadedFiles: [],
    })
  })

  it.each([
    { name: 'paste succeeds', method: 'paste', succeeds: true },
    { name: 'paste displays a failure', method: 'paste', succeeds: false },
    { name: 'drop succeeds', method: 'drop', succeeds: true },
    { name: 'drop displays a failure', method: 'drop', succeeds: false },
  ])('$name', async ({ method, succeeds }) => {
    const uploadedFiles: string[] = []
    const uploader: ArticleImageUploader = (file) => {
      uploadedFiles.push(file.name)
      return succeeds
        ? okAsync({
            src: 'https://assets.example.test/images/uploaded.webp?w=320&h=200',
          })
        : errAsync(new Error('Upload failed'))
    }
    const { body, content, host } = mountMarkdownEditor('', [], undefined, {
      uploadArticleImage: uploader,
    })
    const file = imageFile()
    let event: Event | undefined
    await act(async () => {
      event =
        method === 'paste'
          ? dispatchImagePaste(content, file)
          : dispatchImageDrop(content, file)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitUntil(() =>
      succeeds
        ? body.toJSON().length > 0
        : host.querySelector('[role="alert"]') !== null,
    )

    const readOutput = () => ({
      body: body.toJSON(),
      defaultPrevented: event?.defaultPrevented ?? false,
      error: host.querySelector('[role="alert"]')?.textContent ?? null,
      uploadedFiles,
    })
    expect(readOutput()).toEqual({
      body: succeeds
        ? '![](https://assets.example.test/images/uploaded.webp?w=320&h=200)'
        : '',
      defaultPrevented: true,
      error: succeeds ? null : 'Upload failed',
      uploadedFiles: ['sample.png'],
    })
  })
})
