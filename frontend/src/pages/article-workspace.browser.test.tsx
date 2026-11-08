import '#index.css'

import { ok, okAsync } from 'neverthrow'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import * as Y from 'yjs'

import { setBody } from '#article/index'
import type { Article, SyncClientApi } from '#lib/sync-client'
import { ArticleWorkspace } from '#pages/article-workspace'

const OLDER_TITLE = 'An older article'
const NEWER_TITLE = 'A newer article'
const SEARCH_LABEL = 'タイトルと本文を検索'

const olderArticle: Article = {
  id: 'older',
  title: OLDER_TITLE,
  createdAt: Date.UTC(2026, 0, 1),
}
const articles: Article[] = [
  olderArticle,
  {
    id: 'newer',
    title: NEWER_TITLE,
    createdAt: Date.UTC(2026, 0, 10),
    updatedAt: Date.UTC(2026, 0, 20),
  },
]

let host: HTMLDivElement
let root: Root
let olderDoc: Y.Doc
let newerDoc: Y.Doc

function renderWorkspace() {
  const client: SyncClientApi = {
    start: () => okAsync(undefined),
    openDocument: (id) => ok(id === 'older' ? olderDoc : newerDoc),
    createArticle: () => ok(olderArticle),
    updateArticleTitle: () => ok(undefined),
    updateArticleExportSettings: () => ok(undefined),
    listArticles: () => articles,
    getStatus: () => 'synced',
    getSyncedAt: () => undefined,
    getError: () => undefined,
    requiresAuthentication: () => false,
    subscribe: () => () => {},
    destroy: () => {},
  }
  act(() => {
    root.render(
      <ArticleWorkspace
        articles={articles}
        client={client}
        onCreateArticle={() => undefined}
        onOpenSettings={() => {}}
        ready
        requiresAuthentication={false}
        statuses={{}}
      />,
    )
  })
}

function readList() {
  const search = host.querySelector<HTMLInputElement>(
    `input[aria-label="${SEARCH_LABEL}"]`,
  )
  return {
    titles: [...host.querySelectorAll('main li button')].map(
      (row) => row.textContent,
    ),
    sort: host.querySelector('[aria-pressed="true"]')?.textContent,
    query: search?.value,
    searchFocused: search !== null && document.activeElement === search,
  }
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await page.viewport(1280, 800)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  olderDoc = new Y.Doc()
  newerDoc = new Y.Doc()
  setBody(olderDoc, 'A paragraph about compost.\n')
  setBody(newerDoc, 'A paragraph about beans.\n')
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  host.remove()
  olderDoc.destroy()
  newerDoc.destroy()
  vi.unstubAllGlobals()
})

describe('article list', () => {
  it('finds an article by its body text', async () => {
    renderWorkspace()

    await act(async () => {
      await userEvent.fill(
        page.getByRole('textbox', { name: SEARCH_LABEL }),
        'compost',
      )
    })

    expect(readList()).toEqual({
      titles: [OLDER_TITLE],
      sort: '最近編集した順',
      query: 'compost',
      searchFocused: true,
    })
  })

  it('moves to the search field on / and then types it as text', async () => {
    renderWorkspace()

    await act(async () => {
      await userEvent.keyboard('/')
    })
    const afterFirstSlash = readList()
    await act(async () => {
      await userEvent.keyboard('/')
    })

    const readOutput = () => ({ afterFirstSlash, afterSecondSlash: readList() })
    expect(readOutput()).toEqual({
      afterFirstSlash: {
        titles: [NEWER_TITLE, OLDER_TITLE],
        sort: '最近編集した順',
        query: '',
        searchFocused: true,
      },
      afterSecondSlash: {
        titles: [],
        sort: '最近編集した順',
        query: '/',
        searchFocused: true,
      },
    })
  })

  it.each(['ctrlKey', 'metaKey', 'altKey'])(
    'leaves / with %s to the browser',
    (modifier) => {
      renderWorkspace()

      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: '/', [modifier]: true }),
        )
      })

      expect(readList()).toEqual({
        titles: [NEWER_TITLE, OLDER_TITLE],
        sort: '最近編集した順',
        query: '',
        searchFocused: false,
      })
    },
  )

  it('keeps the search and the order after returning from an article', async () => {
    renderWorkspace()
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '作成した順' }))
    })
    await act(async () => {
      await userEvent.fill(
        page.getByRole('textbox', { name: SEARCH_LABEL }),
        'article',
      )
    })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: NEWER_TITLE }))
    })
    await act(async () => {
      await userEvent.click(page.getByTitle('記事の一覧へ'))
    })

    expect(readList()).toEqual({
      titles: [OLDER_TITLE, NEWER_TITLE],
      sort: '作成した順',
      query: 'article',
      searchFocused: false,
    })
  })
})
