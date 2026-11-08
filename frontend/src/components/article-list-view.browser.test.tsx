import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ArticleListView } from '#components/article-list-view'
import type { Article, ArticleSummary } from '#lib/sync-client'

const firstArticle: Article = {
  id: 'first',
  title: 'First',
  createdAt: Date.UTC(2026, 0, 15, 9),
}
const secondArticle: Article = {
  id: 'second',
  title: 'Second',
  createdAt: Date.UTC(2026, 0, 16, 9),
}
const trashedArticle: Article = {
  id: 'trashed',
  title: 'Trashed',
  createdAt: Date.UTC(2026, 0, 17, 9),
  trashedAt: Date.UTC(2026, 0, 18, 9),
}

let host: HTMLDivElement
let root: Root

function renderList(
  props: Partial<ComponentProps<typeof ArticleListView>> &
    Pick<ComponentProps<typeof ArticleListView>, 'articles'>,
) {
  act(() => {
    root.render(
      <ArticleListView
        canCreate
        offline={false}
        onCreateArticle={() => {}}
        onDuplicateArticle={() => {}}
        onLoginAgain={() => {}}
        onOpenArticle={() => {}}
        onOpenSettings={() => {}}
        onRestoreArticle={() => {}}
        onSearchQueryChange={() => {}}
        onSortOrderChange={() => {}}
        onTrashArticle={() => {}}
        readArticleBody={() => ''}
        readArticleSummary={() => undefined}
        requiresAuthentication={false}
        searchQuery=""
        sortOrder="edited"
        statuses={{}}
        {...props}
      />,
    )
  })
}

function readRows() {
  return [...host.querySelectorAll('main li')].map((row) => row.textContent)
}

function readProgress() {
  return [...host.querySelectorAll('main > p')].map((line) => line.textContent)
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  host.remove()
  vi.unstubAllGlobals()
})

describe('article list summaries', () => {
  it.each<[string, ArticleSummary | undefined, string]>([
    [
      'unorganized memos',
      { unorganizedMemoCount: 7, bodyIsEmpty: false },
      '未整理メモ 7',
    ],
    [
      'a missing body',
      { unorganizedMemoCount: 0, bodyIsEmpty: true },
      '本文なし',
    ],
    [
      'both',
      { unorganizedMemoCount: 3, bodyIsEmpty: true },
      '未整理メモ 3 · 本文なし',
    ],
    ['neither', { unorganizedMemoCount: 0, bodyIsEmpty: false }, ''],
    ['content that has not loaded yet', undefined, ''],
  ])('labels a row with %s', (_name, summary, label) => {
    renderList({
      articles: [firstArticle],
      readArticleSummary: () => summary,
    })

    expect(readRows()).toEqual([`First${label}作成 2026-01-15⋯`])
  })
})

describe('article list sync progress', () => {
  it.each<[string, Parameters<typeof renderList>[0], string[]]>([
    [
      'counts synced articles while others are syncing',
      {
        articles: [firstArticle, secondArticle],
        statuses: { first: 'synced', second: 'syncing' },
      },
      ['◐ 全記事を同期中 1 / 2 · 開ける記事から使えます'],
    ],
    [
      'leaves trashed articles out of the count',
      {
        articles: [firstArticle, secondArticle, trashedArticle],
        statuses: { first: 'synced', second: 'syncing', trashed: 'synced' },
      },
      ['◐ 全記事を同期中 1 / 2 · 開ける記事から使えます'],
    ],
    [
      'hides once nothing is syncing',
      {
        articles: [firstArticle, secondArticle],
        statuses: { first: 'synced', second: 'unsynced' },
      },
      [],
    ],
    [
      'hides when only a trashed article is syncing',
      {
        articles: [firstArticle, trashedArticle],
        statuses: { first: 'synced', trashed: 'syncing' },
      },
      [],
    ],
    [
      'hides while offline',
      {
        articles: [firstArticle],
        offline: true,
        statuses: { first: 'syncing' },
      },
      [],
    ],
  ])('%s', (_name, props, expected) => {
    renderList(props)

    expect(readProgress()).toEqual(expected)
  })
})
