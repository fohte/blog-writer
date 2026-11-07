import { ok, okAsync } from 'neverthrow'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import * as Y from 'yjs'

import { setBody } from '#article/body'
import { ArticlePublishContainer } from '#components/article-publish-container'
import type { ExportDestination } from '#lib/article-export-api'
import type {
  Article,
  ArticleExportSettings,
  SyncClientApi,
} from '#lib/sync-client'

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
let settingsUpdates: Array<{ id: string; settings: ArticleExportSettings }> = []
let pendingGetResponse: Promise<Response> | undefined

const article: Article = {
  id: 'article-one',
  createdAt: new Date(2026, 0, 15).getTime(),
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

function renderPublish(
  settings: Partial<Article> = {},
  options: {
    article?: Article
    destinations?: ExportDestination[]
    onDiffChange?: (showing: boolean) => void
    body?: string
  } = {},
) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  doc = new Y.Doc()
  const currentDoc = doc
  setBody(currentDoc, options.body ?? '# Sample body')
  const client: SyncClientApi = {
    start: () => okAsync(undefined),
    openDocument: () => ok(currentDoc),
    createArticle: () => ok(article),
    updateArticleTitle: () => ok(undefined),
    updateArticleExportSettings: (id, nextSettings) => {
      settingsUpdates.push({ id, settings: nextSettings })
      return ok(undefined)
    },
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
        article={options.article ?? { ...article, ...settings }}
        client={client}
        destinations={options.destinations ?? destinations}
        doc={currentDoc}
        onDiffChange={options.onDiffChange ?? (() => {})}
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
  await act(async () => {
    await page.getByRole('button', { name: label }).click()
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  })
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
  return {
    publishButtonAfterConflict,
    error: document.querySelector('[role="alert"]')?.textContent ?? null,
    diffContents: document.querySelector('[data-testid="text-diff"]')
      ? readDiffContents()
      : null,
    publishButtonDisabled: isButtonDisabled('PR を作成') ?? null,
    requests,
  }
}

function readDestinationState() {
  return {
    selectedDestination:
      document.querySelector('[aria-label="公開先"]')?.textContent ?? null,
    frontmatter:
      document.querySelector<HTMLTextAreaElement>('[aria-label="frontmatter"]')
        ?.value ?? null,
    unavailableMessage:
      [...document.querySelectorAll('[role="status"]')]
        .map(({ textContent }) => textContent)
        .find((value) => value.includes('保存済みの公開先')) ?? null,
    showDiffDisabled: isButtonDisabled('差分を見る') ?? null,
    canCreatePullRequest: hasButton('PR を作成'),
    settingsUpdates,
    requests,
  }
}

function readMdxConversionFailureState() {
  return {
    error: document.querySelector('[role="alert"]')?.textContent ?? null,
    diff: document.querySelector('[data-testid="text-diff"]') !== null,
    requests,
  }
}

function readUnmountedDiffState(diffChangeCalls: unknown[]) {
  return { diffChangeCalls, requests }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  requests = []
  getResponses = []
  postResponses = []
  settingsUpdates = []
  pendingGetResponse = undefined
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
      if (method === 'GET' && pendingGetResponse !== undefined) {
        const responsePromise = pendingGetResponse
        pendingGetResponse = undefined
        return responsePromise
      }
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
  vi.doUnmock('remark')
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

  it('requires a new diff after the publishing destination changes', async () => {
    const otherDestination: ExportDestination = {
      id: 'another-site',
      format: 'markdown',
      frontmatter_template: 'title: {{ title }}',
    }
    renderPublish({}, { destinations: [...destinations, otherDestination] })
    await clickAndWait('差分を見る', waitForDiff)
    await act(async () => {
      await page.getByRole('combobox', { name: '公開先' }).click()
      await page.getByRole('option', { name: 'another-site' }).click()
    })

    expect(readDestinationState()).toEqual({
      selectedDestination: 'another-site',
      frontmatter: 'title: "Sample article"\ndate: "2026-01-15"',
      unavailableMessage: null,
      showDiffDisabled: false,
      canCreatePullRequest: false,
      settingsUpdates: [
        {
          id: 'article-one',
          settings: { exportDestinationId: 'another-site' },
        },
      ],
      requests: [
        {
          method: 'GET',
          url: '/api/export/sample-site/articles/article-one?slug=sample-post',
          body: null,
        },
      ],
    })
  })

  it('auto-selects one destination and persists the template and edited settings', async () => {
    renderPublish(
      {},
      {
        article: {
          id: article.id,
          createdAt: article.createdAt,
          title: article.title,
          exportSlug: 'sample-post',
        },
        destinations,
      },
    )
    await vi.waitFor(() => {
      if (settingsUpdates.length === 0)
        throw new Error('Waiting for the initial export settings')
    })
    await fillTextbox('公開 slug', 'revised-post')
    await fillTextbox('frontmatter', 'title: "Edited article"')

    expect(readDestinationState()).toEqual({
      selectedDestination: 'sample-site',
      frontmatter: 'title: "Edited article"',
      unavailableMessage: null,
      showDiffDisabled: false,
      canCreatePullRequest: false,
      settingsUpdates: [
        {
          id: 'article-one',
          settings: {
            exportDestinationId: 'sample-site',
            exportFrontmatter: 'title: "Sample article"\ndate: "2026-01-15"',
          },
        },
        { id: 'article-one', settings: { exportSlug: 'revised-post' } },
        {
          id: 'article-one',
          settings: { exportFrontmatter: 'title: "Edited article"' },
        },
      ],
      requests: [],
    })
  })

  it('prompts to replace a saved destination that is no longer configured', () => {
    renderPublish({ exportDestinationId: 'removed-site' })

    expect(readDestinationState()).toEqual({
      selectedDestination: '公開先を選択',
      frontmatter: 'title: "Sample article"\ndate: "2026-01-15"',
      unavailableMessage:
        '保存済みの公開先は利用できません。公開先を選び直してください。',
      showDiffDisabled: true,
      canCreatePullRequest: false,
      settingsUpdates: [],
      requests: [],
    })
  })

  it('does not request a file or publish when MDX conversion fails', async () => {
    vi.doMock('remark', () => ({
      remark: () => {
        throw new Error('parser failed')
      },
    }))
    renderPublish(
      {},
      {
        destinations: [
          {
            id: 'sample-site',
            format: 'mdx',
            frontmatter_template: 'title: {{ title }}\ndate: {{ date }}',
          },
        ],
      },
    )
    await clickAndWait('差分を見る', async () => {
      await vi.waitFor(() => {
        if (!document.querySelector('[role="alert"]'))
          throw new Error('Waiting for the MDX conversion error')
      })
    })

    expect(readMdxConversionFailureState()).toEqual({
      error: 'MDX 形式に変換できませんでした。',
      diff: false,
      requests: [],
    })
  })

  it('keeps the conflict error while automatically refreshing the diff', async () => {
    renderPublish()
    getResponses.push(
      { status: 200, payload: { content: 'Old body', sha: 'base-sha' } },
      { status: 200, payload: { content: 'Latest body', sha: 'latest-sha' } },
    )
    postResponses.push({ status: 409, payload: { error: 'The file changed.' } })
    await clickAndWait('差分を見る', waitForDiff)
    await clickAndWait('PR を作成', async () => {
      await vi.waitFor(() => {
        expect(readConflictState(hasButton('PR を作成'))).toEqual({
          publishButtonAfterConflict: true,
          error:
            '公開先のファイルが変更されています。差分を取り直してください。 The file changed.',
          diffContents: [
            'Latest body',
            '---\ntitle: "Sample article"\ndate: "2026-01-15"\n---\n\n# Sample body',
          ],
          publishButtonDisabled: false,
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

  it('does not update the popover after unmount while loading a diff', async () => {
    const onDiffChange = vi.fn()
    let resolvePendingGet: ((response: Response) => void) | undefined
    const responsePromise = new Promise<Response>((resolve) => {
      resolvePendingGet = resolve
    })
    pendingGetResponse = responsePromise
    renderPublish({}, { onDiffChange })
    await act(async () => {
      await page.getByRole('button', { name: '差分を見る' }).click()
    })
    await vi.waitFor(() => {
      expect(requests).toEqual([
        {
          method: 'GET',
          url: '/api/export/sample-site/articles/article-one?slug=sample-post',
          body: null,
        },
      ])
    })
    act(() => root?.unmount())
    root = undefined
    resolvePendingGet?.(Response.json({ content: 'Old body', sha: 'base-sha' }))
    await responsePromise
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))

    expect(readUnmountedDiffState(onDiffChange.mock.calls)).toEqual({
      diffChangeCalls: [],
      requests: [
        {
          method: 'GET',
          url: '/api/export/sample-site/articles/article-one?slug=sample-post',
          body: null,
        },
      ],
    })
  })
})
