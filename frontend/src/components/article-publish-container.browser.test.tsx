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

vi.mock('#components/text-diff-view', () => ({
  TextDiffView: ({
    original,
    modified,
  }: {
    original: string
    modified: string
  }) => (
    <div data-testid="text-diff">
      <output data-testid="diff-original">{original}</output>
      <output data-testid="diff-modified">{modified}</output>
    </div>
  ),
}))

let root: Root | undefined
let doc: Y.Doc | undefined
let requests: Array<{ method: string; url: string; body: unknown }> = []
let getResponses: Array<{ status: number; payload: unknown }> = []
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

function hasButton(label: string) {
  return [...document.querySelectorAll('button')].some(
    (button) => button.textContent === label,
  )
}

function readDiffContents() {
  return [
    document.querySelector('[data-testid="diff-original"]')?.textContent ?? '',
    document.querySelector('[data-testid="diff-modified"]')?.textContent ?? '',
  ]
}

async function waitForDiff() {
  await vi.waitFor(() => {
    if (!document.querySelector('[data-testid="text-diff"]'))
      throw new Error('Waiting for the prepared diff')
  })
}

async function clickAndWait(label: string, waitForState: () => Promise<void>) {
  await page.getByRole('button', { name: label }).click()
  await waitForState()
}

async function fillTextbox(label: string, value: string) {
  await act(async () => {
    await userEvent.fill(page.getByRole('textbox', { name: label }), value)
  })
}

async function waitForPublishedLink() {
  await vi.waitFor(() => {
    if (
      !document.querySelector(
        'a[href="https://github.com/example/site/pull/12"]',
      )
    )
      throw new Error('Waiting for the pull request link')
  })
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

function readPublishedState(
  diffContents: string[],
  publishedHref: string | null | undefined,
) {
  return { diffContents, publishedHref, requests }
}

function readConflictState(publishButtonAfterConflict: boolean) {
  return { publishButtonAfterConflict, requests }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  requests = []
  getResponses = []
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
          ? (getResponses.shift() ?? {
              status: 200,
              payload: { content: 'Old body', sha: 'base-sha' },
            })
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
    await clickAndWait('差分を見る', waitForDiff)
    const diffContents = readDiffContents()
    await clickAndWait('PR を作成', waitForPublishedLink)
    const publishedHref = document.querySelector('a')?.getAttribute('href')

    expect(readPublishedState(diffContents, publishedHref)).toEqual({
      diffContents: [
        'Old body',
        '---\ntitle: "Sample article"\ndate: "2026-01-15"\n---\n\n# Sample body',
      ],
      publishedHref: 'https://github.com/example/site/pull/12',
      requests: [
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
      ],
    })
  })

  it('publishes a new file with a null sha', async () => {
    renderPublish()
    getResponses.push({
      status: 200,
      payload: { content: null, sha: null },
    })
    await clickAndWait('差分を見る', waitForDiff)
    const diffContents = readDiffContents()
    await clickAndWait('PR を作成', waitForPublishedLink)
    const publishedHref = document.querySelector('a')?.getAttribute('href')

    expect(readPublishedState(diffContents, publishedHref)).toEqual({
      diffContents: [
        '',
        '---\ntitle: "Sample article"\ndate: "2026-01-15"\n---\n\n# Sample body',
      ],
      publishedHref: 'https://github.com/example/site/pull/12',
      requests: [
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
            sha: null,
          },
        },
      ],
    })
  })

  it('requires a new diff after the slug or article body changes', async () => {
    renderPublish()
    await clickAndWait('差分を見る', waitForDiff)
    await fillTextbox('公開 slug', 'changed-post')
    const disabledAfterSlugChange = isButtonDisabled('PR を作成')
    await clickAndWait('差分を見る', waitForDiff)
    await fillTextbox('frontmatter', 'title: "Changed article"')
    const disabledAfterFrontmatterChange = isButtonDisabled('PR を作成')
    await clickAndWait('差分を見る', waitForDiff)
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
    await clickAndWait('差分を見る', waitForDiff)
    await clickAndWait('PR を作成', async () => {
      await vi.waitFor(() => {
        if (!document.querySelector('[role="alert"]'))
          throw new Error('Waiting for the conflict message')
      })
    })
    const publishButtonAfterConflict = hasButton('PR を作成')
    await clickAndWait('差分を見る', waitForDiff)

    expect(readConflictState(publishButtonAfterConflict)).toEqual({
      publishButtonAfterConflict: false,
      requests: [
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
      ],
    })
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
