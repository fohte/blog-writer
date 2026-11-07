import '#index.css'

import { ok, okAsync } from 'neverthrow'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import * as Y from 'yjs'

import { App } from '#App'
import { getBody, setBody } from '#article/body'
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
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await page.viewport(375, 812)
  const fetcher: typeof fetch = (input) => {
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
