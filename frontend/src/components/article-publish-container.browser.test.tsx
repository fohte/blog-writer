import { ok, okAsync } from 'neverthrow'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import * as Y from 'yjs'

import { setBody } from '#article/body'
import { ArticlePublishContainer } from '#components/article-publish-container'
import type { ExportDestination } from '#lib/article-export-api'
import type { Article, SyncClientApi } from '#lib/sync-client'

let root: Root | undefined
let doc: Y.Doc | undefined
let requests: Array<{ method: string; url: string; body: unknown }> = []
let postResponses: Array<{ status: number; payload: unknown }> = []

const article: Article = {
  id: 'article-one',
  createdAt: Date.UTC(2026, 0, 15),
  title: 'Sample article',
  exportDestinationId: 'sample-site',
  exportSlug: 'sample-post',
  exportFrontmatter: 'title: "Sample article"\ndate: "2026-01-15"',
}

const destinations: ExportDestination[] = [
  {
    id: 'sample-site',
    format: 'markdown',
    frontmatter_template: 'title: {{ title }}\ndate: {{ date }}',
  },
]

function renderPublish(settings: Partial<Article> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  doc = new Y.Doc()
  const currentDoc = doc
  setBody(currentDoc, '# Sample body')
  const client: SyncClientApi = {
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
  act(() => {
    root?.render(
      <ArticlePublishContainer
        article={{ ...article, ...settings }}
        client={client}
        destinations={destinations}
        doc={currentDoc}
        onDiffChange={() => {}}
      />,
    )
  })
}

function isButtonDisabled(label: string) {
  return [...document.querySelectorAll('button')].find(
    (button) => button.textContent === label,
  )?.disabled
}

function readPublishActionState(
  disabledAfterSlugChange: boolean | undefined,
  disabledAfterFrontmatterChange: boolean | undefined,
  disabledAfterBodyChange: boolean | undefined,
) {
  return {
    disabledAfterSlugChange,
    disabledAfterFrontmatterChange,
    disabledAfterBodyChange,
    requests,
  }
}

function readInvalidSlugState(disabled: boolean | undefined) {
  return { disabled, requests }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  requests = []
  postResponses = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      const method = init?.method ?? 'GET'
      const body: unknown =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as unknown)
          : null
      requests.push({ method, url, body })
      const response =
        method === 'GET'
          ? { status: 200, payload: { content: 'Old body', sha: 'base-sha' } }
          : (postResponses.shift() ?? {
              status: 200,
              payload: { url: 'https://github.com/example/site/pull/12' },
            })
      return Promise.resolve(
        Response.json(response.payload, { status: response.status }),
      )
    }),
  )
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  doc?.destroy()
  doc = undefined
  vi.unstubAllGlobals()
})

describe('ArticlePublishContainer', () => {
  it('posts the exact content and sha shown in the diff', async () => {
    renderPublish()
    await page.getByRole('button', { name: '差分を見る' }).click()
    await page.getByRole('button', { name: 'PR を作成' }).click()

    expect(requests).toEqual([
      {
        method: 'GET',
        url: '/api/export/sample-site/articles/article-one?slug=sample-post',
        body: null,
      },
      {
        method: 'POST',
        url: '/api/export/sample-site/articles/article-one',
        body: {
          slug: 'sample-post',
          content:
            '---\ntitle: "Sample article"\ndate: "2026-01-15"\n---\n\n# Sample body',
          sha: 'base-sha',
        },
      },
    ])
  })

  it('requires a new diff after the slug or article body changes', async () => {
    renderPublish()
    await page.getByRole('button', { name: '差分を見る' }).click()
    await userEvent.fill(
      page.getByRole('textbox', { name: '公開 slug' }),
      'changed-post',
    )
    const disabledAfterSlugChange = isButtonDisabled('PR を作成')
    await page.getByRole('button', { name: '差分を見る' }).click()
    await userEvent.fill(
      page.getByRole('textbox', { name: 'frontmatter' }),
      'title: "Changed article"',
    )
    const disabledAfterFrontmatterChange = isButtonDisabled('PR を作成')
    await page.getByRole('button', { name: '差分を見る' }).click()
    act(() => doc?.getText('body').insert(0, 'Changed '))
    const disabledAfterBodyChange = isButtonDisabled('PR を作成')

    expect(
      readPublishActionState(
        disabledAfterSlugChange,
        disabledAfterFrontmatterChange,
        disabledAfterBodyChange,
      ),
    ).toEqual({
      disabledAfterSlugChange: true,
      disabledAfterFrontmatterChange: true,
      disabledAfterBodyChange: true,
      requests: [
        {
          method: 'GET',
          url: '/api/export/sample-site/articles/article-one?slug=sample-post',
          body: null,
        },
        {
          method: 'GET',
          url: '/api/export/sample-site/articles/article-one?slug=changed-post',
          body: null,
        },
        {
          method: 'GET',
          url: '/api/export/sample-site/articles/article-one?slug=changed-post',
          body: null,
        },
      ],
    })
  })

  it('requires a new diff after a conflict', async () => {
    renderPublish()
    postResponses.push({ status: 409, payload: { error: 'The file changed.' } })
    await page.getByRole('button', { name: '差分を見る' }).click()
    await page.getByRole('button', { name: 'PR を作成' }).click()
    await page.getByRole('button', { name: '差分を見る' }).click()

    expect(requests).toEqual([
      {
        method: 'GET',
        url: '/api/export/sample-site/articles/article-one?slug=sample-post',
        body: null,
      },
      {
        method: 'POST',
        url: '/api/export/sample-site/articles/article-one',
        body: {
          slug: 'sample-post',
          content:
            '---\ntitle: "Sample article"\ndate: "2026-01-15"\n---\n\n# Sample body',
          sha: 'base-sha',
        },
      },
      {
        method: 'GET',
        url: '/api/export/sample-site/articles/article-one?slug=sample-post',
        body: null,
      },
    ])
  })

  it('does not request a file for an invalid slug', () => {
    renderPublish({ exportSlug: '../invalid' })
    const disabled = isButtonDisabled('差分を見る')

    expect(readInvalidSlugState(disabled)).toEqual({
      disabled: true,
      requests: [],
    })
  })
})
