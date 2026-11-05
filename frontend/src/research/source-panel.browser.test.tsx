import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import {
  addSource,
  listFindings,
  listSources,
  setFindings,
} from '#article/index'
import { SourcePanel } from '#research/source-panel'

let host: HTMLDivElement | undefined
let root: Root | undefined
let fetchMock: ReturnType<typeof sourceFetchMock>
let deleteStatus = 204

function mountSourcePanel(doc: Y.Doc) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root?.render(<SourcePanel articleId="article-a" doc={doc} />)
  })
}

function eventResponse(data: unknown): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `event: result\ndata: ${JSON.stringify({ event: 'result', data })}\n\n`,
        ),
      )
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

function getSourceId(body: BodyInit | null | undefined): string {
  if (typeof body !== 'string') return 'source-a'
  return body.match(/"id":"([^"]+)"/)?.[1] ?? 'source-a'
}

function sourceFetchMock() {
  return vi.fn((resource: RequestInfo | URL, init?: RequestInit) => {
    const url =
      resource instanceof Request
        ? resource.url
        : resource instanceof URL
          ? resource.href
          : resource
    const sourceId = url.match(/source-bodies\/([^/]+)/)?.[1] ?? 'source-a'
    if (url.endsWith('/url')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            source_id: sourceId,
            title: '資料のタイトル',
            final_url: 'https://data.example.invalid/report',
          }),
          { status: 200 },
        ),
      )
    }
    if (url.endsWith('/file')) {
      const form = init?.body
      if (!(form instanceof FormData))
        return Promise.resolve(new Response(null, { status: 400 }))
      const file = form.get('file')
      if (!(file instanceof File))
        return Promise.resolve(new Response(null, { status: 400 }))
      return Promise.resolve(
        new Response(
          JSON.stringify({
            source_id: sourceId,
            title: file.name.replace(/\.[^.]+$/, ''),
            file_name: file.name,
          }),
          { status: 200 },
        ),
      )
    }
    if (url === '/api/research/key-points') {
      const requestSourceId = getSourceId(init?.body)
      return Promise.resolve(
        eventResponse({
          sources: [
            {
              id: requestSourceId,
              summary: '資料から作った要約です。',
              key_points: [
                {
                  text: '利用者数が増加しました。',
                  quote: '利用者数は増加しました。',
                },
              ],
            },
          ],
        }),
      )
    }
    if (init?.method === 'PUT')
      return Promise.resolve(new Response(null, { status: 204 }))
    if (init?.method === 'DELETE') {
      return Promise.resolve(new Response(null, { status: deleteStatus }))
    }
    if (init?.method === 'GET' || init?.method === undefined) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            source_id: sourceId,
            article_id: 'article-a',
            body: '利用者数は増加しました。',
          }),
          { status: 200 },
        ),
      )
    }
    return Promise.resolve(new Response(null, { status: 204 }))
  })
}

async function settleUi(doc: Y.Doc) {
  await act(async () => {
    await vi.waitFor(() => {
      if (listSources(doc).length === 0)
        throw new Error('source is still importing')
    })
  })
  await act(async () => {
    await vi.waitFor(() => {
      if (host?.querySelector('[role="status"]'))
        throw new Error('source is still importing')
    })
  })
}

function readOutput(doc: Y.Doc) {
  return {
    sources: listSources(doc).map(({ checkedAt, ...source }) => ({
      ...source,
      id: 'generated-source',
      checkedAt: checkedAt === null ? null : 'normalized-date',
    })),
    findings: listFindings(doc).map(({ ...finding }) => ({
      ...finding,
      id: 'generated-finding',
      sourceId: 'generated-source',
    })),
    renderedTitle: host?.querySelector('[role="listitem"] button span')
      ?.textContent,
  }
}

function readFetchCalls() {
  return fetchMock.mock.calls.map(([resource, init]) => ({
    url:
      resource instanceof Request
        ? resource.url
        : resource instanceof URL
          ? resource.href
          : resource,
    method: init?.method ?? 'GET',
  }))
}

function readPasteOutput(event: ClipboardEvent, doc: Y.Doc) {
  return {
    pastePrevented: event.defaultPrevented,
    sources: listSources(doc),
    fetchCalls: readFetchCalls(),
  }
}

function readDeleteOutput(doc: Y.Doc) {
  return {
    sources: listSources(doc),
    findings: listFindings(doc),
    deleteCalls: readFetchCalls(),
  }
}

function readDeleteFailureOutput(doc: Y.Doc) {
  return {
    sources: listSources(doc),
    alert: host?.querySelector('[role="alert"]')?.textContent,
    deleteCalls: readFetchCalls(),
  }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  deleteStatus = 204
  fetchMock = sourceFetchMock()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  vi.unstubAllGlobals()
})

