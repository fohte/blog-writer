import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import {
  addEvidence,
  addSource,
  getBody,
  listFindings,
  listSources,
  setFindings,
} from '#article/index'
import { isRecord } from '#lib/guards'
import { SourcePanel } from '#research/source-panel'

let host: HTMLDivElement | undefined
let root: Root | undefined
let fetchMock: ReturnType<typeof sourceFetchMock>
let deleteStatus = 204
let urlStatus = 200
let researchStatus = 200
let savedBodies: string[] = []

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

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

function getResearchRequest(body: BodyInit | null | undefined) {
  if (typeof body !== 'string') return { sourceId: 'source-a', body: '' }
  const value: unknown = JSON.parse(body)
  if (!isRecord(value) || !isUnknownArray(value['sources'])) {
    return { sourceId: 'source-a', body: '' }
  }
  const source = value['sources'][0]
  if (!isRecord(source)) return { sourceId: 'source-a', body: '' }
  return {
    sourceId: typeof source['id'] === 'string' ? source['id'] : 'source-a',
    body: typeof source['body'] === 'string' ? source['body'] : '',
  }
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
      const value: unknown =
        typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      const submittedUrl =
        isRecord(value) && typeof value['url'] === 'string'
          ? value['url']
          : null
      if (urlStatus !== 200 || submittedUrl === null) {
        return Promise.resolve(
          new Response(null, { status: urlStatus === 200 ? 400 : urlStatus }),
        )
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            source_id: sourceId,
            title: '資料のタイトル',
            final_url: submittedUrl,
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
    if (url.endsWith('/api/research/key-points')) {
      if (researchStatus !== 200) {
        return Promise.resolve(new Response(null, { status: researchStatus }))
      }
      const request = getResearchRequest(init?.body)
      return Promise.resolve(
        eventResponse({
          sources: [
            {
              id: request.sourceId,
              summary: request.body,
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
    if (init?.method === 'PUT') {
      const value: unknown =
        typeof init.body === 'string' ? JSON.parse(init.body) : undefined
      if (!isRecord(value) || typeof value['body'] !== 'string') {
        return Promise.resolve(new Response(null, { status: 400 }))
      }
      savedBodies.push(value['body'])
      return Promise.resolve(new Response(null, { status: 204 }))
    }
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
    renderedTitle: host?.querySelector('[role="listitem"] span')?.textContent,
  }
}

function readFetchCalls() {
  return fetchMock.mock.calls.map(([resource, init]) => {
    const url =
      resource instanceof Request
        ? resource.url
        : resource instanceof URL
          ? resource.href
          : resource
    return {
      url: url.replace(
        /source-bodies\/[0-9a-f-]{36}/g,
        'source-bodies/generated-source',
      ),
      method: init?.method ?? 'GET',
    }
  })
}

function readRouteOutput(doc: Y.Doc) {
  return { ...readOutput(doc), fetchCalls: readFetchCalls() }
}

function dispatchPaste(target: Element | null | undefined, text: string) {
  const transfer = new DataTransfer()
  transfer.setData('text/plain', text)
  const event = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: transfer,
  })
  act(() => {
    target?.dispatchEvent(event)
  })
  return event
}

function openPasteField(): HTMLTextAreaElement | null | undefined {
  act(() => {
    ;[...(host?.querySelectorAll('button') ?? [])]
      .find((button) => button.textContent === '本文を貼り付けて登録')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  return host?.querySelector('textarea')
}

function submitUrlField(value: string): HTMLInputElement | null | undefined {
  const field = host?.querySelector<HTMLInputElement>('input[name="url"]')
  if (!field) return field
  field.value = value
  act(() => {
    field.form?.requestSubmit()
  })
  return field
}

function changeTextarea(textarea: HTMLTextAreaElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )
  if (descriptor?.set === undefined) {
    throw new Error('Textarea value setter is unavailable')
  }
  descriptor.set.call(textarea, value)
  act(() => {
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function readEditableDropOutput(
  pasteEvent: ClipboardEvent,
  dragOverEvent: DragEvent,
  dropEvent: DragEvent,
  doc: Y.Doc,
) {
  return {
    pastePrevented: pasteEvent.defaultPrevented,
    dragOverPrevented: dragOverEvent.defaultPrevented,
    dropPrevented: dropEvent.defaultPrevented,
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

function readImportFailureOutput(doc: Y.Doc) {
  return {
    ...readOutput(doc),
    alert: host?.querySelector('[role="alert"]')?.textContent,
    fetchCalls: readFetchCalls(),
  }
}

function findElementWithText(selector: string, text: string) {
  return [...(host?.querySelectorAll(selector) ?? [])].find(
    (element) => element.textContent === text,
  )
}

function hasElementWithText(selector: string, text: string) {
  return findElementWithText(selector, text) !== undefined
}

function readAnalysisFailureOutput(doc: Y.Doc) {
  const sourceRow = host?.querySelector('[role="listitem"]')
  return {
    ...readOutput(doc),
    alert: host?.querySelector('[role="alert"]')?.textContent,
    sourceState: sourceRow?.querySelector('p')?.textContent,
    pasteActionVisible: hasElementWithText('button', '本文を貼り付けて登録'),
    retryActionVisible: hasElementWithText('button', '要約をやり直す'),
    emptyFindingsNoticeVisible: hasElementWithText('p', '要点はありません。'),
    fetchCalls: readFetchCalls(),
  }
}

function readExistingAnalysisFailureOutput(doc: Y.Doc) {
  const sourceRow = host?.querySelector('[role="listitem"]')
  return {
    sources: listSources(doc).map(({ checkedAt, ...source }) => ({
      ...source,
      checkedAt: checkedAt === null ? null : 'normalized-date',
    })),
    findings: listFindings(doc),
    alert: host?.querySelector('[role="alert"]')?.textContent,
    sourceState: sourceRow?.querySelector('p')?.textContent,
    pasteActionVisible: hasElementWithText('button', '本文を貼り付けて登録'),
    retryActionVisible: hasElementWithText('button', '要約をやり直す'),
    emptyFindingsNoticeVisible: hasElementWithText('p', '要点はありません。'),
    savedBodies,
    fetchCalls: readFetchCalls(),
  }
}

function readBodyRecoveryOutput(doc: Y.Doc) {
  return { ...readOutput(doc), savedBodies, fetchCalls: readFetchCalls() }
}

function readRecoveryCycleOutput(
  failedImport: ReturnType<typeof readImportFailureOutput>,
  doc: Y.Doc,
) {
  return { failedImport, recovered: readBodyRecoveryOutput(doc) }
}

async function clickRetrySourceAnalysis() {
  const startingCallCount = fetchMock.mock.calls.length
  await act(async () => {
    findElementWithText('button', '要約をやり直す')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    await vi.waitFor(() => {
      if (fetchMock.mock.calls.length < startingCallCount + 2)
        throw new Error('source analysis retry has not reached the LLM API')
    })
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  })
}

function readAnalysisRetryCycleOutput(
  initialFailure: ReturnType<typeof readAnalysisFailureOutput>,
  retriedFailure: ReturnType<typeof readAnalysisFailureOutput>,
  doc: Y.Doc,
) {
  return {
    initialFailure,
    retriedFailure,
    recovered: { ...readOutput(doc), fetchCalls: readFetchCalls() },
  }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  deleteStatus = 204
  urlStatus = 200
  researchStatus = 200
  savedBodies = []
  window.localStorage.clear()
  fetchMock = sourceFetchMock()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SourcePanel', () => {
  it('registers a pasted URL and its summary and findings in the article document', async () => {
    const doc = new Y.Doc()
    mountSourcePanel(doc)
    dispatchPaste(
      host?.querySelector('[aria-labelledby="source-panel-heading"]'),
      'https://data.example.invalid/report',
    )
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
          summary: '利用者数は増加しました。',
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
          summary: '利用者数は増加しました。',
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

  it('registers a URL submitted from the add field and clears the field', async () => {
    const doc = new Y.Doc()
    mountSourcePanel(doc)
    const field = submitUrlField('https://data.example.invalid/report')
    await settleUi(doc)

    expect(field?.value).toBe('')
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
          summary: '利用者数は増加しました。',
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

  it('keeps text without a URL in the add field and explains why nothing was added', () => {
    const doc = new Y.Doc()
    mountSourcePanel(doc)
    const field = submitUrlField('資料ページ')

    expect(listSources(doc)).toEqual([])
    expect(host?.querySelector('[role="alert"]')?.textContent).toBe(
      'URL を読み取れませんでした。',
    )
    expect(field?.value).toBe('資料ページ')
    expect(readFetchCalls()).toEqual([])
    doc.destroy()
  })

  it('registers a file chosen from the file picker', async () => {
    const doc = new Y.Doc()
    mountSourcePanel(doc)
    const picker = host?.querySelector<HTMLInputElement>('input[type="file"]')
    if (!picker) throw new Error('file picker is not rendered')
    const transfer = new DataTransfer()
    transfer.items.add(
      new File(['資料本文'], 'annual-summary.md', { type: 'text/markdown' }),
    )
    picker.files = transfer.files
    act(() => {
      picker.dispatchEvent(new Event('change', { bubbles: true }))
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
          summary: '利用者数は増加しました。',
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

  it('counts the evidence of a source and the sentences edited after the check', () => {
    const doc = new Y.Doc()
    const checkedAt = '2026-01-14T00:00:00.000Z'
    getBody(doc).insert(0, 'First claim. Second claim.')
    addSource(doc, {
      id: 'source-a',
      kind: 'url',
      title: '資料ページ',
      url: 'https://data.example.invalid/report',
      fileName: null,
      checkedAt,
      status: 'ready',
    })
    addEvidence(doc, {
      id: 'evidence-a',
      from: 0,
      to: 12,
      claim: 'First claim.',
      sourceId: 'source-a',
      quote: '最初の引用',
      verdict: 'supported',
      checkedAt,
    })
    addEvidence(doc, {
      id: 'evidence-b',
      from: 13,
      to: 26,
      claim: 'Second claim.',
      sourceId: 'source-a',
      quote: '次の引用',
      verdict: 'outdated',
      checkedAt,
    })
    mountSourcePanel(doc)
    const readRow = () => host?.querySelector('[role="listitem"]')?.textContent
    expect(readRow()).toBe(
      '資料ページ根拠 2 · 要確認 1×data.example.invalid · 取得 2026-01-14',
    )
    act(() => {
      getBody(doc).insert(5, ' edited')
    })

    expect(readRow()).toBe(
      '資料ページ根拠 2 · 要確認 2×data.example.invalid · 取得 2026-01-14 · 確認後に編集 1',
    )
    doc.destroy()
  })
  it('sends LLM requests to the local bridge while source bodies stay on the server', async () => {
    const doc = new Y.Doc()
    window.localStorage.setItem('blog-writer.llm.route', 'local')
    window.localStorage.setItem(
      'blog-writer.llm.bridge-url',
      'http://127.0.0.1:4123/',
    )
    mountSourcePanel(doc)
    dispatchPaste(
      host?.querySelector('[aria-labelledby="source-panel-heading"]'),
      'https://data.example.invalid/report',
    )
    await settleUi(doc)

    expect(readRouteOutput(doc)).toEqual({
      sources: [
        {
          id: 'generated-source',
          kind: 'url',
          title: '資料のタイトル',
          url: 'https://data.example.invalid/report',
          fileName: null,
          checkedAt: 'normalized-date',
          status: 'ready',
          summary: '利用者数は増加しました。',
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
      fetchCalls: [
        {
          url: '/api/articles/article-a/source-bodies/generated-source/url',
          method: 'POST',
        },
        {
          url: '/api/articles/article-a/source-bodies/generated-source',
          method: 'GET',
        },
        {
          url: 'http://127.0.0.1:4123/api/research/key-points',
          method: 'POST',
        },
      ],
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
    const textarea = openPasteField()
    if (!textarea) throw new Error('paste field is not rendered')
    const event = dispatchPaste(
      textarea,
      '資料本文 https://data.example.invalid/appendix',
    )
    const transfer = new DataTransfer()
    transfer.setData(
      'text/plain',
      '資料本文 https://data.example.invalid/appendix',
    )
    const dragOverEvent = new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    })
    const dropEvent = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    })
    act(() => {
      textarea.dispatchEvent(dragOverEvent)
      textarea.dispatchEvent(dropEvent)
    })

    expect(
      readEditableDropOutput(event, dragOverEvent, dropEvent, doc),
    ).toEqual({
      pastePrevented: false,
      dragOverPrevented: false,
      dropPrevented: false,
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

  it('keeps a failed URL import available for pasted body recovery', async () => {
    const doc = new Y.Doc()
    urlStatus = 500
    mountSourcePanel(doc)
    dispatchPaste(
      host?.querySelector('[aria-labelledby="source-panel-heading"]'),
      'https://data.example.invalid/report',
    )
    await settleUi(doc)
    const failedImport = readImportFailureOutput(doc)
    const textarea = openPasteField()
    if (!textarea) throw new Error('paste field is not rendered')
    const body = '本文を手動登録します。 https://data.example.invalid/appendix'
    changeTextarea(textarea, body)
    dispatchPaste(textarea, body)
    act(() => {
      ;[...(host?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent === '本文を登録')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settleUi(doc)

    expect(readRecoveryCycleOutput(failedImport, doc)).toEqual({
      failedImport: {
        sources: [
          {
            id: 'generated-source',
            kind: 'url',
            title: 'data.example.invalid',
            url: 'https://data.example.invalid/report',
            fileName: null,
            checkedAt: null,
            status: 'unavailable',
            summary: '',
          },
        ],
        findings: [],
        renderedTitle: 'data.example.invalid',
        alert: '資料ページを取得できませんでした: HTTP 500',
        fetchCalls: [
          {
            url: '/api/articles/article-a/source-bodies/generated-source/url',
            method: 'POST',
          },
        ],
      },
      recovered: {
        sources: [
          {
            id: 'generated-source',
            kind: 'url',
            title: 'data.example.invalid',
            url: 'https://data.example.invalid/report',
            fileName: null,
            checkedAt: 'normalized-date',
            status: 'ready',
            summary: body,
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
        renderedTitle: 'data.example.invalid',
        savedBodies: [body],
        fetchCalls: [
          {
            url: '/api/articles/article-a/source-bodies/generated-source/url',
            method: 'POST',
          },
          {
            url: '/api/articles/article-a/source-bodies/generated-source',
            method: 'PUT',
          },
          { url: '/api/research/key-points', method: 'POST' },
        ],
      },
    })
    doc.destroy()
  })

  it('distinguishes a failed LLM request after the source body is stored', async () => {
    const doc = new Y.Doc()
    researchStatus = 500
    mountSourcePanel(doc)
    dispatchPaste(
      host?.querySelector('[aria-labelledby="source-panel-heading"]'),
      'https://data.example.invalid/report',
    )
    await settleUi(doc)

    expect(readAnalysisFailureOutput(doc)).toEqual({
      sources: [
        {
          id: 'generated-source',
          kind: 'url',
          title: '資料のタイトル',
          url: 'https://data.example.invalid/report',
          fileName: null,
          checkedAt: 'normalized-date',
          status: 'analysisFailed',
          summary: '',
        },
      ],
      findings: [],
      renderedTitle: '資料のタイトル',
      alert:
        '資料本文は保存済みですが、要約と要点の作成に失敗しました: LLM API returned status 500',
      sourceState: 'data.example.invalid · 要約失敗',
      pasteActionVisible: false,
      retryActionVisible: true,
      emptyFindingsNoticeVisible: false,
      fetchCalls: [
        {
          url: '/api/articles/article-a/source-bodies/generated-source/url',
          method: 'POST',
        },
        {
          url: '/api/articles/article-a/source-bodies/generated-source',
          method: 'GET',
        },
        { url: '/api/research/key-points', method: 'POST' },
      ],
    })
    doc.destroy()
  })

  it('retries analysis from the stored body and stays failed until it succeeds', async () => {
    const doc = new Y.Doc()
    researchStatus = 500
    mountSourcePanel(doc)
    dispatchPaste(
      host?.querySelector('[aria-labelledby="source-panel-heading"]'),
      'https://data.example.invalid/report',
    )
    await settleUi(doc)
    const initialFailure = readAnalysisFailureOutput(doc)

    await clickRetrySourceAnalysis()
    await settleUi(doc)
    const retriedFailure = readAnalysisFailureOutput(doc)

    researchStatus = 200
    await clickRetrySourceAnalysis()
    await settleUi(doc)

    expect(
      readAnalysisRetryCycleOutput(initialFailure, retriedFailure, doc),
    ).toEqual({
      initialFailure: {
        sources: [
          {
            id: 'generated-source',
            kind: 'url',
            title: '資料のタイトル',
            url: 'https://data.example.invalid/report',
            fileName: null,
            checkedAt: 'normalized-date',
            status: 'analysisFailed',
            summary: '',
          },
        ],
        findings: [],
        renderedTitle: '資料のタイトル',
        alert:
          '資料本文は保存済みですが、要約と要点の作成に失敗しました: LLM API returned status 500',
        sourceState: 'data.example.invalid · 要約失敗',
        pasteActionVisible: false,
        retryActionVisible: true,
        emptyFindingsNoticeVisible: false,
        fetchCalls: [
          {
            url: '/api/articles/article-a/source-bodies/generated-source/url',
            method: 'POST',
          },
          {
            url: '/api/articles/article-a/source-bodies/generated-source',
            method: 'GET',
          },
          { url: '/api/research/key-points', method: 'POST' },
        ],
      },
      retriedFailure: {
        sources: [
          {
            id: 'generated-source',
            kind: 'url',
            title: '資料のタイトル',
            url: 'https://data.example.invalid/report',
            fileName: null,
            checkedAt: 'normalized-date',
            status: 'analysisFailed',
            summary: '',
          },
        ],
        findings: [],
        renderedTitle: '資料のタイトル',
        alert:
          '資料本文は保存済みですが、要約と要点の作成に失敗しました: LLM API returned status 500',
        sourceState: 'data.example.invalid · 要約失敗',
        pasteActionVisible: false,
        retryActionVisible: true,
        emptyFindingsNoticeVisible: false,
        fetchCalls: [
          {
            url: '/api/articles/article-a/source-bodies/generated-source/url',
            method: 'POST',
          },
          {
            url: '/api/articles/article-a/source-bodies/generated-source',
            method: 'GET',
          },
          { url: '/api/research/key-points', method: 'POST' },
          {
            url: '/api/articles/article-a/source-bodies/generated-source',
            method: 'GET',
          },
          { url: '/api/research/key-points', method: 'POST' },
        ],
      },
      recovered: {
        sources: [
          {
            id: 'generated-source',
            kind: 'url',
            title: '資料のタイトル',
            url: 'https://data.example.invalid/report',
            fileName: null,
            checkedAt: 'normalized-date',
            status: 'ready',
            summary: '利用者数は増加しました。',
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
        fetchCalls: [
          {
            url: '/api/articles/article-a/source-bodies/generated-source/url',
            method: 'POST',
          },
          {
            url: '/api/articles/article-a/source-bodies/generated-source',
            method: 'GET',
          },
          { url: '/api/research/key-points', method: 'POST' },
          {
            url: '/api/articles/article-a/source-bodies/generated-source',
            method: 'GET',
          },
          { url: '/api/research/key-points', method: 'POST' },
          {
            url: '/api/articles/article-a/source-bodies/generated-source',
            method: 'GET',
          },
          { url: '/api/research/key-points', method: 'POST' },
        ],
      },
    })
    doc.destroy()
  })

  it('clears stale findings when analysis fails after saving pasted body text', async () => {
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
    setFindings(doc, 'source-a', [
      {
        id: 'finding-old',
        text: '以前の要点',
        quote: '以前の引用',
      },
    ])
    researchStatus = 500
    mountSourcePanel(doc)
    const textarea = openPasteField()
    if (!textarea) throw new Error('paste field is not rendered')
    const body = '新しい資料本文を貼り付けます。'
    changeTextarea(textarea, body)
    act(() => {
      ;[...(host?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent === '本文を登録')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settleUi(doc)

    expect(readExistingAnalysisFailureOutput(doc)).toEqual({
      sources: [
        {
          id: 'source-a',
          kind: 'url',
          title: '資料ページ',
          url: 'https://data.example.invalid/report',
          fileName: null,
          checkedAt: 'normalized-date',
          status: 'analysisFailed',
          summary: '',
        },
      ],
      findings: [],
      alert:
        '資料本文は保存済みですが、要約と要点の作成に失敗しました: LLM API returned status 500',
      sourceState: 'data.example.invalid · 要約失敗',
      pasteActionVisible: false,
      retryActionVisible: true,
      emptyFindingsNoticeVisible: false,
      savedBodies: [body],
      fetchCalls: [
        {
          url: '/api/articles/article-a/source-bodies/source-a',
          method: 'PUT',
        },
        { url: '/api/research/key-points', method: 'POST' },
      ],
    })
    doc.destroy()
  })

  it('reports LLM settings read errors without switching to the server route', async () => {
    const doc = new Y.Doc()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is unavailable')
    })
    mountSourcePanel(doc)
    dispatchPaste(
      host?.querySelector('[aria-labelledby="source-panel-heading"]'),
      'https://data.example.invalid/report',
    )
    await settleUi(doc)

    expect(readImportFailureOutput(doc)).toEqual({
      sources: [
        {
          id: 'generated-source',
          kind: 'url',
          title: 'data.example.invalid',
          url: 'https://data.example.invalid/report',
          fileName: null,
          checkedAt: null,
          status: 'unavailable',
          summary: '',
        },
      ],
      findings: [],
      renderedTitle: 'data.example.invalid',
      alert: 'LLM 設定を読み込めませんでした。',
      fetchCalls: [],
    })
    doc.destroy()
  })
})
