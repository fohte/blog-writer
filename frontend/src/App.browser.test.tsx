import '#index.css'

import { EditorView } from '@codemirror/view'
import { ok, okAsync } from 'neverthrow'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import * as Y from 'yjs'

import { App } from '#App'
import {
  addEvidence,
  addSource,
  getBody,
  listEvidence,
  listFindings,
  listSources,
  setBody,
  setFindings,
  updateSource,
} from '#article/index'
import { listMemos } from '#article/memos'
import { isRecord } from '#lib/guards'
import type { Article, SyncClientApi } from '#lib/sync-client'

const { useSyncClientMock } = vi.hoisted(() => ({
  useSyncClientMock: vi.fn(),
}))

vi.mock('#lib/use-sync-client', () => ({
  useSyncClient: useSyncClientMock,
}))

const article: Article = {
  id: 'article-a',
  title: 'A sample article',
  createdAt: Date.UTC(2026, 0, 15),
}

let doc: Y.Doc
let root: Root | undefined
let host: HTMLDivElement | undefined
let fetchMock: ReturnType<typeof vi.fn>
let writeRequest: unknown
let writeRequestCount: number
let holdWriteResponse: boolean
let writeRequestSignal: AbortSignal | undefined

function serverEvents(
  events: Array<{ event: string; data: unknown }>,
): Response {
  const body = events
    .map(
      ({ event, data }) =>
        `event: ${event}\ndata: ${JSON.stringify({ event, data })}\n\n`,
    )
    .join('')
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream' },
  })
}

function proposalResponse(): Response {
  return new Response(
    `data: ${JSON.stringify({
      event: 'result',
      data: {
        suggestions: [{ from: 0, to: 17, replacement: '# Revised section' }],
      },
    })}\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

function writeFromKeyPointsResponse(): Response {
  return new Response(
    `data: ${JSON.stringify({
      event: 'result',
      data: {
        sentences: [
          {
            text: 'The report records an annual increase.',
            is_factual: true,
            key_point_ids: ['finding-sample'],
          },
          {
            text: 'The program reached a national record.',
            is_factual: true,
            key_point_ids: [],
          },
          {
            text: 'The plan stayed ahead of schedule.',
            is_factual: true,
            key_point_ids: ['finding-other-50'],
          },
          {
            text: 'The notes include a local observation.',
            is_factual: true,
            key_point_ids: ['finding-notes'],
          },
          {
            text: 'This may encourage more participation.',
            is_factual: false,
            key_point_ids: [],
          },
        ],
      },
    })}\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

function installFetch(
  handle: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  fetchMock = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    if (url === '/api/file-sync/configuration')
      return Promise.resolve(
        new Response(JSON.stringify({ enabled: false, directory: null })),
      )
    if (url === '/api/export/destinations')
      return Promise.resolve(new Response(JSON.stringify({ destinations: [] })))
    if (url === '/api/write-from-key-points') {
      if (typeof init.body === 'string') writeRequest = JSON.parse(init.body)
      writeRequestCount += 1
      if (holdWriteResponse && init.signal instanceof AbortSignal) {
        const signal = init.signal
        writeRequestSignal = signal
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Aborted', 'AbortError'))
            },
            { once: true },
          )
        })
      }
      return Promise.resolve(writeFromKeyPointsResponse())
    }
    return Promise.resolve(handle(url, init))
  })
  vi.stubGlobal('fetch', fetchMock)
}

function parseObjectBody(body: BodyInit | null | undefined) {
  if (typeof body !== 'string') return undefined
  const parsed: unknown = JSON.parse(body)
  return isRecord(parsed) ? parsed : undefined
}

function exactRoleText(role: string, expectedText: string): string | undefined {
  return [...document.body.querySelectorAll('[role="' + role + '"]')]
    .map((element) => element.textContent.trim())
    .find((text) => text === expectedText)
}

async function renderApp(articleDoc = doc) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const client = {
    start: () => okAsync(undefined),
    openDocument: () => ok(articleDoc),
    createArticle: () => ok(article),
    updateArticleTitle: () => ok(undefined),
    updateArticleExportSettings: () => ok(undefined),
    listArticles: () => [article],
    getStatus: () => 'synced' as const,
    getSyncedAt: () => undefined,
    getError: () => undefined,
    requiresAuthentication: () => false,
    subscribe: () => () => {},
    destroy: () => {},
  } satisfies SyncClientApi
  useSyncClientMock.mockReturnValue({
    articles: [article],
    statuses: { [article.id]: 'synced' },
    client,
    canCreate: true,
    error: undefined,
    requiresAuthentication: false,
    createArticle: () => undefined,
  })
  await act(async () => {
    root?.render(<App />)
    await Promise.resolve()
  })
}

async function waitFor(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {
      await Promise.resolve()
    })
    assertion()
  })
}

async function openArticle() {
  await act(async () => {
    await userEvent.click(page.getByRole('button', { name: article.title }))
  })
}

async function openBodyRequestPreset(claim: string, presetLabel: string) {
  const content = host?.querySelector<HTMLElement>('.cm-content')
  if (!content) throw new Error('The article editor did not render')
  const view = EditorView.findFromDOM(content)
  if (!view) throw new Error('The article editor view did not render')
  const from = getBody(doc).toJSON().indexOf(claim)
  view.dispatch({ selection: { anchor: from, head: from + claim.length } })
  view.focus()
  const modifier = navigator.platform.includes('Mac') ? 'metaKey' : 'ctrlKey'
  act(() => {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'k',
        [modifier]: true,
      }),
    )
  })
  await act(async () => {
    await userEvent.click(
      page
        .getByRole('group', { name: '定型の依頼' })
        .getByRole('button', { name: presetLabel }),
    )
  })
}

