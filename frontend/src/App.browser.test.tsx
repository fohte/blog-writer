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
  await act(async () => {
    await vi.waitFor(assertion)
  })
}

async function openArticle() {
  await act(async () => {
    await userEvent.click(page.getByRole('button', { name: article.title }))
  })
}

beforeEach(async () => {
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
        ...(host?.querySelectorAll('button span.font-medium') ?? []),
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
    const researchWasStarted = new Promise<void>((resolve) => {
      researchStarted = resolve
    })
    let putCount = 0
    installFetch((url, init) => {
      if (url === '/api/research/jobs') {
        if (typeof init.body === 'string')
          requestQuestion = JSON.parse(init.body) as unknown
        if (researchStarted !== undefined) researchStarted()
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
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
      sourceCount: listSources(doc).length,
      findingCount: listFindings(doc).length,
      bodySaveRequests: putCount,
      interruptedMessage: exactRoleText('status', interruptedText),
    })
    expect(readResult()).toEqual({
      query: { task: 'key_points', question: 'Research topic' },
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
      progressQueries: 'Research topic',
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
      await userEvent.click(page.getByRole('tab', { name: 'Outline' }))
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
        .map((button) => button.textContent.trim())
        .filter((text) => text === '✓ 採用' || text === '× 却下'),
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
      selectedTab: host
        ?.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent.trim(),
    })
    expect(actual()).toEqual({
      proposalState: {
        outlineCount: 1,
        proposalButtons: ['✓ 採用', '× 却下'],
        researchEntryVisible: true,
      },
      selectedTab: 'Article',
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
        page.getByRole('textbox', { name: '新しいメモ' }),
        'A useful thought',
      )
      await userEvent.click(page.getByRole('button', { name: '追加' }))
      await userEvent.click(page.getByRole('button', { name: '採用先を選ぶ' }))
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
  it('sends the source summaries and evidence overlapping the requested paragraph', async () => {
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
    for (const { claim, text, quote } of [
      {
        claim: 'Target claim.',
        text: 'Target claim.',
        quote: 'Evidence for the target claim.',
      },
      {
        claim: 'Unrelated claim.',
        text: 'Unrelated claim.',
        quote: 'Evidence for an unrelated claim.',
      },
    ]) {
      const from = articleBody.indexOf(text)
      addEvidence(articleDoc, {
        id: 'evidence-' + text,
        from,
        to: from + text.length,
        claim,
        sourceId,
        quote,
        verdict: 'supported',
        checkedAt: '2026-01-01T00:00:00Z',
      })._unsafeUnwrap()
    }
    await renderApp(articleDoc)

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const editor = host?.querySelector<HTMLElement>('.cm-content')
    if (!editor) throw new Error('The article editor did not open')
    await act(async () => {
      await userEvent.click(page.getByText('Target claim.'))
      await userEvent.keyboard('{Home}')
    })

    let requestBody: unknown
    const originalFetch = globalThis.fetch
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        if (url === '/api/proposals/body-request') {
          requestBody = JSON.parse(await new Request(input, init).text())
          return new Response(
            'data: {"event":"result","data":{"replacement":"Updated claim."}}\n\n',
            { headers: { 'content-type': 'text/event-stream' } },
          )
        }
        return originalFetch(input, init)
      },
    )

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
      evidence_quotes: ['Evidence for the target claim.'],
    })
  })
})
