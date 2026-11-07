import { ok, okAsync } from 'neverthrow'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import * as Y from 'yjs'

import type { ArticleExportContext } from '#components/article-editor-view'
import { ArticleExportContainer } from '#components/article-export-container'
import type { ArticleExportSection } from '#components/article-export-screen'
import type { ExportDestination } from '#lib/article-export-api'
import type { Article, SyncClientApi } from '#lib/sync-client'
import { createMoveHistory } from '#outline/move-history'
import type { MoveHistory } from '#outline/move-history-types'

let host: HTMLDivElement | undefined
let root: Root | undefined
let doc: Y.Doc | undefined
let history: MoveHistory | undefined
let backCount = 0

const article: Article = {
  id: 'sample-article',
  createdAt: new Date(2026, 0, 15).getTime(),
  title: 'Sample article',
  syncFilePath: 'notes/example.md',
  syncFileStatus: 'synced',
}

const destinations: ExportDestination[] = [
  {
    id: 'sample-site',
    format: 'markdown',
    frontmatter_template: 'title: {{ title }}',
  },
]

function createClient(currentDoc: Y.Doc): SyncClientApi {
  return {
    start: () => okAsync(undefined),
    openDocument: () => ok(currentDoc),
    createArticle: () => ok(article),
    updateArticleTitle: () => ok(undefined),
    updateArticleExportSettings: () => ok(undefined),
    listArticles: () => [article],
    getStatus: () => undefined,
    getError: () => undefined,
    requiresAuthentication: () => false,
    subscribe: () => () => {},
    destroy: () => {},
  }
}

function mount({
  section,
  fileSyncEnabled,
  publishable,
  destinationError,
}: {
  section: ArticleExportSection | undefined
  fileSyncEnabled: boolean
  publishable: boolean
  destinationError?: string
}) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const currentDoc = new Y.Doc()
  doc = currentDoc
  const context: ArticleExportContext = {
    articleId: article.id,
    doc: currentDoc,
    history: (history = createMoveHistory(currentDoc)),
    view: null,
    replaceBody: () => ok(undefined),
    showSources: () => {},
    openExport: () => {},
    section,
    syncStatus: 'synced',
    onBack: () => {
      backCount += 1
    },
  }
  act(() => {
    root?.render(
      <ArticleExportContainer
        article={article}
        client={publishable ? createClient(currentDoc) : undefined}
        context={context}
        destinationError={destinationError}
        destinations={publishable ? destinations : undefined}
        fileSyncEnabled={fileSyncEnabled}
      />,
    )
  })
}

function readScreen() {
  return {
    sections: [...document.querySelectorAll('nav button')].map((button) => ({
      text: [...button.querySelectorAll('span')].map(
        ({ textContent }) => textContent,
      ),
      selected: button.getAttribute('aria-current') === 'true',
    })),
    heading: document.querySelector('h1')?.textContent ?? null,
    alert: document.querySelector('[role="alert"]')?.textContent ?? null,
    backCount,
  }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  backCount = 0
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          content: '',
          content_hash: 'file-hash',
          path: 'notes/example.md',
          status: 'synced',
        }),
      ),
    ),
  )
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = undefined
  history?.destroy()
  history = undefined
  doc?.destroy()
  doc = undefined
  host?.remove()
  host = undefined
  vi.unstubAllGlobals()
})

describe('ArticleExportContainer', () => {
  it('lists every available form and opens the requested one', () => {
    mount({ section: 'publish', fileSyncEnabled: true, publishable: true })

    expect(readScreen()).toEqual({
      sections: [
        {
          text: ['本文ファイルへ自動同期', '✓ 同期済み · notes/example.md'],
          selected: false,
        },
        {
          text: ['公開先へ PR', '差分を確認してから PR を作成'],
          selected: true,
        },
        {
          text: ['ファイルに保存', '.md / .mdx · frontmatter なし'],
          selected: false,
        },
      ],
      heading: '公開先へ PR',
      alert: null,
      backCount: 0,
    })
  })

  it('opens the first available form when the requested one is unavailable', () => {
    mount({ section: 'sync', fileSyncEnabled: false, publishable: false })

    expect(readScreen()).toEqual({
      sections: [
        {
          text: ['ファイルに保存', '.md / .mdx · frontmatter なし'],
          selected: true,
        },
      ],
      heading: 'ファイルに保存',
      alert: null,
      backCount: 0,
    })
  })

  it('explains why the publish form cannot be used', () => {
    mount({
      section: undefined,
      fileSyncEnabled: false,
      publishable: false,
      destinationError: 'The destinations could not be loaded.',
    })

    expect(readScreen()).toEqual({
      sections: [
        {
          text: ['公開先へ PR', '公開先を読み込めませんでした'],
          selected: true,
        },
        {
          text: ['ファイルに保存', '.md / .mdx · frontmatter なし'],
          selected: false,
        },
      ],
      heading: '公開先へ PR',
      alert: 'The destinations could not be loaded.',
      backCount: 0,
    })
  })

  it('switches forms and returns to the article', async () => {
    mount({ section: 'publish', fileSyncEnabled: false, publishable: true })
    await act(async () => {
      await page.getByRole('button', { name: /ファイルに保存/ }).click()
    })
    await act(async () => {
      await page.getByRole('button', { name: '← 本文に戻る' }).click()
    })

    expect(readScreen()).toEqual({
      sections: [
        {
          text: ['公開先へ PR', '差分を確認してから PR を作成'],
          selected: false,
        },
        {
          text: ['ファイルに保存', '.md / .mdx · frontmatter なし'],
          selected: true,
        },
      ],
      heading: 'ファイルに保存',
      alert: null,
      backCount: 1,
    })
  })
})