describe('SourcePanel', () => {
  it('registers a pasted URL and its summary and findings in the article document', async () => {
    const doc = new Y.Doc()
    mountSourcePanel(doc)
    const transfer = new DataTransfer()
    transfer.setData('text/plain', 'https://data.example.invalid/report')
    act(() => {
      host
        ?.querySelector('[aria-labelledby="source-panel-heading"]')
        ?.dispatchEvent(
          new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: transfer,
          }),
        )
    })
    await settleUi(doc)

    expect(readOutput(doc)).toEqual({
      sources: [
        {
          id: 'generated-source',
          kind: 'url',
          title: '資料のタイトル',
          url: 'https://data.example.invalid/report',
          fileName: null,
          checkedAt: 'normalized-date',
          status: 'ready',
          summary: '資料から作った要約です。',
        },
      ],
      findings: [
        {
          id: 'generated-finding',
          sourceId: 'generated-source',
          text: '利用者数が増加しました。',
          quote: '利用者数は増加しました。',
        },
      ],
      renderedTitle: '資料のタイトル',
    })
    doc.destroy()
  })

  it('registers a dropped file and its extracted summary and findings', async () => {
    const doc = new Y.Doc()
    mountSourcePanel(doc)
    const transfer = new DataTransfer()
    transfer.items.add(
      new File(['資料本文'], 'annual-summary.md', { type: 'text/markdown' }),
    )
    act(() => {
      host
        ?.querySelector('[aria-labelledby="source-panel-heading"]')
        ?.dispatchEvent(
          new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          }),
        )
    })
    await settleUi(doc)

    expect(readOutput(doc)).toEqual({
      sources: [
        {
          id: 'generated-source',
          kind: 'file',
          title: 'annual-summary',
          url: null,
          fileName: 'annual-summary.md',
          checkedAt: 'normalized-date',
          status: 'ready',
          summary: '資料から作った要約です。',
        },
      ],
      findings: [
        {
          id: 'generated-finding',
          sourceId: 'generated-source',
          text: '利用者数が増加しました。',
          quote: '利用者数は増加しました。',
        },
      ],
      renderedTitle: 'annual-summary',
    })
    doc.destroy()
  })

  it('keeps URL text pasted into the body field as body text', () => {
    const doc = new Y.Doc()
    addSource(doc, {
      id: 'source-a',
      kind: 'url',
      title: '資料ページ',
      url: 'https://data.example.invalid/report',
      fileName: null,
      checkedAt: null,
      status: 'unavailable',
    })
    mountSourcePanel(doc)
    act(() => {
      host
        ?.querySelector('button[aria-expanded="false"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    act(() => {
      ;[...(host?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent === '本文を貼り付け')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const transfer = new DataTransfer()
    transfer.setData(
      'text/plain',
      '資料本文 https://data.example.invalid/appendix',
    )
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    })
    act(() => {
      host?.querySelector('textarea')?.dispatchEvent(event)
    })

    expect(readPasteOutput(event, doc)).toEqual({
      pastePrevented: false,
      sources: [
        {
          id: 'source-a',
          kind: 'url',
          title: '資料ページ',
          url: 'https://data.example.invalid/report',
          fileName: null,
          checkedAt: null,
          status: 'unavailable',
          summary: '',
        },
      ],
      fetchCalls: [],
    })
    doc.destroy()
  })

  it('removes the document source and its findings after the body is deleted', async () => {
    const doc = new Y.Doc()
    addSource(doc, {
      id: 'source-a',
      kind: 'url',
      title: '資料ページ',
      url: 'https://data.example.invalid/report',
      fileName: null,
      checkedAt: null,
    })
    setFindings(doc, 'source-a', [
      {
        id: 'finding-a',
        sourceId: 'source-a',
        text: '要点',
        quote: '引用',
      },
    ])
    mountSourcePanel(doc)
    act(() => {
      host
        ?.querySelector('button[aria-label="資料「資料ページ」を削除"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      await vi.waitFor(() => {
        if (listSources(doc).length > 0)
          throw new Error('source is still present')
      })
    })

    expect(readDeleteOutput(doc)).toEqual({
      sources: [],
      findings: [],
      deleteCalls: [
        {
          url: '/api/articles/article-a/source-bodies/source-a',
          method: 'DELETE',
        },
      ],
    })
    doc.destroy()
  })

  it('keeps the document source when deleting its body fails', async () => {
    const doc = new Y.Doc()
    addSource(doc, {
      id: 'source-a',
      kind: 'url',
      title: '資料ページ',
      url: 'https://data.example.invalid/report',
      fileName: null,
      checkedAt: null,
    })
    deleteStatus = 500
    mountSourcePanel(doc)
    const deleteButton = host?.querySelector<HTMLButtonElement>(
      'button[aria-label="資料「資料ページ」を削除"]',
    )
    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    })

    expect(readDeleteFailureOutput(doc)).toEqual({
      sources: [
        {
          id: 'source-a',
          kind: 'url',
          title: '資料ページ',
          url: 'https://data.example.invalid/report',
          fileName: null,
          checkedAt: null,
          status: 'ready',
          summary: '',
        },
      ],
      alert: '資料本文を削除できませんでした: HTTP 500',
      deleteCalls: [
        {
          url: '/api/articles/article-a/source-bodies/source-a',
          method: 'DELETE',
        },
      ],
    })
    doc.destroy()
  })
})
