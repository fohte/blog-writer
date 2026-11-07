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
  setBody,
  setFindings,
} from '#article/index'
import { listMemos } from '#article/memos'
import type { Article, SyncClientApi } from '#lib/sync-client'

const { mockUseSyncClient } = vi.hoisted(() => ({
  mockUseSyncClient: vi.fn(),
}))

vi.mock('#lib/use-sync-client', () => ({
  useSyncClient: mockUseSyncClient,
}))

let host: HTMLDivElement | undefined
let root: Root | undefined
let doc: Y.Doc | undefined
let writeRequest: unknown
let writeRequestCount: number
let holdWriteResponse = false
let writeRequestSignal: AbortSignal | undefined

const article: Article = {
  id: 'article-outline-proposal',
  title: 'A useful article',
  createdAt: Date.UTC(2026, 0, 15),
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

function renderApp(articleDoc: Y.Doc) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const client: SyncClientApi = {
    start: () => okAsync(undefined),
    openDocument: () => ok(articleDoc),
    createArticle: () => ok(article),
    updateArticleTitle: () => ok(undefined),
    updateArticleExportSettings: () => ok(undefined),
    listArticles: () => [article],
    getStatus: () => 'synced',
    getError: () => undefined,
    requiresAuthentication: () => false,
    subscribe: () => () => {},
    destroy: () => {},
  }
  mockUseSyncClient.mockReturnValue({
    articles: [article],
    statuses: { [article.id]: 'synced' },
    client,
    canCreate: true,
    error: undefined,
    requiresAuthentication: false,
    createArticle: () => undefined,
  })
  act(() => {
    root?.render(<App />)
  })
}

beforeEach(async () => {
  writeRequest = undefined
  writeRequestCount = 0
  holdWriteResponse = false
  writeRequestSignal = undefined
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await page.viewport(375, 812)
  const fetcher: typeof fetch = (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    if (url === '/api/file-sync/configuration') {
      return Promise.resolve(Response.json({ enabled: false, directory: null }))
    }
    if (url === '/api/export/destinations') {
      return Promise.resolve(Response.json({ destinations: [] }))
    }
    if (url === '/api/proposals/outline') {
      return Promise.resolve(proposalResponse())
    }
    if (url === '/api/write-from-key-points') {
      if (typeof init?.body === 'string') writeRequest = JSON.parse(init.body)
      writeRequestCount += 1
      if (holdWriteResponse && init?.signal instanceof AbortSignal) {
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
    return Promise.resolve(new Response('unexpected request', { status: 500 }))
  }
  vi.stubGlobal('fetch', fetcher)
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  doc?.destroy()
  doc = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
  mockUseSyncClient.mockReset()
})

describe('App outline proposal integration', () => {
  it('sends source summaries and only evidence overlapping the requested paragraph', async () => {
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
    renderApp(articleDoc)

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const editor = host?.querySelector<HTMLElement>('.cm-content')
    if (!editor) throw new Error('The article editor did not open')
    const editorView = EditorView.findFromDOM(editor)
    if (!editorView) throw new Error('The article editor view did not open')
    const targetFrom = articleBody.indexOf('Target claim.')
    act(() => {
      editorView.dispatch({
        selection: {
          anchor: targetFrom,
          head: targetFrom + 'Target claim.'.length,
        },
      })
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
      evidence_quotes: [
        'Evidence for the target claim.',
        'An outdated quote for the target claim.',
        'A quote from the edited claim.',
      ],
    })
  })

  it('renders the proposal in one outline and returns to the article after heading selection', async () => {
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(
      articleDoc,
      '# Starting point\n\n## Second section\n\nA useful paragraph.\n',
    )
    renderApp(articleDoc)

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    await act(async () => {
      await userEvent.click(page.getByRole('tab', { name: 'Outline' }))
    })

    vi.useFakeTimers()
    act(() => {
      setBody(
        articleDoc,
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
      },
      selectedTab: 'Article',
    })
  })

  it('inserts a memo as a heading from the article workspace', async () => {
    await page.viewport(1280, 800)
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(articleDoc, '# Starting point\n\nA useful paragraph.\n')
    renderApp(articleDoc)

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const memoText = 'A useful thought'
    await act(async () => {
      await userEvent.fill(
        page.getByRole('textbox', { name: '新しいメモ' }),
        memoText,
      )
      await userEvent.click(page.getByRole('button', { name: '追加' }))
      await userEvent.click(page.getByRole('button', { name: '採用先を選ぶ' }))
      await userEvent.click(page.getByRole('button', { name: '末尾に追加' }))
    })

    const readOutput = () => ({
      body: getBody(articleDoc).toJSON(),
      memos: listMemos(articleDoc).map(({ text, state }) => ({
        text,
        state: state.kind,
      })),
    })
    expect(readOutput()).toEqual({
      body: '# Starting point\n\nA useful paragraph.\n\n# A useful thought\n\n',
      memos: [{ text: memoText, state: 'adopted' }],
    })
  })

  it('moves a body block from the editor menu', async () => {
    await page.viewport(1280, 800)
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(articleDoc, '# First section\n\none\n\n# Second section\n\ntwo\n')
    renderApp(articleDoc)

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: article.title }))
    })
    const moveHandle = page.getByRole('button', { name: 'Move block' }).first()
    await act(async () => {
      await userEvent.click(moveHandle)
    })
    const menuOpened = document.body.querySelector('[role="menu"]') !== null
    await act(async () => {
      await userEvent.click(page.getByRole('menuitem', { name: 'Move down' }))
    })

    const readOutput = () => ({
      body: getBody(articleDoc).toJSON(),
      menuOpened,
    })
    expect(readOutput()).toEqual({
      body: '# Second section\n\ntwo\n\n# First section\n\none\n',
      menuOpened: true,
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
    renderApp(articleDoc)

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
    renderApp(articleDoc)

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
      await userEvent.click(page.getByRole('button', { name: '× 却下' }))
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
      await userEvent.click(page.getByRole('button', { name: '✓ 採用' }))
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
          .querySelector('[aria-label="根拠"]')
          ?.textContent.replace(
            /確認日: \d{4}-\d{2}-\d{2}/u,
            '確認日: date-placeholder',
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
      card: '資料なし不足引用箇所はありません。確認日: date-placeholder公開日: 不明外す',
    })
  })
})
