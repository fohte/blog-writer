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
const imageUrl = 'https://assets.example.test/images/sample.webp?w=640&h=360'
const imageSource = `![Sample](${imageUrl})`
const localImageSource =
  "![Sample](data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1'%20height='1'%3E%3C/svg%3E)"
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

function hasEditorLine(content: HTMLElement | null, line: string) {
  return [...(content?.querySelectorAll<HTMLElement>('.cm-line') ?? [])].some(
    (editorLine) => editorLine.textContent === line,
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

function dispatchFilePaste(content: HTMLElement | null, file: File): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: fileTransfer(file),
  })
  content?.dispatchEvent(event)
  return event
}

function dispatchFileDrop(content: HTMLElement | null, file: File): DragEvent {
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
  it('does not add empty editor lines around rendered block previews', () => {
    const source = [
      'Before',
      '',
      tableSource,
      '',
      localImageSource,
      '',
      'After',
    ].join('\n')
    const { body, content } = mountMarkdownEditor(source)

    const readOutput = () => {
      const lines = [
        ...(content?.querySelectorAll<HTMLElement>('.cm-line') ?? []),
      ].map((line) => line.textContent)
      return {
        body: body.toJSON(),
        emptyLineCount: lines.filter((line) => line === '').length,
        lineCount: lines.length,
        previewCount: content?.querySelectorAll('table, figure').length ?? 0,
        renderedRowCount:
          lines.length +
          (content?.querySelectorAll('table, figure').length ?? 0),
      }
    }
    expect(readOutput()).toEqual({
      body: source,
      emptyLineCount: 3,
      lineCount: 5,
      previewCount: 2,
      renderedRowCount: 7,
    })
  })

  it('draws a GFM table outside the block and restores its exact source inside', () => {
    const source = `before\n\n${tableSource}\n\nafter`
    const { body, content } = mountMarkdownEditor(source)
    const view = content ? EditorView.findFromDOM(content) : null
    const read = () => ({
      body: body.toJSON(),
      alignment: readTableAlignments(content),
      rows: readTableRows(content),
      sourceVisible: hasEditorLine(content, tableSource.split('\n')[0] ?? ''),
    })
    const outside = read()
    const cursor = source.indexOf('Tables') + 2
    view?.dispatch({ selection: { anchor: cursor } })
    const inside = read()
    const readOutput = () => ({ outside, inside })

    expect(readOutput()).toEqual({
      outside: {
        body: source,
        alignment: ['left', 'right'],
        rows: [
          ['Feature', 'Offline'],
          ['Tables', 'Yes'],
        ],
        sourceVisible: false,
      },
      inside: {
        body: source,
        alignment: [],
        rows: [],
        sourceVisible: true,
      },
    })
  })

  it('renders inline GFM syntax in table cells', () => {
    const table = [
      '| Feature | Guide | Code |',
      '| --- | --- | --- |',
      '| **Bold** | [site](https://assets.example.test/guide?w=320&h=200) | `code` |',
      '| *Italic* | ~~Old~~ | ![Sample](https://assets.example.test/images/sample.webp?w=20&h=10) |',
    ].join('\n')
    const source = `before\n\n${table}\n\nafter`
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
    const source = `before\n\n${imageSource}\n\nafter`
    const { body, content } = mountMarkdownEditor(source)
    const view = content ? EditorView.findFromDOM(content) : null
    const read = () => ({
      body: body.toJSON(),
      previewCount: content?.querySelectorAll('figure').length ?? 0,
      sourceVisible: hasEditorLine(content, imageSource),
    })
    const outside = read()
    const viewPosition = source.indexOf('sample') + 2
    view?.dispatch({ selection: { anchor: viewPosition } })
    const inside = read()
    const readOutput = () => ({ outside, inside })

    expect(readOutput()).toEqual({
      outside: {
        body: source,
        previewCount: 1,
        sourceVisible: false,
      },
      inside: {
        body: source,
        previewCount: 1,
        sourceVisible: true,
      },
    })
  })

  it('shows the original image Markdown when the image cannot load', () => {
    const source = `before\n\n${imageSource}\n\nafter`
    const { body, content } = mountMarkdownEditor(source)
    content?.querySelector('figure img')?.dispatchEvent(new Event('error'))

    const readOutput = () => ({
      body: body.toJSON(),
      fallback: content?.querySelector('figure code')?.textContent ?? null,
    })
    expect(readOutput()).toEqual({ body: source, fallback: imageSource })
  })

  it('loads Mermaid only for a visible diagram and leaves source visible while editing', async () => {
    const source = `before\n\n${mermaidSource}\n\nafter`
    const { body, content } = mountMarkdownEditor(source)
    const view = content ? EditorView.findFromDOM(content) : null
    await act(async () => {
      await vi.waitUntil(() => content?.querySelector('svg') !== null)
    })
    const outside = {
      body: body.toJSON(),
      sourceVisible: hasEditorLine(content, '```mermaid'),
      diagramCount: content?.querySelectorAll('svg').length ?? 0,
    }
    const cursor = source.indexOf('Draft') + 2
    await act(async () => {
      view?.dispatch({ selection: { anchor: cursor } })
      await vi.waitUntil(() => content?.querySelector('svg') !== null)
    })
    const inside = {
      body: body.toJSON(),
      sourceVisible: hasEditorLine(content, '```mermaid'),
      diagramCount: content?.querySelectorAll('svg').length ?? 0,
    }
    const readOutput = () => ({ outside, inside })

    expect(readOutput()).toEqual({
      outside: {
        body: source,
        sourceVisible: false,
        diagramCount: 1,
      },
      inside: {
        body: source,
        sourceVisible: true,
        diagramCount: 1,
      },
    })
  })

  it('shows the Mermaid source and parser error when the diagram is invalid', async () => {
    const diagramSource = '```mermaid\ngraph LR\n  Draft -->\n```'
    const source = `before\n\n${diagramSource}\n\nafter`
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
      sourceVisible: hasEditorLine(content, '```mermaid'),
    })
    expect(readOutput()).toEqual({
      body: source,
      hasError: true,
      sourceInPreview: 'graph LR\n  Draft -->',
      sourceVisible: false,
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
    const posAtCoords = vi
      .spyOn(EditorView.prototype, 'posAtCoords')
      .mockReturnValue(5)
    try {
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
    } finally {
      posAtCoords.mockRestore()
    }
  })

  it.each([
    {
      method: 'paste',
      outcome: 'falls through',
      expectedBody: 'A research sentence.',
    },
    {
      method: 'drop',
      outcome: 'inserts plain text',
      expectedBody: 'A ressource textearch sentence.',
    },
  ])(
    'does not upload a non-image file on $method and $outcome',
    async ({ method, expectedBody }) => {
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
        undefined,
        { uploadArticleImage: uploader, initialSelection: { anchor: 5 } },
      )
      const posAtCoords = vi
        .spyOn(EditorView.prototype, 'posAtCoords')
        .mockReturnValue(5)
      try {
        const file = new File(['source text'], 'source.txt', {
          type: 'text/plain',
        })
        await act(async () => {
          if (method === 'paste') dispatchFilePaste(content, file)
          else dispatchFileDrop(content, file)
          await new Promise((resolve) => setTimeout(resolve, 0))
        })
        await vi.waitUntil(() => body.toJSON() === expectedBody)

        const readOutput = () => ({
          body: body.toJSON(),
          uploadedFiles,
        })
        expect(readOutput()).toEqual({
          body: expectedBody,
          uploadedFiles: [],
        })
      } finally {
        posAtCoords.mockRestore()
      }
    },
  )

  it.each([
    { method: 'paste', outcome: 'succeeds', succeeds: true },
    { method: 'paste', outcome: 'fails', succeeds: false },
    { method: 'drop', outcome: 'succeeds', succeeds: true },
    { method: 'drop', outcome: 'fails', succeeds: false },
  ])('$method $outcome', async ({ method, succeeds }) => {
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
          ? dispatchFilePaste(content, file)
          : dispatchFileDrop(content, file)
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
