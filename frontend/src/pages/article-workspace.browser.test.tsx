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

function renderWorkspace(listedArticles = articles) {
  const handlers = {
    onDuplicateArticle: vi.fn<(id: string) => void>(),
    onTrashArticle: vi.fn<(id: string) => void>(),
    onRestoreArticle: vi.fn<(id: string) => void>(),
  }
  const client: SyncClientApi = {
    start: () => okAsync(undefined),
    openDocument: (id) => ok(id === 'older' ? olderDoc : newerDoc),
    createArticle: () => ok(olderArticle),
    duplicateArticle: () => ok(olderArticle),
    trashArticle: () => ok(undefined),
    restoreArticle: () => ok(undefined),
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
        articles={listedArticles}
        client={client}
        onCreateArticle={() => undefined}
        onDuplicateArticle={handlers.onDuplicateArticle}
        onOpenSettings={() => {}}
        onRestoreArticle={handlers.onRestoreArticle}
        onTrashArticle={handlers.onTrashArticle}
        ready
        requiresAuthentication={false}
        statuses={{}}
      />,
    )
  })
  return handlers
}

function readList() {
  const search = host.querySelector<HTMLInputElement>(
    `input[aria-label="${SEARCH_LABEL}"]`,
  )
  return {
    titles: [...host.querySelectorAll('main li button:not([aria-label])')].map(
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
      const event = new KeyboardEvent('keydown', {
        key: '/',
        cancelable: true,
        [modifier]: true,
      })

      act(() => {
        window.dispatchEvent(event)
      })

      const readOutput = () => ({
        list: readList(),
        defaultPrevented: event.defaultPrevented,
      })
      expect(readOutput()).toEqual({
        list: {
          titles: [NEWER_TITLE, OLDER_TITLE],
          sort: '最近編集した順',
          query: '',
          searchFocused: false,
        },
        defaultPrevented: false,
      })
    },
  )

  it.each([
    ['複製', 'onDuplicateArticle'],
    ['ゴミ箱へ移す', 'onTrashArticle'],
  ] as const)(
    'runs %s from a row without opening the article',
    async (label, handler) => {
      const handlers = renderWorkspace()

      await act(async () => {
        await userEvent.click(
          page.getByRole('button', { name: '記事の操作' }).first(),
        )
      })
      await act(async () => {
        await userEvent.click(page.getByRole('menuitem', { name: label }))
      })

      await vi.waitFor(() => {
        const readOutput = () => ({
          calls: handlers[handler].mock.calls,
          menuOpen: document.querySelector('[role="menu"]') !== null,
          list: readList(),
        })
        expect(readOutput()).toEqual({
          calls: [['newer']],
          menuOpen: false,
          list: {
            titles: [NEWER_TITLE, OLDER_TITLE],
            sort: '最近編集した順',
            query: '',
            searchFocused: false,
          },
        })
      })
    },
  )

  it('leaves trashed articles out of the list and restores them from the trash', async () => {
    const handlers = renderWorkspace([
      ...articles,
      {
        id: 'trashed',
        title: 'A trashed article',
        createdAt: Date.UTC(2026, 0, 5),
        trashedAt: Date.UTC(2026, 0, 25),
      },
    ])

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: 'ゴミ箱 (1)' }))
    })
    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '戻す' }))
    })

    const readOutput = () => ({
      restored: handlers.onRestoreArticle.mock.calls,
      list: readList(),
    })
    expect(readOutput()).toEqual({
      restored: [['trashed']],
      list: {
        titles: [NEWER_TITLE, OLDER_TITLE],
        sort: '最近編集した順',
        query: '',
        searchFocused: false,
      },
    })
  })

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