beforeEach(async () => {
  writeRequest = undefined
  writeRequestCount = 0
  holdWriteResponse = false
  writeRequestSignal = undefined
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await page.viewport(1280, 900)
  doc = new Y.Doc()
  setBody(doc, '# Research topic\n\nA sentence to edit.\n')
  window.localStorage.removeItem('blog-writer.llm.route')
  window.localStorage.removeItem('blog-writer.llm.bridge-url')
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  doc.destroy()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the application research and evidence integrations', () => {
  it('renders the source panel with article sources', async () => {
    addSource(doc, {
      id: 'source-a',
      kind: 'url',
      title: 'Example source',
      url: 'https://example.invalid/report',
      fileName: null,
      checkedAt: '2026-02-01T00:00:00.000Z',
      summary: 'A source summary.',
    })._unsafeUnwrap()
    installFetch(() => Promise.resolve(new Response('', { status: 404 })))
    await renderApp()
    await openArticle()

    const readRendered = () => ({
      heading: host?.querySelector('#source-panel-heading')?.textContent,
      sourceRowVisible: [
        ...(host?.querySelectorAll('[aria-label="資料一覧"] button span') ??
          []),
      ].some((title) => title.textContent.trim() === 'Example source'),
    })
    expect(readRendered()).toEqual({
      heading: '資料',
      sourceRowVisible: true,
    })
  })

  it('researches the selected heading and saves its sources and findings', async () => {
    let resolveResearch: ((response: Response) => void) | undefined
    let researchStarted: (() => void) | undefined
    const researchWasStarted = new Promise<void>((resolve) => {
      researchStarted = resolve
    })
    let requestQuestion: unknown
    const savedBodies: Array<{ url: string; body: unknown }> = []
    installFetch((url, init) => {
      if (url === '/api/research/jobs') {
        if (typeof init.body === 'string')
          requestQuestion = JSON.parse(init.body) as unknown
        if (researchStarted !== undefined) researchStarted()
        return new Promise((resolve) => {
          resolveResearch = resolve
        })
      }
      if (url.endsWith('/save-if-unchanged')) {
        savedBodies.push({
          url,
          body:
            typeof init.body === 'string'
              ? (JSON.parse(init.body) as unknown)
              : init.body,
        })
        return new Response(null, { status: 204 })
      }
      return new Response('', { status: 404 })
    })
    await renderApp()
    await openArticle()
    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: 'Research topic' }),
      )
    })
    await act(async () => {
      await userEvent.fill(
        page.getByRole('textbox', { name: '調べる問い' }),
        'Custom research question',
      )
    })
    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: 'この見出しについて調べる' }),
      )
    })
    await researchWasStarted
    const readResearchView = () => ({
      selectedTab: host?.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
      progressTitle: host?.querySelector(
        '[aria-labelledby="source-panel-heading"] h3',
      )?.textContent,
    })
    await waitFor(() => {
      if (readResearchView().progressTitle === undefined)
        throw new Error('The research progress did not render')
    })
    const researchView = readResearchView()
    const editorLine = host?.querySelectorAll<HTMLElement>('.cm-line').item(1)
    if (!editorLine) throw new Error('The article editor did not render')
    const editorView = EditorView.findFromDOM(editorLine)
    if (!editorView) throw new Error('The article editor view did not render')
    act(() => {
      const body = getBody(doc)
      editorView.dispatch({
        changes: {
          from: body.length - 1,
          insert: ' Draft update.',
        },
      })
    })
    const resolve = resolveResearch
    if (!resolve) throw new Error('The research request did not start')
    resolve(
      serverEvents([
        { event: 'progress', data: { query: 'Research topic' } },
        {
          event: 'result',
          data: {
            analysis: {
              task: 'key_points',
              data: {
                sources: [
                  {
                    id: 'source-research',
                    summary: 'A concise research summary.',
                    key_points: [
                      {
                        text: 'The result changed.',
                        quote: 'The result changed.',
                      },
                    ],
                  },
                ],
              },
            },
            sources: [
              {
                id: 'source-research',
                url: 'https://example.invalid/research',
                final_url: 'https://example.invalid/research',
                title: 'Research source',
                status: 'available',
                body: 'Source body.',
              },
            ],
          },
        },
      ]),
    )
    await waitFor(() => {
      if (listSources(doc).length !== 1) throw new Error('Source was not saved')
    })

    const readResult = () => ({
      researchView,
      requestQuestion,
      articleBody: getBody(doc).toJSON(),
      savedBodies,
      sources: listSources(doc).map(({ id, title, url, status, summary }) => ({
        id,
        title,
        url,
        status,
        summary,
      })),
      findings: listFindings(doc).map(
        ({ sourceId, text, quote, researchedHeading }) => ({
          sourceId,
          text,
          quote,
          researchedHeading,
        }),
      ),
    })
    expect(readResult()).toEqual({
      researchView: {
        selectedTab: '資料',
        progressTitle: '調べています · Research topic',
      },
      requestQuestion: {
        task: 'key_points',
        question: 'Custom research question',
      },
      articleBody: '# Research topic\n\nA sentence to edit. Draft update.\n',
      savedBodies: [
        {
          url: '/api/articles/article-a/source-bodies/source-research/save-if-unchanged',
          body: { expected_body: null, body: 'Source body.' },
        },
      ],
      sources: [
        {
          id: 'source-research',
          title: 'Research source',
          url: 'https://example.invalid/research',
          status: 'ready',
          summary: 'A concise research summary.',
        },
      ],
      findings: [
        {
          sourceId: 'source-research',
          text: 'The result changed.',
          quote: 'The result changed.',
          researchedHeading: 'Research topic',
        },
      ],
    })
  })

  it('aborts a heading research request without saving results', async () => {
    const interruptedText = '調査を中断しました。資料は保存されていません。'
    let researchStarted: (() => void) | undefined
    let requestQuestion: unknown
    let requestSignal: AbortSignal | undefined
    let abortEventReceived = false
    const researchWasStarted = new Promise<void>((resolve) => {
      researchStarted = resolve
    })
    let putCount = 0
    installFetch((url, init) => {
      if (url === '/api/research/jobs') {
        if (typeof init.body === 'string')
          requestQuestion = JSON.parse(init.body) as unknown
        requestSignal = init.signal ?? undefined
        if (researchStarted !== undefined) researchStarted()
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            abortEventReceived = true
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
      }
      if (init.method === 'POST' && url.endsWith('/save-if-unchanged'))
        putCount += 1
      return new Response('', { status: 404 })
    })
    await renderApp()
    await openArticle()
    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: 'Research topic' }),
      )
      await userEvent.click(
        page.getByRole('button', { name: 'この見出しについて調べる' }),
      )
    })
    await researchWasStarted
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    await waitFor(() => {
      if (exactRoleText('status', interruptedText) !== interruptedText)
        throw new Error('The interrupted state was not shown')
    })

    const readResult = () => ({
      query: requestQuestion,
      requestSignalAborted: requestSignal?.aborted,
      abortEventReceived,
      sourceCount: listSources(doc).length,
      findingCount: listFindings(doc).length,
      bodySaveRequests: putCount,
      interruptedMessage: exactRoleText('status', interruptedText),
    })
    expect(readResult()).toEqual({
      query: { task: 'key_points', question: 'Research topic' },
      requestSignalAborted: true,
      abortEventReceived: true,
      sourceCount: 0,
      findingCount: 0,
      bodySaveRequests: 0,
      interruptedMessage: interruptedText,
    })
  })

  it('shows an interrupted state when the research stream closes early', async () => {
    const interruptedText = '調査を中断しました。資料は保存されていません。'
    let requestQuestion: unknown
    let bodySaveCount = 0
    installFetch((url, init) => {
      if (url === '/api/research/jobs') {
        if (typeof init.body === 'string')
          requestQuestion = JSON.parse(init.body) as unknown
        return serverEvents([
          { event: 'progress', data: { query: 'Research topic' } },
        ])
      }
      if (init.method === 'POST' && url.endsWith('/save-if-unchanged'))
        bodySaveCount += 1
      return new Response('', { status: 404 })
    })
    await renderApp()
    await openArticle()
    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: 'Research topic' }),
      )
      await userEvent.click(
        page.getByRole('button', { name: 'この見出しについて調べる' }),
      )
    })
    await waitFor(() => {
      if (exactRoleText('status', interruptedText) !== interruptedText)
        throw new Error('The interrupted state was not shown')
    })

    const readResult = () => ({
      query: requestQuestion,
      progressQueries: document.body.querySelector('[aria-label="検索の進捗"]')
        ?.textContent,
      sourceCount: listSources(doc).length,
      findingCount: listFindings(doc).length,
      bodySaveCount,
      interruptedMessage: exactRoleText('status', interruptedText),
      connectionMessage: exactRoleText('alert', '調査の接続が中断されました。'),
    })
    expect(readResult()).toEqual({
      query: { task: 'key_points', question: 'Research topic' },
      progressQueries: '検索 “Research topic”',
      sourceCount: 0,
      findingCount: 0,
      bodySaveCount: 0,
      interruptedMessage: interruptedText,
      connectionMessage: '調査の接続が中断されました。',
    })
  })

  it('adds research findings to an existing source with the same URL', async () => {
    const url = 'https://example.invalid/research'
    addSource(doc, {
      id: 'source-existing',
      kind: 'url',
      title: 'Existing source',
      url,
      fileName: null,
      checkedAt: '2026-02-01T00:00:00.000Z',
      status: 'unavailable',
      summary: 'The earlier summary.',
    })._unsafeUnwrap()
    setFindings(doc, 'source-existing', [
      {
        id: 'finding-existing',
        researchedHeading: 'Earlier heading',
        text: 'Earlier finding.',
        quote: 'Earlier quote.',
      },
    ])._unsafeUnwrap()
    const savedBodies: Array<{ url: string; body: unknown }> = []
    installFetch((requestUrl, init) => {
      if (requestUrl === '/api/research/jobs')
        return serverEvents([
          {
            event: 'result',
            data: {
              analysis: {
                task: 'key_points',
                data: {
                  sources: [
                    {
                      id: 'source-new',
                      summary: 'The latest summary.',
                      key_points: [
                        { text: 'New finding.', quote: 'New quote.' },
                      ],
                    },
                  ],
                },
              },
              sources: [
                {
                  id: 'source-new',
                  url,
                  final_url: url,
                  title: 'New title',
                  status: 'available',
                  body: 'New body.',
                },
              ],
            },
          },
        ])
      if (init.method === 'POST' && requestUrl.endsWith('/save-if-unchanged'))
        savedBodies.push({
          url: requestUrl,
          body:
            typeof init.body === 'string'
              ? (JSON.parse(init.body) as unknown)
              : init.body,
        })
      if (init.method === undefined || init.method === 'GET')
        return new Response('', { status: 404 })
      return new Response(null, { status: 204 })
    })
    await renderApp()
    await openArticle()
    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: 'Research topic' }),
      )
      await userEvent.click(
        page.getByRole('button', { name: 'この見出しについて調べる' }),
      )
    })
    await waitFor(() => {
      if (listFindings(doc).length !== 2)
        throw new Error('The finding was not added to the existing source')
    })

    const readResult = () => ({
      savedBodies,
      sources: listSources(doc).map(({ id, title, url, status, summary }) => ({
        id,
        title,
        url,
        status,
        summary,
      })),
      findings: listFindings(doc).map(
        ({ sourceId, text, quote, researchedHeading }) => ({
          sourceId,
          text,
          quote,
          researchedHeading,
        }),
      ),
    })
    expect(readResult()).toEqual({
      savedBodies: [
        {
          url: '/api/articles/article-a/source-bodies/source-existing/save-if-unchanged',
          body: { expected_body: null, body: 'New body.' },
        },
      ],
      sources: [
        {
          id: 'source-existing',
          title: 'Existing source',
          url,
          status: 'ready',
          summary: 'The latest summary.',
        },
      ],
      findings: [
        {
          sourceId: 'source-existing',
          text: 'Earlier finding.',
          quote: 'Earlier quote.',
          researchedHeading: 'Earlier heading',
        },
        {
          sourceId: 'source-existing',
          text: 'New finding.',
          quote: 'New quote.',
          researchedHeading: 'Research topic',
        },
      ],
    })
  })

  it('opens and closes evidence cards from the article marker', async () => {
    const markdown = '# Research topic\n\nA sentence to edit.\n'
    const claim = 'A sentence to edit.'
    addSource(doc, {
      id: 'source-evidence',
      kind: 'url',
      title: 'Evidence source',
      url: 'https://example.invalid/evidence',
      fileName: null,
      checkedAt: '2026-02-01T00:00:00.000Z',
      summary: 'Evidence summary.',
    })._unsafeUnwrap()
    addEvidence(doc, {
      id: 'evidence-a',
      from: markdown.indexOf(claim),
      to: markdown.indexOf(claim) + claim.length,
      claim,
      sourceId: 'source-evidence',
      quote: 'A matching quotation.',
      verdict: 'supported',
      checkedAt: '2026-02-01T00:00:00.000Z',
    })._unsafeUnwrap()
    installFetch(() => Promise.resolve(new Response('', { status: 404 })))
    await renderApp()
    await openArticle()
    await waitFor(() => {
      if (!host?.querySelector('.cm-evidence-marker'))
        throw new Error('Evidence marker did not render')
    })
    const marker = host?.querySelector<HTMLButtonElement>('.cm-evidence-marker')
    if (!marker) throw new Error('Evidence marker did not render')
    act(() => {
      marker.click()
    })
    await waitFor(() => {
      if (!host?.querySelector('.cm-evidence-card'))
        throw new Error('Evidence card did not open')
    })
    act(() => {
      marker.click()
    })
    await waitFor(() => {
      if (host?.querySelector('.cm-evidence-card'))
        throw new Error('Evidence card did not close')
    })

    const readResult = () => ({
      markerClass: marker.className,
      cardVisible: Boolean(host?.querySelector('.cm-evidence-card')),
      sourceTitle: listSources(doc)[0]?.title,
      evidence: listEvidence(doc).map(({ currentClaim, quote, verdict }) => ({
        currentClaim,
        quote,
        verdict,
      })),
    })
    expect(readResult()).toEqual({
      markerClass: 'cm-evidence-marker cm-evidence-supported',
      cardVisible: false,
      sourceTitle: 'Evidence source',
      evidence: [
        {
          currentClaim: claim,
          quote: 'A matching quotation.',
          verdict: 'supported',
        },
      ],
    })
  })

  it('registers and judges a URL dropped onto an article sentence', async () => {
    const claim = 'A sentence to edit.'
    let fetchedBodyCount = 0
    let judgedClaim: unknown
    installFetch((url, init) => {
      const sourceId = url.split('/source-bodies/')[1]?.split('/')[0] ?? ''
      if (url.endsWith('/url'))
        return new Response(
          JSON.stringify({
            source_id: sourceId,
            title: 'Dropped source',
            final_url: 'https://example.invalid/dropped',
          }),
        )
      if (
        url.includes('/source-bodies/') &&
        (init.method === 'GET' || init.method === undefined)
      ) {
        fetchedBodyCount += 1
        return new Response(
          JSON.stringify({
            source_id: sourceId,
            article_id: article.id,
            body: 'A source confirms the sentence.',
          }),
        )
      }
      if (url === '/api/research/claim-evidence') {
        const body =
          typeof init.body === 'string'
            ? (JSON.parse(init.body) as unknown)
            : undefined
        if (isRecord(body) && typeof body['claim'] === 'string')
          judgedClaim = body['claim']
        const sourceId =
          isRecord(body) &&
          Array.isArray(body['sources']) &&
          isRecord(body['sources'][0]) &&
          typeof body['sources'][0]['id'] === 'string'
            ? body['sources'][0]['id']
            : ''
        return serverEvents([
          {
            event: 'result',
            data: {
              verdict: 'supported',
              quote: {
                source_id: sourceId,
                text: 'A source confirms the sentence.',
              },
            },
          },
        ])
      }
      return new Response('', { status: 404 })
    })
    await renderApp()
    await openArticle()
    const content = host?.querySelector<HTMLElement>('.cm-content')
    if (!content) throw new Error('The article editor did not render')
    vi.spyOn(EditorView.prototype, 'posAtCoords').mockReturnValue(
      getBody(doc).toJSON().indexOf(claim) + 4,
    )
    const transfer = new DataTransfer()
    transfer.setData('text/uri-list', 'https://example.invalid/dropped')
    act(() => {
      content.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      )
    })
    await waitFor(() => {
      if (listEvidence(doc).length !== 1)
        throw new Error('The dropped source was not judged')
    })

    const readResult = () => ({
      judgedClaim,
      fetchedBodyCount,
      sources: listSources(doc).map(({ title, url, status }) => ({
        title,
        url,
        status,
      })),
      evidence: listEvidence(doc).map(({ currentClaim, quote, verdict }) => ({
        currentClaim,
        quote,
        verdict,
      })),
    })
    expect(readResult()).toEqual({
      judgedClaim: claim,
      fetchedBodyCount: 1,
      sources: [
        {
          title: 'Dropped source',
          url: 'https://example.invalid/dropped',
          status: 'ready',
        },
      ],
      evidence: [
        {
          currentClaim: claim,
          quote: 'A source confirms the sentence.',
          verdict: 'supported',
        },
      ],
    })
  })

  it('judges a claim, adopts its proposal, and rechecks the adopted text', async () => {
    const claim = 'A sentence to edit.'
    const replacement = 'A verified sentence.'
    const beforeContext = 'p'.repeat(1200)
    const afterContext = 's'.repeat(1300)
    setBody(
      doc,
      `# Research topic\n\n${beforeContext}${claim}${afterContext}\n`,
    )
    const sourceId = 'source-main'
    const savedSourceId = 'source-existing'
    addSource(doc, {
      id: savedSourceId,
      kind: 'url',
      title: 'Existing source',
      url: 'https://example.invalid/research',
      fileName: null,
      checkedAt: null,
      status: 'unavailable',
      summary: '',
    })._unsafeUnwrap()
    addSource(doc, {
      id: sourceId,
      kind: 'url',
      title: 'Other source',
      url: 'https://example.invalid/other',
      fileName: null,
      checkedAt: null,
      status: 'ready',
      summary: '',
    })._unsafeUnwrap()
    const originalEvidenceId = 'evidence-original'
    const originalCheckedAt = '2026-01-01T00:00:00.000Z'
    addEvidence(doc, {
      id: originalEvidenceId,
      from: getBody(doc).toJSON().indexOf(claim),
      to: getBody(doc).toJSON().indexOf(claim) + claim.length,
      claim,
      sourceId: savedSourceId,
      quote: 'An earlier quote.',
      verdict: 'outdated',
      checkedAt: originalCheckedAt,
    })._unsafeUnwrap()
    let researchRequest: unknown
    let judgedRequest: unknown
    installFetch((url, init) => {
      if (url === '/api/research/jobs') {
        researchRequest = parseObjectBody(init.body)
        return serverEvents([
          {
            event: 'progress',
            data: { query: 'search query' },
          },
          {
            event: 'result',
            data: {
              analysis: {
                task: 'claim_evidence',
                data: {
                  verdict: 'outdated',
                  quote: {
                    source_id: sourceId,
                    text: 'A current source quote.',
                  },
                  suggestion: replacement,
                },
              },
              sources: [
                {
                  id: 'source-other',
                  url: 'https://example.invalid/other',
                  title: 'Other source',
                  body: 'An unrelated source quote.',
                  status: 'available',
                },
                {
                  id: sourceId,
                  url: 'https://example.invalid/research',
                  final_url: 'https://example.invalid/research',
                  title: 'Research source',
                  body: 'A current source quote.',
                  status: 'available',
                },
              ],
            },
          },
        ])
      }
      if (url.includes('/source-bodies/')) {
        if (url.endsWith('/save-if-unchanged'))
          return new Response(null, { status: 204 })
        return new Response('', { status: 404 })
      }
      if (url === '/api/research/claim-evidence') {
        judgedRequest = parseObjectBody(init.body)
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(
              serverEvents([
                {
                  event: 'result',
                  data: {
                    verdict: 'insufficient',
                    quote: null,
                    suggestion: null,
                  },
                },
              ]),
            )
          }, 20)
        })
      }
      return new Response('', { status: 404 })
    })
    await renderApp()
    await openArticle()
    await openBodyRequestPreset(claim, '根拠を確かめる')
    await waitFor(() => {
      if (!host?.querySelector('.suggestion-diff-note'))
        throw new Error('The source note did not render')
    })
    const sourceNote = host?.querySelector('.suggestion-diff-note')?.textContent
    const checkedAtBeforeAcceptance = listEvidence(doc)[0]?.checkedAt

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '採用 Tab' }))
    })
    await waitFor(() => {
      if (
        listEvidence(doc)[0]?.verdict !== 'insufficient' ||
        host?.querySelector('.cm-evidence-marker')?.className !==
          'cm-evidence-marker cm-evidence-needs-review' ||
        listEvidence(doc)[0]?.checkedAt === checkedAtBeforeAcceptance
      )
        throw new Error('The adopted claim was not rechecked')
    })

    const readResult = () => ({
      body: getBody(doc).toJSON(),
      researchRequest,
      judgedRequest,
      sourceNote,
      source: listSources(doc).map(({ title, url, status }) => ({
        title,
        url,
        status,
      })),
      evidence: listEvidence(doc).map(
        ({ id, currentClaim, edited, quote, sourceId, verdict }) => ({
          id: id === originalEvidenceId ? 'original' : 'adopted',
          currentClaim,
          edited,
          quote,
          sourceId,
          verdict,
        }),
      ),
      markers: [...(host?.querySelectorAll('.cm-evidence-marker') ?? [])].map(
        ({ className }) => className,
      ),
      checkedAtUpdated:
        listEvidence(doc)[0]?.checkedAt !== checkedAtBeforeAcceptance,
    })
    expect(readResult()).toEqual({
      body: `# Research topic\n\n${beforeContext}${replacement}${afterContext}\n`,
      researchRequest: {
        task: 'claim_evidence',
        claim,
        before: beforeContext.slice(-1000),
        after: afterContext.slice(0, 1000),
      },
      judgedRequest: {
        claim: replacement,
        before: beforeContext.slice(-1000),
        after: afterContext.slice(0, 1000),
        sources: [{ id: savedSourceId, body: 'A current source quote.' }],
      },
      sourceNote: '根拠の資料: Research source',
      source: [
        {
          title: 'Existing source',
          url: 'https://example.invalid/research',
          status: 'ready',
        },
        {
          title: 'Other source',
          url: 'https://example.invalid/other',
          status: 'ready',
        },
      ],
      evidence: [
        {
          id: 'adopted',
          currentClaim: replacement,
          edited: false,
          quote: '',
          sourceId: savedSourceId,
          verdict: 'insufficient',
        },
      ],
      markers: ['cm-evidence-marker cm-evidence-needs-review'],
      checkedAtUpdated: true,
    })
  })

  it('updates existing evidence when checking a claim again', async () => {
    const claim = 'A sentence to edit.'
    const sourceId = 'source-existing'
    const evidenceId = 'evidence-original'
    const checkedAt = '2026-01-01T00:00:00.000Z'
    addSource(doc, {
      id: sourceId,
      kind: 'url',
      title: 'Existing source',
      url: 'https://example.invalid/research',
      fileName: null,
      checkedAt: null,
      status: 'ready',
      summary: '',
    })._unsafeUnwrap()
    const from = getBody(doc).toJSON().indexOf(claim)
    addEvidence(doc, {
      id: evidenceId,
      from,
      to: from + claim.length,
      claim,
      sourceId,
      quote: 'An earlier quote.',
      verdict: 'outdated',
      checkedAt,
    })._unsafeUnwrap()
    installFetch((url) => {
      if (url === '/api/research/jobs')
        return serverEvents([
          {
            event: 'result',
            data: {
              analysis: {
                task: 'claim_evidence',
                data: {
                  verdict: 'supported',
                  quote: { source_id: sourceId, text: 'A verified quote.' },
                  suggestion: null,
                },
              },
              sources: [
                {
                  id: sourceId,
                  url: 'https://example.invalid/research',
                  title: 'Existing source',
                  status: 'available',
                  body: 'A verified quote.',
                },
              ],
            },
          },
        ])
      return new Response('', { status: 404 })
    })
    await renderApp()
    await openArticle()
    await openBodyRequestPreset(claim, '根拠を確かめる')
    await waitFor(() => {
      if (
        host?.querySelector('.cm-evidence-marker')?.className !==
        'cm-evidence-marker cm-evidence-supported'
      )
        throw new Error('The existing evidence was not updated')
    })

    const readResult = () => ({
      body: getBody(doc).toJSON(),
      evidence: listEvidence(doc).map(
        ({ id, currentClaim, sourceId: evidenceSourceId, quote, verdict }) => ({
          id: id === evidenceId ? 'original' : 'new',
          currentClaim,
          sourceId: evidenceSourceId,
          quote,
          verdict,
          checkedAt:
            listEvidence(doc)[0]?.checkedAt === checkedAt
              ? 'unchanged'
              : 'updated',
        }),
      ),
      markers: [...(host?.querySelectorAll('.cm-evidence-marker') ?? [])].map(
        ({ className }) => className,
      ),
    })
    expect(readResult()).toEqual({
      body: '# Research topic\n\nA sentence to edit.\n',
      evidence: [
        {
          id: 'original',
          currentClaim: claim,
          sourceId,
          quote: 'A verified quote.',
          verdict: 'supported',
          checkedAt: 'updated',
        },
      ],
      markers: ['cm-evidence-marker cm-evidence-supported'],
    })
  })

  it('keeps a yellow marker on the original claim when its proposal is rejected', async () => {
    const claim = 'A sentence to edit.'
    const sourceId = 'source-research-a'
    installFetch((url) => {
      if (url === '/api/research/jobs')
        return serverEvents([
          {
            event: 'result',
            data: {
              analysis: {
                task: 'claim_evidence',
                data: {
                  verdict: 'contradicted',
                  quote: { source_id: sourceId, text: 'A conflicting quote.' },
                  suggestion: 'A corrected sentence.',
                },
              },
              sources: [
                {
                  id: sourceId,
                  url: 'https://example.invalid/research',
                  title: 'Research source',
                  body: 'A conflicting quote.',
                  status: 'available',
                },
              ],
            },
          },
        ])
      if (url.includes('/source-bodies/' + sourceId)) {
        if (url.endsWith('/save-if-unchanged'))
          return new Response(null, { status: 204 })
        return new Response('', { status: 404 })
      }
      return new Response('', { status: 404 })
    })
    await renderApp()
    await openArticle()
    await openBodyRequestPreset(claim, '根拠を確かめる')
    await waitFor(() => {
      if (!host?.querySelector('.suggestion-diff-note'))
        throw new Error('The source note did not render')
    })
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '却下 Esc' }))
    })

    const readResult = () => ({
      body: getBody(doc).toJSON(),
      evidence: listEvidence(doc).map(
        ({ currentClaim, edited, quote, verdict }) => ({
          currentClaim,
          edited,
          quote,
          verdict,
        }),
      ),
      markers: [...(host?.querySelectorAll('.cm-evidence-marker') ?? [])].map(
        ({ className }) => className,
      ),
    })
    expect(readResult()).toEqual({
      body: `# Research topic\n\n${claim}\n`,
      evidence: [
        {
          currentClaim: claim,
          edited: false,
          quote: 'A conflicting quote.',
          verdict: 'contradicted',
        },
      ],
      markers: ['cm-evidence-marker cm-evidence-needs-review'],
    })
  })

  it('shows an error when rechecking an adopted claim fails', async () => {
    const claim = 'A sentence to edit.'
    const replacement = 'A corrected sentence.'
    const sourceId = 'source-research-a'
    installFetch((url) => {
      if (url === '/api/research/jobs')
        return serverEvents([
          {
            event: 'result',
            data: {
              analysis: {
                task: 'claim_evidence',
                data: {
                  verdict: 'outdated',
                  quote: { source_id: sourceId, text: 'A current quote.' },
                  suggestion: replacement,
                },
              },
              sources: [
                {
                  id: sourceId,
                  url: 'https://example.invalid/research',
                  title: 'Research source',
                  body: 'A current quote.',
                  status: 'available',
                },
              ],
            },
          },
        ])
      if (url.includes('/source-bodies/' + sourceId)) {
        if (url.endsWith('/save-if-unchanged'))
          return new Response(null, { status: 204 })
        return new Response('', { status: 404 })
      }
      if (url === '/api/research/claim-evidence')
        return new Response('', { status: 500 })
      return new Response('', { status: 404 })
    })
    await renderApp()
    await openArticle()
    await openBodyRequestPreset(claim, '根拠を確かめる')
    await waitFor(() => {
      if (!host?.querySelector('.suggestion-diff-note'))
        throw new Error('The source note did not render')
    })
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '採用 Tab' }))
    })
    const errorMessage = '採用後の根拠を再判定できませんでした。'
    await waitFor(() => {
      if (exactRoleText('alert', errorMessage) !== errorMessage)
        throw new Error('The failed recheck was not shown')
    })

    const readResult = () => ({
      body: getBody(doc).toJSON(),
      error: exactRoleText('alert', errorMessage),
      evidence: listEvidence(doc).map(
        ({ currentClaim, edited, quote, verdict }) => ({
          currentClaim,
          edited,
          quote,
          verdict,
        }),
      ),
      marker: host?.querySelector('.cm-evidence-marker')?.className,
    })
    expect(readResult()).toEqual({
      body: `# Research topic\n\n${replacement}\n`,
      error: errorMessage,
      evidence: [
        {
          currentClaim: replacement,
          edited: false,
          quote: '',
          verdict: 'insufficient',
        },
      ],
      marker: 'cm-evidence-marker cm-evidence-needs-review',
    })
  })

  it('marks a claim yellow when the sources provide insufficient support', async () => {
    const claim = 'A sentence to edit.'
    installFetch((url) => {
      if (url === '/api/research/jobs')
        return serverEvents([
          {
            event: 'result',
            data: {
              analysis: {
                task: 'claim_evidence',
                data: {
                  verdict: 'insufficient',
                  quote: null,
                  suggestion: null,
                },
              },
              sources: [],
            },
          },
        ])
      return new Response('', { status: 404 })
    })
    await renderApp()
    await openArticle()
    await openBodyRequestPreset(claim, '根拠を確かめる')
    await waitFor(() => {
      if (!host?.querySelector('.cm-evidence-marker'))
        throw new Error('The insufficient judgment marker did not render')
    })

    const readResult = () => ({
      evidence: listEvidence(doc).map(
        ({ currentClaim, edited, quote, sourceId, verdict }) => ({
          currentClaim,
          edited,
          quote,
          sourceId,
          verdict,
        }),
      ),
      markerClass: host?.querySelector('.cm-evidence-marker')?.className,
      proposals: host?.querySelectorAll('.suggestion-diff').length,
    })
    expect(readResult()).toEqual({
      evidence: [
        {
          currentClaim: claim,
          edited: false,
          quote: '',
          sourceId: null,
          verdict: 'insufficient',
        },
      ],
      markerClass: 'cm-evidence-marker cm-evidence-needs-review',
      proposals: 0,
    })
  })

  it('keeps earlier claim proposals when another claim is checked', async () => {
    const firstClaim = 'A first sentence.'
    const secondClaim = 'A second sentence.'
    setBody(doc, `# Research topic\n\n${firstClaim} ${secondClaim}\n`)
    let researchCount = 0
    installFetch((url) => {
      if (url === '/api/research/jobs') {
        researchCount += 1
        const sourceId = researchCount === 1 ? 'source-one' : 'source-two'
        const title = researchCount === 1 ? 'Source one' : 'Source two'
        const claim = researchCount === 1 ? firstClaim : secondClaim
        return serverEvents([
          {
            event: 'result',
            data: {
              analysis: {
                task: 'claim_evidence',
                data: {
                  verdict: 'outdated',
                  quote: { source_id: sourceId, text: `${title} quote.` },
                  suggestion: `${claim} Updated`,
                },
              },
              sources: [
                {
                  id: sourceId,
                  url: `https://example.invalid/${sourceId}`,
                  title,
                  body: `${title} quote.`,
                  status: 'available',
                },
              ],
            },
          },
        ])
      }
      if (url.includes('/source-bodies/')) {
        if (url.endsWith('/save-if-unchanged'))
          return new Response(null, { status: 204 })
        return new Response('', { status: 404 })
      }
      return new Response('', { status: 404 })
    })
    await renderApp()
    await openArticle()
    await openBodyRequestPreset(firstClaim, '根拠を確かめる')
    await waitFor(() => {
      if (host?.querySelectorAll('.suggestion-diff-note').length !== 1)
        throw new Error('The first claim proposal did not render')
    })
    await openBodyRequestPreset(secondClaim, '根拠を確かめる')
    // Only the focused proposal shows its note; the earlier one keeps its underline.
    await waitFor(() => {
      if (
        host?.querySelector('.suggestion-diff-note')?.textContent !==
          '根拠の資料: Source two' ||
        host.querySelectorAll('.cm-suggestion-target').length !== 1
      )
        throw new Error('Both claim proposals did not render')
    })

    const readResult = () => ({
      researchCount,
      focusedNote:
        host?.querySelector('.suggestion-diff-note')?.textContent ?? null,
      unfocusedTargets: [
        ...(host?.querySelectorAll('.cm-suggestion-target') ?? []),
      ].map((target) => target.textContent),
      evidence: listEvidence(doc).map(({ currentClaim, verdict }) => ({
        currentClaim,
        verdict,
      })),
    })
    expect(readResult()).toEqual({
      researchCount: 2,
      focusedNote: '根拠の資料: Source two',
      unfocusedTargets: [firstClaim],
      evidence: [
        { currentClaim: firstClaim, verdict: 'outdated' },
        { currentClaim: secondClaim, verdict: 'outdated' },
      ],
    })
  })

  it('does not save sources or evidence when the research is cancelled', async () => {
    const claim = 'A sentence to edit.'
    let requestSignal: AbortSignal | undefined
    installFetch((url, init) => {
      if (url !== '/api/research/jobs') return new Response('', { status: 404 })
      requestSignal = init.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })
    await renderApp()
    await openArticle()
    await openBodyRequestPreset(claim, '根拠を確かめる')
    await waitFor(() => {
      if (!requestSignal) throw new Error('Research did not start')
    })
    const activeRequestSignal = requestSignal
    if (!activeRequestSignal) throw new Error('Research did not start')
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '中止' }))
    })
    await waitFor(() => {
      if (!document.body.textContent.includes('調査を中断しました。'))
        throw new Error('The cancelled research did not finish')
    })

    const readResult = () => ({
      sources: listSources(doc),
      evidence: listEvidence(doc),
      aborted: activeRequestSignal.aborted,
    })
    expect(readResult()).toEqual({ sources: [], evidence: [], aborted: true })
  })

  it('keeps the active claim check visible when another research preset is selected', async () => {
    const claim = 'A sentence to edit.'
    let requestCount = 0
    let requestSignal: AbortSignal | undefined
    installFetch((url, init) => {
      if (url !== '/api/research/jobs') return new Response('', { status: 404 })
      requestCount += 1
      requestSignal = init.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })
    await renderApp()
    await openArticle()
    await openBodyRequestPreset(claim, '根拠を確かめる')
    await waitFor(() => {
      if (!requestSignal) throw new Error('Research did not start')
    })
    await openBodyRequestPreset(claim, 'この見出しについて調べる')
    const activeRequestSignal = requestSignal
    if (!activeRequestSignal) throw new Error('Research did not start')
    const activeProgress = {
      requestCount,
      progressTitle: document.body.querySelector(
        '[aria-labelledby="source-panel-heading"] h3',
      )?.textContent,
      cancelButtons: [...document.body.querySelectorAll('button')].filter(
        (button) => button.textContent.trim() === '中止',
      ).length,
    }

    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: '中止', exact: true }),
      )
    })
    const interruptedText = '調査を中断しました。資料は保存されていません。'
    await waitFor(() => {
      if (exactRoleText('status', interruptedText) !== interruptedText)
        throw new Error('The interrupted state was not shown')
    })

    const readResult = () => ({
      activeProgress,
      requestAborted: activeRequestSignal.aborted,
      sources: listSources(doc),
      evidence: listEvidence(doc),
    })
    expect(readResult()).toEqual({
      activeProgress: {
        requestCount: 1,
        progressTitle: '調べています',
        cancelButtons: 1,
      },
      requestAborted: true,
      sources: [],
      evidence: [],
    })
  })

  it('keeps active claim cancellation when an adopted recheck hits a lock conflict', async () => {
    const firstClaim = 'A first sentence.'
    const secondClaim = 'A second sentence.'
    const firstSourceId = 'source-first'
    const replacement = 'A first sentence updated.'
    setBody(doc, `# Research topic\n\n${firstClaim} ${secondClaim}\n`)
    let requestCount = 0
    let recheckCount = 0
    let activeSignal: AbortSignal | undefined
    installFetch((url, init) => {
      if (url === '/api/research/jobs') {
        requestCount += 1
        if (requestCount === 1)
          return serverEvents([
            {
              event: 'result',
              data: {
                analysis: {
                  task: 'claim_evidence',
                  data: {
                    verdict: 'outdated',
                    quote: {
                      source_id: firstSourceId,
                      text: 'An earlier quote.',
                    },
                    suggestion: replacement,
                  },
                },
                sources: [
                  {
                    id: firstSourceId,
                    url: 'https://example.invalid/first',
                    title: 'First source',
                    body: 'A current quote.',
                    status: 'available',
                  },
                ],
              },
            },
          ])
        activeSignal = init.signal ?? undefined
        return new Promise<Response>((_resolve, reject) => {
          activeSignal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Aborted', 'AbortError'))
            },
            { once: true },
          )
        })
      }
      if (url.includes('/source-bodies/' + firstSourceId)) {
        if (url.endsWith('/save-if-unchanged'))
          return new Response(null, { status: 204 })
        return new Response('', { status: 404 })
      }
      if (url === '/api/research/claim-evidence') {
        recheckCount += 1
        return serverEvents([
          {
            event: 'result',
            data: {
              verdict: 'supported',
              quote: { source_id: firstSourceId, text: replacement },
              suggestion: null,
            },
          },
        ])
      }
      return new Response('', { status: 404 })
    })
    await renderApp()
    await openArticle()
    await openBodyRequestPreset(firstClaim, '根拠を確かめる')
    await waitFor(() => {
      if (!host?.querySelector('.suggestion-diff-note'))
        throw new Error('The first claim proposal was not rendered')
    })
    await openBodyRequestPreset(secondClaim, '根拠を確かめる')
    await waitFor(() => {
      if (!activeSignal) throw new Error('The second claim check did not start')
    })
    const proposalMarker = host?.querySelector<HTMLElement>(
      '.cm-suggestion-marker',
    )
    if (!proposalMarker) throw new Error('The first claim proposal is missing')
    await act(async () => {
      await userEvent.click(proposalMarker)
    })
    await waitFor(() => {
      if (!host?.querySelector('.suggestion-diff-note'))
        throw new Error('The first claim proposal did not regain focus')
    })
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '採用 Tab' }))
    })
    const lockError = '別の調査が実行中のため、根拠を再判定できませんでした。'
    await waitFor(() => {
      if (exactRoleText('alert', lockError) !== lockError)
        throw new Error('The recheck conflict was not shown separately')
    })
    await act(async () => {
      await userEvent.click(page.getByRole('tab', { name: '資料' }))
    })
    const activeProgress = {
      requestCount,
      recheckCount,
      progressTitle: document.body.querySelector(
        '[aria-labelledby="source-panel-heading"] h3',
      )?.textContent,
      cancelButtons: [...document.body.querySelectorAll('button')].filter(
        (button) => button.textContent.trim() === '中止',
      ).length,
      error: exactRoleText('alert', lockError),
      requestAborted: activeSignal?.aborted,
    }

    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: '中止', exact: true }),
      )
    })
    const interruptedText = '調査を中断しました。資料は保存されていません。'
    await waitFor(() => {
      if (exactRoleText('status', interruptedText) !== interruptedText)
        throw new Error('The active claim check did not remain cancellable')
    })

    const readResult = () => ({
      activeProgress,
      requestAborted: activeSignal?.aborted,
      sources: listSources(doc).map(({ id, title, status }) => ({
        id,
        title,
        status,
      })),
      evidence: listEvidence(doc).map(
        ({ currentClaim, quote, sourceId, verdict }) => ({
          currentClaim,
          quote,
          sourceId,
          verdict,
        }),
      ),
      recheckError: exactRoleText('alert', lockError),
      interruptedMessage: exactRoleText('status', interruptedText),
    })
    expect(readResult()).toEqual({
      activeProgress: {
        requestCount: 2,
        recheckCount: 0,
        progressTitle: '調べています',
        cancelButtons: 1,
        error: lockError,
        requestAborted: false,
      },
      requestAborted: true,
      sources: [{ id: firstSourceId, title: 'First source', status: 'ready' }],
      evidence: [
        {
          currentClaim: replacement,
          quote: '',
          sourceId: firstSourceId,
          verdict: 'insufficient',
        },
      ],
      recheckError: lockError,
      interruptedMessage: interruptedText,
    })
  })

  it('rolls back source bodies when cancelled while saving research results', async () => {
    const claim = 'A sentence to edit.'
    const rollbackRequests: Array<{ id: string; body: unknown }> = []
    let resolveSecondSave: (() => void) | undefined
    const secondSaveStarted = new Promise<void>((resolve) => {
      resolveSecondSave = resolve
    })
    installFetch((url, init) => {
      if (url === '/api/research/jobs')
        return serverEvents([
          {
            event: 'result',
            data: {
              analysis: {
                task: 'claim_evidence',
                data: {
                  verdict: 'supported',
                  quote: {
                    source_id: 'source-one',
                    text: 'First source quote.',
                  },
                  suggestion: null,
                },
              },
              sources: [
                {
                  id: 'source-one',
                  url: 'https://example.invalid/first',
                  title: 'First source',
                  status: 'available',
                  body: 'First source body.',
                },
                {
                  id: 'source-two',
                  url: 'https://example.invalid/second',
                  title: 'Second source',
                  status: 'available',
                  body: 'Second source body.',
                },
              ],
            },
          },
        ])
      const sourceId = url.split('/source-bodies/')[1]?.split('/')[0] ?? ''
      if (init.method === undefined) return new Response('', { status: 404 })
      if (
        init.method === 'POST' &&
        url.endsWith('/save-if-unchanged') &&
        sourceId === 'source-one'
      )
        return new Response(null, { status: 204 })
      if (
        init.method === 'POST' &&
        url.endsWith('/save-if-unchanged') &&
        sourceId === 'source-two'
      ) {
        resolveSecondSave?.()
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Aborted', 'AbortError'))
            },
            { once: true },
          )
        })
      }
      if (init.method === 'POST' && url.endsWith('/restore')) {
        rollbackRequests.push({
          id: sourceId,
          body:
            typeof init.body === 'string'
              ? (JSON.parse(init.body) as unknown)
              : init.body,
        })
        return new Response(null, { status: 204 })
      }
      return new Response('', { status: 404 })
    })
    await renderApp()
    await openArticle()
    await openBodyRequestPreset(claim, '根拠を確かめる')
    await secondSaveStarted
    await waitFor(() => {
      if (
        ![...document.body.querySelectorAll('button')].some(
          (button) => button.textContent.trim() === '中止',
        )
      )
        throw new Error('The source save could not be cancelled')
    })
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '中止' }))
    })
    const interruptedText = '調査を中断しました。資料は保存されていません。'
    await waitFor(() => {
      if (exactRoleText('status', interruptedText) !== interruptedText)
        throw new Error('The interrupted state was not shown')
    })

    const readResult = () => ({
      rollbackRequests,
      sources: listSources(doc),
      evidence: listEvidence(doc),
      interruptedMessage: exactRoleText('status', interruptedText),
    })
    expect(readResult()).toEqual({
      rollbackRequests: [
        {
          id: 'source-one',
          body: { expected_body: 'First source body.', restore_body: null },
        },
        {
          id: 'source-two',
          body: { expected_body: 'Second source body.', restore_body: null },
        },
      ],
      sources: [],
      evidence: [],
      interruptedMessage: interruptedText,
    })
  })

  it('rolls back saved sources when cancelled after the document save', async () => {
    const claim = 'A sentence to edit.'
    const sourceId = 'source-saved-before-cancel'
    const rollbackRequests: Array<{ id: string; body: unknown }> = []
    let requestSignal: AbortSignal | undefined
    let cancellationSent = false
    const sources = doc.getMap('sources')
    const cancelAfterSourceSave = () => {
      if (cancellationSent || !sources.has(sourceId)) return
      cancellationSent = true
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    }
    sources.observeDeep(cancelAfterSourceSave)
    installFetch((url, init) => {
      if (url === '/api/research/jobs') {
        requestSignal = init.signal ?? undefined
        return serverEvents([
          {
            event: 'result',
            data: {
              analysis: {
                task: 'claim_evidence',
                data: {
                  verdict: 'supported',
                  quote: { source_id: sourceId, text: 'A verified quote.' },
                  suggestion: null,
                },
              },
              sources: [
                {
                  id: sourceId,
                  url: 'https://example.invalid/research',
                  title: 'Research source',
                  body: 'A verified quote.',
                  status: 'available',
                },
              ],
            },
          },
        ])
      }
      if (url.includes('/source-bodies/' + sourceId)) {
        if (url.endsWith('/save-if-unchanged'))
          return new Response(null, { status: 204 })
        if (url.endsWith('/restore')) {
          rollbackRequests.push({
            id: sourceId,
            body:
              typeof init.body === 'string'
                ? (JSON.parse(init.body) as unknown)
                : init.body,
          })
          return new Response(null, { status: 204 })
        }
        return new Response('', { status: 404 })
      }
      return new Response('', { status: 404 })
    })
    await renderApp()
    await openArticle()
    await openBodyRequestPreset(claim, '根拠を確かめる')
    const interruptedText = '調査を中断しました。資料は保存されていません。'
    await waitFor(() => {
      if (exactRoleText('status', interruptedText) !== interruptedText)
        throw new Error('The post-save cancellation was not shown')
    })
    sources.unobserveDeep(cancelAfterSourceSave)

    const readResult = () => ({
      rollbackRequests,
      requestAborted: requestSignal?.aborted,
      sources: listSources(doc),
      evidence: listEvidence(doc),
      interruptedMessage: exactRoleText('status', interruptedText),
    })
    expect(readResult()).toEqual({
      rollbackRequests: [
        {
          id: sourceId,
          body: { expected_body: 'A verified quote.', restore_body: null },
        },
      ],
      requestAborted: true,
      sources: [],
      evidence: [],
      interruptedMessage: interruptedText,
    })
  })

  it('preserves a saved source referenced by evidence added during cancellation', async () => {
    const claim = 'A sentence to edit.'
    const sourceId = 'source-saved-before-cancel'
    const bodySaveRequests: unknown[] = []
    const rollbackRequests: unknown[] = []
    let requestSignal: AbortSignal | undefined
    let sourceBody: string | undefined
    let cancellationSent = false
    const sources = doc.getMap('sources')
    const cancelAfterSourceSave = () => {
      if (cancellationSent || !sources.has(sourceId)) return
      cancellationSent = true
      const from = getBody(doc).toJSON().indexOf(claim)
      addEvidence(doc, {
        id: 'concurrent-evidence',
        from,
        to: from + claim.length,
        claim,
        sourceId,
        quote: 'A quote added by a collaborator.',
        verdict: 'supported',
        checkedAt: '2026-11-07T00:00:00.000Z',
      })._unsafeUnwrap()
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    }
    sources.observeDeep(cancelAfterSourceSave)
    installFetch((url, init) => {
      if (url === '/api/research/jobs') {
        requestSignal = init.signal ?? undefined
        return serverEvents([
          {
            event: 'result',
            data: {
              analysis: {
                task: 'claim_evidence',
                data: {
                  verdict: 'supported',
                  quote: { source_id: sourceId, text: 'A verified quote.' },
                  suggestion: null,
                },
              },
              sources: [
                {
                  id: sourceId,
                  url: 'https://example.invalid/research',
                  title: 'Research source',
                  body: 'A verified quote.',
                  status: 'available',
                  published_at: '2025-03-04',
                },
              ],
            },
          },
        ])
      }
      if (url.includes('/source-bodies/' + sourceId)) {
        if (init.method === undefined)
          return sourceBody === undefined
            ? new Response('', { status: 404 })
            : new Response(
                JSON.stringify({
                  article_id: article.id,
                  source_id: sourceId,
                  body: sourceBody,
                }),
              )
        if (url.endsWith('/save-if-unchanged')) {
          const body = parseObjectBody(init.body)
          bodySaveRequests.push(body)
          sourceBody = typeof body?.['body'] === 'string' ? body['body'] : ''
          return new Response(null, { status: 204 })
        }
        if (url.endsWith('/restore')) {
          const body = parseObjectBody(init.body)
          rollbackRequests.push(body)
          sourceBody =
            typeof body?.['restore_body'] === 'string'
              ? body['restore_body']
              : undefined
          return new Response(null, { status: 204 })
        }
        return new Response('', { status: 404 })
      }
      return new Response('', { status: 404 })
    })
    await renderApp()
    await openArticle()
    await openBodyRequestPreset(claim, '根拠を確かめる')
    const interruptedText =
      '調査を中断しました。共同編集の情報を守るため、関連する資料を保持しました。'
    await waitFor(() => {
      if (exactRoleText('status', interruptedText) !== interruptedText)
        throw new Error('The post-save cancellation was not shown')
    })
    sources.unobserveDeep(cancelAfterSourceSave)

    const readResult = () => ({
      bodySaveRequests,
      rollbackRequests,
      sourceBody: sourceBody ?? null,
      requestAborted: requestSignal?.aborted,
      sources: listSources(doc).map(({ checkedAt, ...source }) => ({
        ...source,
        checkedAt: checkedAt === null ? null : 'saved',
      })),
      evidence: listEvidence(doc).map(
        ({
          id,
          currentClaim,
          sourceId,
          quote,
          verdict,
          checkedAt,
          edited,
        }) => ({
          id,
          currentClaim,
          sourceId,
          quote,
          verdict,
          checkedAt,
          edited,
        }),
      ),
      interruptedMessage: exactRoleText('status', interruptedText),
    })
    expect(readResult()).toEqual({
      bodySaveRequests: [{ expected_body: null, body: 'A verified quote.' }],
      rollbackRequests: [],
      sourceBody: 'A verified quote.',
      requestAborted: true,
      sources: [
        {
          id: sourceId,
          kind: 'url',
          title: 'Research source',
          url: 'https://example.invalid/research',
          fileName: null,
          checkedAt: 'saved',
          publishedAt: '2025-03-04',
          status: 'ready',
          summary: '',
        },
      ],
      evidence: [
        {
          id: 'concurrent-evidence',
          currentClaim: claim,
          sourceId,
          quote: 'A quote added by a collaborator.',
          verdict: 'supported',
          checkedAt: '2026-11-07T00:00:00.000Z',
          edited: false,
        },
      ],
      interruptedMessage: interruptedText,
    })
  })

  it('restores an existing source without removing findings added during the check', async () => {
    const claim = 'A sentence to edit.'
    const sourceId = 'source-existing'
    const researchId = 'source-research'
    const rollbackRequests: Array<{ id: string; body: unknown }> = []
    let requestSignal: AbortSignal | undefined
    let cancellationSent = false
    const sources = doc.getMap('sources')
    const cancelAfterSourceUpdate = () => {
      const source = listSources(doc).find(({ id }) => id === sourceId)
      if (cancellationSent || source?.status !== 'ready') return
      cancellationSent = true
      setFindings(doc, sourceId, [
        {
          id: 'collaborative-finding',
          text: 'A finding added during the check.',
          quote: 'A quote from a collaborator.',
        },
      ])._unsafeUnwrap()
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    }
    addSource(doc, {
      id: sourceId,
      kind: 'url',
      title: 'Existing source',
      url: 'https://example.invalid/research',
      fileName: null,
      checkedAt: null,
      status: 'unavailable',
      summary: 'Original summary.',
    })._unsafeUnwrap()
    sources.observeDeep(cancelAfterSourceUpdate)
    installFetch((url, init) => {
      if (url === '/api/research/jobs') {
        requestSignal = init.signal ?? undefined
        return serverEvents([
          {
            event: 'result',
            data: {
              analysis: {
                task: 'claim_evidence',
                data: {
                  verdict: 'supported',
                  quote: { source_id: researchId, text: 'A verified quote.' },
                  suggestion: null,
                },
              },
              sources: [
                {
                  id: researchId,
                  url: 'https://example.invalid/research',
                  title: 'Existing source',
                  body: 'A verified quote.',
                  status: 'available',
                },
              ],
            },
          },
        ])
      }
      if (url.includes('/source-bodies/' + sourceId)) {
        if (url.endsWith('/save-if-unchanged'))
          return new Response(null, { status: 204 })
        if (url.endsWith('/restore')) {
          rollbackRequests.push({
            id: sourceId,
            body:
              typeof init.body === 'string'
                ? (JSON.parse(init.body) as unknown)
                : init.body,
          })
          return new Response(null, { status: 204 })
        }
        return new Response('', { status: 404 })
      }
      return new Response('', { status: 404 })
    })
    await renderApp()
    await openArticle()
    await openBodyRequestPreset(claim, '根拠を確かめる')
    const interruptedText = '調査を中断しました。資料は保存されていません。'
    await waitFor(() => {
      if (exactRoleText('status', interruptedText) !== interruptedText)
        throw new Error('The existing source rollback was not shown')
    })
    sources.unobserveDeep(cancelAfterSourceUpdate)

    const readResult = () => ({
      rollbackRequests,
      requestAborted: requestSignal?.aborted,
      sources: listSources(doc).map(
        ({ id, title, url, checkedAt, status, summary }) => ({
          id,
          title,
          url,
          checkedAt,
          status,
          summary,
        }),
      ),
      findings: listFindings(doc).map(({ id, sourceId, text, quote }) => ({
        id,
        sourceId,
        text,
        quote,
      })),
      evidence: listEvidence(doc),
      interruptedMessage: exactRoleText('status', interruptedText),
    })
    expect(readResult()).toEqual({
      rollbackRequests: [
        {
          id: sourceId,
          body: { expected_body: 'A verified quote.', restore_body: null },
        },
      ],
      requestAborted: true,
      sources: [
        {
          id: sourceId,
          title: 'Existing source',
          url: 'https://example.invalid/research',
          checkedAt: null,
          status: 'unavailable',
          summary: 'Original summary.',
        },
      ],
      findings: [
        {
          id: 'collaborative-finding',
          sourceId,
          text: 'A finding added during the check.',
          quote: 'A quote from a collaborator.',
        },
      ],
      evidence: [],
      interruptedMessage: interruptedText,
    })
  })

  it('starts heading research from a blank body request preset', async () => {
    setBody(
      doc,
      '# Root\n\n## Research topic\n\nA sentence to edit.\n\n## Later section\n\nA later sentence.\n',
    )
    let requestBody: unknown
    installFetch((url, init) => {
      if (url === '/api/research/jobs') {
        if (typeof init.body === 'string')
          requestBody = JSON.parse(init.body) as unknown
        return serverEvents([
          {
            event: 'result',
            data: {
              analysis: { task: 'key_points', data: { sources: [] } },
              sources: [],
            },
          },
        ])
      }
      return new Response('', { status: 404 })
    })
    await renderApp()
    await openArticle()
    const editorContent = host?.querySelector<HTMLElement>('.cm-content')
    if (!editorContent) throw new Error('The article editor did not render')
    const editorView = EditorView.findFromDOM(editorContent)
    if (!editorView) throw new Error('The article editor view did not render')
    const articleBody = getBody(doc).toJSON()
    editorView.dispatch({
      selection: { anchor: articleBody.indexOf('## Research topic') + 4 },
    })
    editorView.focus()
    const modifier = navigator.platform.includes('Mac') ? 'metaKey' : 'ctrlKey'
    act(() => {
      editorView.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          key: 'k',
          [modifier]: true,
        }),
      )
    })
    await act(async () => {
      await userEvent.click(
        page
          .getByRole('group', { name: '定型の依頼' })
          .getByRole('button', { name: 'この見出しについて調べる' }),
      )
    })
    await waitFor(() => {
      if (requestBody === undefined) throw new Error('Research did not start')
    })

    const readResult = () => ({
      requestBody,
      articleBody: getBody(doc).toJSON(),
      sourceCount: listSources(doc).length,
      findingCount: listFindings(doc).length,
    })
    expect(readResult()).toEqual({
      requestBody: { task: 'key_points', question: 'Research topic' },
      articleBody,
      sourceCount: 0,
      findingCount: 0,
    })
  })

  it('routes heading research through the configured local bridge', async () => {
    window.localStorage.setItem('blog-writer.llm.route', 'local')
    window.localStorage.setItem(
      'blog-writer.llm.bridge-url',
      'http://localhost:4141',
    )
    let requestUrl: string | undefined
    let requestBody: unknown
    installFetch((url, init) => {
      requestUrl = url
      if (typeof init.body === 'string')
        requestBody = JSON.parse(init.body) as unknown
      return serverEvents([
        {
          event: 'result',
          data: {
            analysis: {
              task: 'key_points',
              data: {
                sources: [
                  {
                    id: 'source-local',
                    summary: 'A local source summary.',
                    key_points: [],
                  },
                ],
              },
            },
            sources: [
              {
                id: 'source-local',
                url: 'https://example.invalid/local',
                title: null,
                status: 'unavailable',
                body: null,
              },
            ],
          },
        },
      ])
    })
    await renderApp()
    await openArticle()
    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: 'Research topic' }),
      )
      await userEvent.click(
        page.getByRole('button', { name: 'この見出しについて調べる' }),
      )
    })
    await waitFor(() => {
      if (requestBody === undefined) throw new Error('Research did not start')
    })

    const readResult = () => ({
      requestUrl,
      requestBody,
      sources: listSources(doc).map(({ id, title, url, status, summary }) => ({
        id,
        title,
        url,
        status,
        summary,
      })),
    })
    expect(readResult()).toEqual({
      requestUrl: 'http://localhost:4141/api/research/jobs',
      requestBody: { task: 'key_points', question: 'Research topic' },
      sources: [
        {
          id: 'source-local',
          title: 'example.invalid',
          url: 'https://example.invalid/local',
          status: 'unavailable',
          summary: 'A local source summary.',
        },
      ],
    })
  })

  it('does not write sources when an existing source body cannot be read', async () => {
    const sourceId = 'source-existing'
    addSource(doc, {
      id: sourceId,
      kind: 'url',
      title: 'Existing source',
      url: 'https://example.invalid/research',
      fileName: null,
      checkedAt: '2026-02-01T00:00:00.000Z',
      status: 'unavailable',
      summary: 'Earlier summary.',
    })._unsafeUnwrap()
    setFindings(doc, sourceId, [
      {
        id: 'finding-existing',
        researchedHeading: 'Earlier heading',
        text: 'Earlier finding.',
        quote: 'Earlier quote.',
      },
    ])._unsafeUnwrap()
    let bodyReadCount = 0
    let bodyWriteCount = 0
    installFetch((url, init) => {
      if (url === '/api/research/jobs')
        return serverEvents([
          {
            event: 'result',
            data: {
              analysis: {
                task: 'key_points',
                data: {
                  sources: [
                    {
                      id: sourceId,
                      summary: 'New summary.',
                      key_points: [
                        { text: 'New finding.', quote: 'New quote.' },
                      ],
                    },
                  ],
                },
              },
              sources: [
                {
                  id: sourceId,
                  url: 'https://example.invalid/research',
                  final_url: 'https://example.invalid/research',
                  title: 'Research source',
                  status: 'available',
                  body: 'Research body.',
                },
              ],
            },
          },
        ])
      if (init.method === undefined) {
        bodyReadCount += 1
        return new Response('', { status: 500 })
      }
      if (init.method === 'PUT' || init.method === 'POST') bodyWriteCount += 1
      return new Response('', { status: 404 })
    })
    await renderApp()
    await openArticle()
    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: 'Research topic' }),
      )
      await userEvent.click(
        page.getByRole('button', { name: 'この見出しについて調べる' }),
      )
    })
    const readError = '資料本文を読み込めませんでした: HTTP 500'
    await waitFor(() => {
      if (exactRoleText('alert', readError) !== readError)
        throw new Error('The source body read error was not shown')
    })

    const readResult = () => ({
      bodyReadCount,
      bodyWriteCount,
      sources: listSources(doc),
      findings: listFindings(doc),
      errorMessage: exactRoleText('alert', readError),
    })
    expect(readResult()).toEqual({
      bodyReadCount: 1,
      bodyWriteCount: 0,
      sources: [
        {
          id: sourceId,
          kind: 'url',
          title: 'Existing source',
          url: 'https://example.invalid/research',
          fileName: null,
          checkedAt: '2026-02-01T00:00:00.000Z',
          publishedAt: null,
          status: 'unavailable',
          summary: 'Earlier summary.',
        },
      ],
      findings: [
        {
          id: 'finding-existing',
          sourceId,
          researchedHeading: 'Earlier heading',
          text: 'Earlier finding.',
          quote: 'Earlier quote.',
        },
      ],
      errorMessage: readError,
    })
  })

  it('restores an existing source body when a later body save fails', async () => {
    addSource(doc, {
      id: 'source-one',
      kind: 'url',
      title: 'First source',
      url: 'https://example.invalid/first',
      fileName: null,
      checkedAt: '2026-02-01T00:00:00.000Z',
      status: 'unavailable',
      summary: 'Earlier summary.',
    })._unsafeUnwrap()
    setFindings(doc, 'source-one', [
      {
        id: 'finding-existing',
        text: 'Earlier finding.',
        quote: 'Earlier quote.',
      },
    ])._unsafeUnwrap()
    const savedBodies: Array<{ id: string; body: unknown }> = []
    const rollbackRequests: Array<{ id: string; body: unknown }> = []
    installFetch((url, init) => {
      if (url === '/api/research/jobs')
        return serverEvents([
          {
            event: 'result',
            data: {
              analysis: {
                task: 'key_points',
                data: {
                  sources: [
                    {
                      id: 'source-one',
                      summary: 'First summary.',
                      key_points: [],
                    },
                    {
                      id: 'source-two',
                      summary: 'Second summary.',
                      key_points: [],
                    },
                  ],
                },
              },
              sources: [
                {
                  id: 'source-one',
                  url: 'https://example.invalid/first',
                  title: 'First source',
                  status: 'available',
                  body: 'First source body.',
                },
                {
                  id: 'source-two',
                  url: 'https://example.invalid/second',
                  title: 'Second source',
                  status: 'available',
                  body: 'Second source body.',
                },
              ],
            },
          },
        ])
      const sourceId = url.split('/source-bodies/')[1] ?? ''
      const sourceBaseId = sourceId.split('/')[0] ?? ''
      if (init.method === 'POST' && url.endsWith('/save-if-unchanged')) {
        savedBodies.push({
          id: sourceBaseId,
          body:
            typeof init.body === 'string'
              ? (JSON.parse(init.body) as unknown)
              : init.body,
        })
        return sourceBaseId === 'source-two'
          ? new Response('error', { status: 500 })
          : new Response(null, { status: 204 })
      }
      if (init.method === undefined && sourceBaseId === 'source-one')
        return new Response(
          JSON.stringify({
            source_id: sourceId,
            article_id: article.id,
            body: 'Existing source body.',
          }),
        )
      if (init.method === 'POST' && url.endsWith('/restore')) {
        rollbackRequests.push({
          id: sourceId.split('/')[0] ?? '',
          body:
            typeof init.body === 'string'
              ? (JSON.parse(init.body) as unknown)
              : init.body,
        })
        return new Response(null, { status: 204 })
      }
      return new Response('', { status: 404 })
    })
    await renderApp()
    await openArticle()
    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: 'Research topic' }),
      )
      await userEvent.click(
        page.getByRole('button', { name: 'この見出しについて調べる' }),
      )
    })
    const saveError = '資料本文を保存できませんでした: HTTP 500'
    await waitFor(() => {
      if (exactRoleText('alert', saveError) !== saveError)
        throw new Error('The source body save error was not shown')
    })

    const readResult = () => ({
      savedBodies,
      rollbackRequests,
      sources: listSources(doc).map(({ id, status, summary }) => ({
        id,
        status,
        summary,
      })),
      findings: listFindings(doc).map(({ sourceId, text, quote }) => ({
        sourceId,
        text,
        quote,
      })),
      errorMessage: exactRoleText('alert', saveError),
    })
    expect(readResult()).toEqual({
      savedBodies: [
        {
          id: 'source-one',
          body: {
            expected_body: 'Existing source body.',
            body: 'First source body.',
          },
        },
        {
          id: 'source-two',
          body: { expected_body: null, body: 'Second source body.' },
        },
      ],
      rollbackRequests: [
        {
          id: 'source-one',
          body: {
            expected_body: 'First source body.',
            restore_body: 'Existing source body.',
          },
        },
        {
          id: 'source-two',
          body: {
            expected_body: 'Second source body.',
            restore_body: null,
          },
        },
      ],
      sources: [
        {
          id: 'source-one',
          status: 'unavailable',
          summary: 'Earlier summary.',
        },
      ],
      findings: [
        {
          sourceId: 'source-one',
          text: 'Earlier finding.',
          quote: 'Earlier quote.',
        },
      ],
      errorMessage: saveError,
    })
  })

  it('cancels during body saving and leaves no research results', async () => {
    const rollbackRequests: Array<{ id: string; body: unknown }> = []
    let resolveSecondSave: (() => void) | undefined
    const secondSaveStarted = new Promise<void>((resolve) => {
      resolveSecondSave = resolve
    })
    installFetch((url, init) => {
      if (url === '/api/research/jobs')
        return serverEvents([
          {
            event: 'result',
            data: {
              analysis: {
                task: 'key_points',
                data: {
                  sources: [
                    {
                      id: 'source-one',
                      summary: 'First summary.',
                      key_points: [
                        { text: 'First finding.', quote: 'First quote.' },
                      ],
                    },
                    {
                      id: 'source-two',
                      summary: 'Second summary.',
                      key_points: [
                        { text: 'Second finding.', quote: 'Second quote.' },
                      ],
                    },
                  ],
                },
              },
              sources: [
                {
                  id: 'source-one',
                  url: 'https://example.invalid/first',
                  title: 'First source',
                  status: 'available',
                  body: 'First source body.',
                },
                {
                  id: 'source-two',
                  url: 'https://example.invalid/second',
                  title: 'Second source',
                  status: 'available',
                  body: 'Second source body.',
                },
              ],
            },
          },
        ])
      const sourceId = url.split('/source-bodies/')[1]?.split('/')[0] ?? ''
      if (init.method === undefined) return new Response('', { status: 404 })
      if (
        init.method === 'POST' &&
        url.endsWith('/save-if-unchanged') &&
        sourceId === 'source-one'
      )
        return new Response(null, { status: 204 })
      if (
        init.method === 'POST' &&
        url.endsWith('/save-if-unchanged') &&
        sourceId === 'source-two'
      ) {
        resolveSecondSave?.()
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Aborted', 'AbortError'))
            },
            { once: true },
          )
        })
      }
      if (init.method === 'POST' && url.endsWith('/restore')) {
        rollbackRequests.push({
          id: sourceId.split('/')[0] ?? '',
          body:
            typeof init.body === 'string'
              ? (JSON.parse(init.body) as unknown)
              : init.body,
        })
        return new Response(null, { status: 204 })
      }
      return new Response('', { status: 404 })
    })
    await renderApp()
    await openArticle()
    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: 'Research topic' }),
      )
      await userEvent.click(
        page.getByRole('button', { name: 'この見出しについて調べる' }),
      )
    })
    await secondSaveStarted
    await waitFor(() => {
      if (
        ![...document.body.querySelectorAll('button')].some(
          (button) => button.textContent.trim() === '中止',
        )
      )
        throw new Error('The body save could not be cancelled')
    })
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '中止' }))
    })
    const interruptedText = '調査を中断しました。資料は保存されていません。'
    await waitFor(() => {
      if (exactRoleText('status', interruptedText) !== interruptedText)
        throw new Error('The interrupted state was not shown')
    })

    const readResult = () => ({
      rollbackRequests,
      sources: listSources(doc),
      findings: listFindings(doc),
      interruptedMessage: exactRoleText('status', interruptedText),
      alerts: [...document.body.querySelectorAll('[role="alert"]')].map(
        (element) => element.textContent.trim(),
      ),
    })
    expect(readResult()).toEqual({
      rollbackRequests: [
        {
          id: 'source-one',
          body: {
            expected_body: 'First source body.',
            restore_body: null,
          },
        },
        {
          id: 'source-two',
          body: {
            expected_body: 'Second source body.',
            restore_body: null,
          },
        },
      ],
      sources: [],
      findings: [],
      interruptedMessage: interruptedText,
      alerts: [],
    })
  })

  it('keeps source updates made while research is saving its body', async () => {
    const url = 'https://example.invalid/research'
    const sourceId = 'source-existing'
    addSource(doc, {
      id: sourceId,
      kind: 'url',
      title: 'Existing source',
      url,
      fileName: null,
      checkedAt: '2026-02-01T00:00:00.000Z',
      status: 'unavailable',
      summary: 'Earlier summary.',
    })._unsafeUnwrap()
    let resolveBodySave: ((response: Response) => void) | undefined
    let resolveSaveStarted: (() => void) | undefined
    const bodySaveStarted = new Promise<void>((resolve) => {
      resolveSaveStarted = resolve
    })
    const bodyWrites: Array<{ body: string }> = []
    const rollbackRequests: Array<{ id: string; body: unknown }> = []
    let currentBody: string | undefined = 'Existing source body.'
    installFetch((requestUrl, init) => {
      if (requestUrl === '/api/research/jobs')
        return serverEvents([
          {
            event: 'result',
            data: {
              analysis: {
                task: 'key_points',
                data: {
                  sources: [
                    {
                      id: sourceId,
                      summary: 'Research summary.',
                      key_points: [
                        { text: 'Research finding.', quote: 'Research quote.' },
                      ],
                    },
                  ],
                },
              },
              sources: [
                {
                  id: sourceId,
                  url,
                  final_url: url,
                  title: 'Research source',
                  status: 'available',
                  body: 'New source body.',
                },
              ],
            },
          },
        ])
      if (init.method === undefined)
        return new Response(
          JSON.stringify({
            source_id: sourceId,
            article_id: article.id,
            body: currentBody,
          }),
        )
      if (init.method === 'POST' && requestUrl.endsWith('/save-if-unchanged')) {
        const body = parseObjectBody(init.body)
        const expectedBody = body?.['expected_body']
        const nextBody = body?.['body']
        if (
          typeof nextBody !== 'string' ||
          !(expectedBody === null || typeof expectedBody === 'string')
        )
          return new Response('', { status: 400 })
        if (currentBody !== (expectedBody ?? undefined))
          return new Response('', { status: 409 })
        bodyWrites.push({ body: nextBody })
        currentBody = nextBody
        if (bodyWrites.length === 1) {
          resolveSaveStarted?.()
          return new Promise<Response>((resolve) => {
            resolveBodySave = resolve
          })
        }
        return new Response(null, { status: 204 })
      }
      if (init.method === 'PUT') {
        const body = parseObjectBody(init.body)?.['body']
        if (typeof body !== 'string') return new Response('', { status: 400 })
        bodyWrites.push({ body })
        currentBody = body
        return new Response(null, { status: 204 })
      }
      if (init.method === 'POST' && requestUrl.endsWith('/restore')) {
        const body = parseObjectBody(init.body)
        const expectedBody = body?.['expected_body']
        const restoreBody = body?.['restore_body']
        if (
          typeof expectedBody !== 'string' ||
          !(restoreBody === null || typeof restoreBody === 'string')
        )
          return new Response('', { status: 400 })
        const requestBody = {
          expected_body: expectedBody,
          restore_body: restoreBody,
        }
        rollbackRequests.push({
          id: sourceId.split('/')[0] ?? '',
          body: requestBody,
        })
        if (currentBody !== requestBody.expected_body)
          return new Response('', { status: 409 })
        currentBody = requestBody.restore_body ?? undefined
        return new Response(null, { status: 204 })
      }
      return new Response('', { status: 404 })
    })
    await renderApp()
    await openArticle()
    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: 'Research topic' }),
      )
      await userEvent.click(
        page.getByRole('button', { name: 'この見出しについて調べる' }),
      )
    })
    await bodySaveStarted
    await act(async () => {
      await fetch(`/api/articles/${article.id}/source-bodies/${sourceId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'Pasted source body.' }),
      })
      updateSource(doc, sourceId, {
        status: 'ready',
        summary: 'Concurrent summary.',
        checkedAt: '2026-03-01T00:00:00.000Z',
      })._unsafeUnwrap()
    })
    const finishBodySave = resolveBodySave
    if (finishBodySave === undefined)
      throw new Error('The source body save did not start')
    act(() => {
      finishBodySave(new Response(null, { status: 204 }))
    })
    await waitFor(() => {
      if (rollbackRequests.length !== 1)
        throw new Error('The changed source body was not checked')
    })
    const changeError =
      '資料本文が別の操作で変更されたため、調査結果を保存できませんでした。'
    await waitFor(() => {
      if (exactRoleText('alert', changeError) !== changeError)
        throw new Error('The concurrent source update was not preserved')
    })

    const readResult = () => ({
      bodyWrites,
      rollbackRequests,
      currentBody,
      sources: listSources(doc).map(({ id, status, summary, checkedAt }) => ({
        id,
        status,
        summary,
        checkedAt,
      })),
      findings: listFindings(doc),
      errorMessage: exactRoleText('alert', changeError),
    })
    expect(readResult()).toEqual({
      bodyWrites: [
        { body: 'New source body.' },
        { body: 'Pasted source body.' },
      ],
      rollbackRequests: [
        {
          id: sourceId,
          body: {
            expected_body: 'New source body.',
            restore_body: 'Existing source body.',
          },
        },
      ],
      currentBody: 'Pasted source body.',
      sources: [
        {
          id: sourceId,
          status: 'ready',
          summary: 'Concurrent summary.',
          checkedAt: '2026-03-01T00:00:00.000Z',
        },
      ],
      findings: [],
      errorMessage: changeError,
    })
  })

  it('opens the body request from the mobile toolbar', async () => {
    await page.viewport(375, 812)
    setBody(doc, 'A useful paragraph.\n')
    await renderApp()
    await openArticle()
    await act(async () => {
      await userEvent.click(
        page
          .getByRole('toolbar', { name: '入力補助' })
          .getByRole('button', { name: '依頼' }),
      )
    })

    const readRequest = () => ({
      requestOpen: document.querySelector('#body-request') !== null,
    })
    expect(readRequest()).toEqual({ requestOpen: true })
  })

  it('keeps outline proposals when showing heading research controls', async () => {
    await page.viewport(375, 812)
    installFetch((url) =>
      url === '/api/proposals/outline'
        ? proposalResponse()
        : new Response('', { status: 404 }),
    )
    setBody(
      doc,
      '# Starting point\n\n## Second section\n\nA useful paragraph.\n',
    )
    await renderApp()
    await openArticle()
    await act(async () => {
      await userEvent.click(
        page
          .getByRole('toolbar', { name: '入力補助' })
          .getByRole('button', { name: '構成' }),
      )
    })

    vi.useFakeTimers()
    act(() => {
      setBody(
        doc,
        '# Starting point!\n\n## Second section\n\nA useful paragraph.\n',
      )
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })
    vi.useRealTimers()

    const readOutlineState = () => ({
      outlineCount: host?.querySelectorAll('[aria-label="Article outline"]')
        .length,
      proposalButtons: [...(host?.querySelectorAll('button') ?? [])]
        .map((button) => button.getAttribute('aria-label') ?? '')
        .filter((label) => /を(採用|却下)$/u.test(label)),
      researchEntryVisible:
        [...(host?.querySelectorAll('button') ?? [])].some(
          (button) => button.textContent.trim() === 'この見出しについて調べる',
        ) ||
        [...(host?.querySelectorAll('p') ?? [])].some(
          (paragraph) =>
            paragraph.textContent.trim() ===
            '見出しを選ぶと、その内容を調べられます。',
        ),
    })
    const proposalState = readOutlineState()

    await act(async () => {
      await userEvent.click(
        page.getByRole('option', { name: /Second section/u }),
      )
    })

    const actual = () => ({
      proposalState,
      toolbar: host
        ?.querySelector('[role="toolbar"]')
        ?.getAttribute('aria-label'),
    })
    expect(actual()).toEqual({
      proposalState: {
        outlineCount: 1,
        proposalButtons: ['改名案を採用', '改名案を却下'],
        researchEntryVisible: true,
      },
      toolbar: '入力補助',
    })
  })

  it('inserts a memo as a heading from the article workspace', async () => {
    installFetch(() => new Response('', { status: 404 }))
    await page.viewport(1280, 800)
    setBody(doc, '# Starting point\n\nA useful paragraph.\n')
    await renderApp()
    await openArticle()
    await act(async () => {
      await userEvent.fill(
        page.getByRole('textbox', { name: 'メモを足す' }),
        'A useful thought',
      )
      await userEvent.keyboard('{Enter}')
      await userEvent.click(
        page.getByRole('button', { name: '採用', exact: true }),
      )
      await userEvent.click(page.getByRole('button', { name: '末尾に追加' }))
    })

    const readResult = () => ({
      body: getBody(doc).toJSON(),
      memos: listMemos(doc).map(({ text, state }) => ({
        text,
        state: state.kind,
      })),
    })
    expect(readResult()).toEqual({
      body: '# Starting point\n\nA useful paragraph.\n\n# A useful thought\n\n',
      memos: [{ text: 'A useful thought', state: 'adopted' }],
    })
  })

  it('moves a body block from the article editor menu', async () => {
    installFetch(() => new Response('', { status: 404 }))
    await page.viewport(1280, 800)
    setBody(doc, '# First section\n\none\n\n# Second section\n\ntwo\n')
    await renderApp()
    await openArticle()
    const moveHandle = page.getByRole('button', { name: 'Move block' }).first()
    await act(async () => {
      await userEvent.click(moveHandle)
    })
    const menuOpened = document.body.querySelector('[role="menu"]') !== null
    await act(async () => {
      await userEvent.click(page.getByRole('menuitem', { name: 'Move down' }))
    })

    const readResult = () => ({
      body: getBody(doc).toJSON(),
      menuOpened,
    })
    expect(readResult()).toEqual({
      body: '# Second section\n\ntwo\n\n# First section\n\none\n',
      menuOpened: true,
    })
  })
})

describe('App body request research context', () => {
  it('sends source summaries and all overlapping evidence quotes', async () => {
    const articleDoc = new Y.Doc()
    doc = articleDoc
    const articleBody =
      '# Starting point\n\nTarget claim.\n\nUnrelated claim.\n'
    setBody(articleDoc, articleBody)
    const sourceId = 'source-a'
    addSource(articleDoc, {
      id: sourceId,
      kind: 'pasted',
      title: 'A source',
      url: 'https://example.invalid/reference',
      fileName: null,
      checkedAt: '2026-01-01T00:00:00Z',
      summary: 'A concise source summary.',
    })._unsafeUnwrap()
    for (const { id, claim, text, quote, verdict } of [
      {
        id: 'evidence-target-supported',
        claim: 'Target claim.',
        text: 'Target claim.',
        quote: 'Evidence for the target claim.',
        verdict: 'supported',
      },
      {
        id: 'evidence-target-outdated',
        claim: 'Target claim.',
        text: 'Target claim.',
        quote: 'An outdated quote for the target claim.',
        verdict: 'outdated',
      },
      {
        id: 'evidence-target-edited',
        claim: 'The previous claim.',
        text: 'Target claim.',
        quote: 'A quote from the edited claim.',
        verdict: 'supported',
      },
      {
        id: 'evidence-unrelated',
        claim: 'Unrelated claim.',
        text: 'Unrelated claim.',
        quote: 'Evidence for an unrelated claim.',
        verdict: 'supported',
      },
    ] as const) {
      const from = articleBody.indexOf(text)
      addEvidence(articleDoc, {
        id,
        from,
        to: from + text.length,
        claim,
        sourceId,
        quote,
        verdict,
        checkedAt: '2026-01-01T00:00:00Z',
      })._unsafeUnwrap()
    }
    let requestBody: unknown
    installFetch((url, init) => {
      if (url === '/api/proposals/body-request') {
        requestBody = parseObjectBody(init.body)
        return new Response(
          'data: {"event":"result","data":{"replacement":"Updated claim."}}\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        )
      }
      return new Response('', { status: 404 })
    })
    await renderApp(articleDoc)

    await openArticle()
    const editor = host?.querySelector<HTMLElement>('.cm-content')
    if (!editor) throw new Error('The article editor did not open')
    const view = EditorView.findFromDOM(editor)
    if (!view) throw new Error('The article editor view did not open')
    const targetFrom = articleBody.indexOf('Target claim.')
    act(() => {
      view.dispatch({
        selection: {
          anchor: targetFrom,
          head: targetFrom + 'Target claim.'.length,
        },
      })
    })

    const modifier = navigator.platform.includes('Mac') ? 'Meta' : 'Control'
    act(() => {
      editor.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          key: 'k',
          [modifier === 'Meta' ? 'metaKey' : 'ctrlKey']: true,
        }),
      )
    })
    const requestInput =
      document.querySelector<HTMLInputElement>('#body-request')
    if (!requestInput) throw new Error('The body request input did not open')
    await act(async () => {
      await userEvent.fill(requestInput, 'Make the claim clearer.')
      await userEvent.keyboard('{Enter}')
      await vi.waitFor(() => {
        if (requestBody === undefined)
          throw new Error('The body request was not sent')
      })
    })

    expect(requestBody).toEqual({
      instruction: 'Make the claim clearer.',
      premise: { audience: '', purpose: '', claim: '' },
      headings: ['# Starting point'],
      section:
        '# Starting point\n\n⟪依頼範囲の開始⟫Target claim.⟪依頼範囲の終了⟫\n\nUnrelated claim.',
      target: 'Target claim.',
      sources: [
        {
          title: 'A source',
          url: 'https://example.invalid/reference',
          summary: 'A concise source summary.',
          checked_at: '2026-01-01T00:00:00Z',
        },
      ],
      evidence_quotes: [
        'Evidence for the target claim.',
        'An outdated quote for the target claim.',
        'A quote from the edited claim.',
      ],
    })
  })
})
describe('App write from key points integration', () => {
  it('keeps the article unchanged when a writing request is canceled', async () => {
    holdWriteResponse = true
    const articleDoc = new Y.Doc()
    doc = articleDoc
    const articleBody = '# Target section\n\nA starter paragraph.'
    setBody(articleDoc, articleBody)
    installFetch(() => new Response('', { status: 404 }))
    await renderApp(articleDoc)

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const appHost = host
    if (!appHost) throw new Error('The app did not render')
    await vi.waitFor(() => {
      if (!appHost.querySelector('.cm-content')) {
        throw new Error('The article editor did not open')
      }
    })
    const editorContent = appHost.querySelector<HTMLElement>('.cm-content')
    if (!editorContent) throw new Error('The article editor did not render')
    const view = EditorView.findFromDOM(editorContent)
    if (!view) throw new Error('The article editor view did not render')
    act(() => {
      view.dispatch({
        selection: { anchor: articleBody.indexOf('A starter paragraph.') },
      })
    })
    const modifier = navigator.platform.includes('Mac') ? 'metaKey' : 'ctrlKey'
    await act(async () => {
      editorContent.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          key: 'k',
          [modifier]: true,
        }),
      )
      await Promise.resolve()
    })
    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: '資料をもとに書く' }),
      )
    })
    await vi.waitFor(() => {
      if (writeRequestSignal === undefined) {
        throw new Error('The writing request did not start')
      }
    })
    await act(async () => {
      editorContent.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
      )
      await Promise.resolve()
    })
    await vi.waitFor(() => {
      if (writeRequestSignal?.aborted !== true) {
        throw new Error('The writing request was not canceled')
      }
    })

    const readOutput = () => ({
      body: getBody(articleDoc).toJSON(),
      evidenceIds: [...articleDoc.getMap('evidence').keys()],
      requestCount: writeRequestCount,
      aborted: writeRequestSignal?.aborted,
    })
    expect(readOutput()).toEqual({
      body: articleBody,
      evidenceIds: [],
      requestCount: 1,
      aborted: true,
    })
  })

  it('saves evidence only after accepting generated factual sentences', async () => {
    const articleDoc = new Y.Doc()
    doc = articleDoc
    const articleBody =
      'Intro paragraph.\n\n# Intro\n\nBefore target.\n\n# Target section\n\n# Target section\n\nA starter paragraph.'
    setBody(articleDoc, articleBody)
    addSource(articleDoc, {
      id: 'source-sample',
      kind: 'url',
      title: 'Sample report',
      url: 'https://example.invalid/report',
      fileName: null,
      checkedAt: '2026-03-01T00:00:00.000Z',
      summary: 'A sample summary.',
    })._unsafeUnwrap()
    addSource(articleDoc, {
      id: 'source-notes',
      kind: 'pasted',
      title: 'Text notes',
      url: null,
      fileName: null,
      checkedAt: '2026-03-02T00:00:00.000Z',
      summary: 'Notes captured from a local document.',
    })._unsafeUnwrap()
    const otherFindings = Array.from({ length: 51 }, (_, index) => ({
      id: `finding-other-${String(index)}`,
      researchedHeading: 'Removed section',
      text: `A note from another section ${String(index)}.`,
      quote: `A quotation from another section ${String(index)}.`,
    }))
    setFindings(articleDoc, 'source-sample', [
      ...otherFindings,
      {
        id: 'finding-sample',
        researchedHeading: 'Target section',
        text: 'The measure increased each year.',
        quote: 'The recorded value increased each year.',
      },
    ])._unsafeUnwrap()
    setFindings(articleDoc, 'source-notes', [
      {
        id: 'finding-notes',
        researchedHeading: 'Target section',
        text: 'The note records a local observation.',
        quote: 'A note documented this observation.',
      },
    ])._unsafeUnwrap()
    installFetch(() => new Response('', { status: 404 }))
    await renderApp(articleDoc)

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const appHost = host
    if (!appHost) throw new Error('The app did not render')
    await vi.waitFor(() => {
      if (!appHost.querySelector('.cm-content')) {
        throw new Error('The article editor did not open')
      }
    })
    const editorContent = appHost.querySelector<HTMLElement>('.cm-content')
    if (!editorContent) throw new Error('The article editor did not render')
    const view = EditorView.findFromDOM(editorContent)
    if (!view) throw new Error('The article editor view did not render')
    act(() => {
      view.dispatch({
        selection: { anchor: articleBody.indexOf('A starter paragraph.') },
      })
    })
    const modifier = navigator.platform.includes('Mac') ? 'metaKey' : 'ctrlKey'
    await act(async () => {
      editorContent.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          key: 'k',
          [modifier]: true,
        }),
      )
      await Promise.resolve()
    })
    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: '資料をもとに書く' }),
      )
      await vi.waitFor(() => {
        if (
          writeRequestCount !== 1 ||
          writeRequest === undefined ||
          !appHost.querySelector('.cm-suggestion-widget')
        ) {
          throw new Error('The writing proposal was not rendered')
        }
      })
    })
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '却下 Esc' }))
    })
    const rejectedProposal = {
      body: getBody(articleDoc).toJSON(),
      evidenceIds: [...articleDoc.getMap('evidence').keys()],
    }

    await act(async () => {
      view.dispatch({
        selection: { anchor: articleBody.indexOf('A starter paragraph.') },
      })
      editorContent.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          key: 'k',
          [modifier]: true,
        }),
      )
      await Promise.resolve()
    })
    await act(async () => {
      await userEvent.click(
        page.getByRole('button', { name: '資料をもとに書く' }),
      )
      await vi.waitFor(() => {
        if (
          writeRequestCount !== 2 ||
          !appHost.querySelector('.cm-suggestion-widget')
        ) {
          throw new Error('The second writing proposal was not rendered')
        }
      })
    })
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '採用 Tab' }))
    })

    const markers = await vi.waitFor(() => {
      const rendered = [
        ...(host?.querySelectorAll<HTMLButtonElement>('.cm-evidence-marker') ??
          []),
      ]
      if (rendered.length !== 4) {
        throw new Error(
          'The accepted factual sentences did not receive markers',
        )
      }
      return rendered
    })
    const insufficientMarker = markers[1]
    if (!insufficientMarker)
      throw new Error('The insufficient marker is missing')
    await act(async () => {
      await userEvent.click(insufficientMarker)
    })

    const readOutput = () => ({
      rejectedProposal,
      body: getBody(articleDoc).toJSON(),
      request: writeRequest,
      evidence: listEvidence(articleDoc).map(
        ({ currentClaim, edited, quote, sourceId, verdict }) => ({
          currentClaim,
          edited,
          quote,
          sourceId,
          verdict,
        }),
      ),
      card:
        appHost
          .querySelector('[aria-label="この文の根拠"]')
          ?.textContent.replace(
            /確認 \d{4}-\d{2}-\d{2}/u,
            '確認 date-placeholder',
          ) ?? null,
    })
    expect(readOutput()).toEqual({
      rejectedProposal: {
        body: articleBody,
        evidenceIds: [],
      },
      body: 'Intro paragraph.\n\n# Intro\n\nBefore target.\n\n# Target section\n\n# Target section\n\nThe report records an annual increase. The program reached a national record. The plan stayed ahead of schedule. The notes include a local observation. This may encourage more participation.',
      request: {
        premise: { audience: '', purpose: '', thesis: '' },
        target_heading_id: 'block-4',
        blocks: [
          { id: 'block-0', kind: 'paragraph', markdown: 'Intro paragraph.' },
          { id: 'block-1', kind: 'heading', markdown: '# Intro' },
          { id: 'block-2', kind: 'paragraph', markdown: 'Before target.' },
          { id: 'block-3', kind: 'heading', markdown: '# Target section' },
          { id: 'block-4', kind: 'heading', markdown: '# Target section' },
          {
            id: 'block-5',
            kind: 'paragraph',
            markdown: 'A starter paragraph.',
          },
        ],
        sources: [
          {
            title: 'Sample report',
            url: 'https://example.invalid/report',
            fetched_at: '2026-03-01T00:00:00.000Z',
            summary: 'A sample summary.',
            key_points: [
              {
                id: 'finding-sample',
                researched_heading_id: 'block-4',
                text: 'The measure increased each year.',
                quote: 'The recorded value increased each year.',
              },
              ...Array.from({ length: 48 }, (_, index) => ({
                id: `finding-other-${String(index)}`,
                researched_heading_id: '',
                text: `A note from another section ${String(index)}.`,
                quote: `A quotation from another section ${String(index)}.`,
              })),
            ],
          },
          {
            title: 'Text notes',
            url: null,
            fetched_at: '2026-03-02T00:00:00.000Z',
            summary: 'Notes captured from a local document.',
            key_points: [
              {
                id: 'finding-notes',
                researched_heading_id: 'block-4',
                text: 'The note records a local observation.',
                quote: 'A note documented this observation.',
              },
            ],
          },
        ],
      },
      evidence: [
        {
          currentClaim: 'The report records an annual increase.',
          edited: false,
          quote: 'The recorded value increased each year.',
          sourceId: 'source-sample',
          verdict: 'supported',
        },
        {
          currentClaim: 'The program reached a national record.',
          edited: false,
          quote: '',
          sourceId: null,
          verdict: 'insufficient',
        },
        {
          currentClaim: 'The plan stayed ahead of schedule.',
          edited: false,
          quote: '',
          sourceId: null,
          verdict: 'insufficient',
        },
        {
          currentClaim: 'The notes include a local observation.',
          edited: false,
          quote: 'A note documented this observation.',
          sourceId: 'source-notes',
          verdict: 'supported',
        },
      ],
      card: '要確認 · 不足確認 date-placeholder資料なし引用箇所はありません。根拠を外す',
    })
  })
})
