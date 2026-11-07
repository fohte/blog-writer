import { EditorView } from '@codemirror/view'
import { err, ok } from 'neverthrow'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import * as Y from 'yjs'

import { getBody, setBody } from '#article/body'
import type { ArticleEditorContext } from '#components/article-editor-view'
import { ArticleFileSyncPopover } from '#components/article-file-sync-popover'
import { MarkdownEditor } from '#components/markdown-editor'
import { replaceBody as replaceEditorBody } from '#editor/replace-body'
import { createMoveHistory } from '#outline/move-history'
import type { MoveHistory } from '#outline/move-history-types'

let host: HTMLDivElement | undefined
let root: Root | undefined
let doc: Y.Doc | undefined
let history: MoveHistory | undefined
let requests: Array<{ url: string; method: string; body: unknown }> = []
let getResponses: unknown[] = []
let resumeResponses: Array<{ status: number; payload: unknown }> = []
let replacements: string[] = []
let editorChangeRange: unknown

const originalBody =
  '# Article\n\nThe original text.\n\nThis paragraph stays untouched.\n'
const importedBody =
  '# Article\n\nText from the file.\n\nThis paragraph stays untouched.\n'

const captureEditorChanges = EditorView.updateListener.of((update) => {
  for (const transaction of update.transactions) {
    if (transaction.isUserEvent('input.replace')) {
      const ranges: Array<{ from: number; to: number }> = []
      transaction.changes.iterChanges((from, to) => {
        ranges.push({ from, to })
      })
      if (ranges.length > 0) {
        editorChangeRange = {
          from: Math.min(...ranges.map(({ from }) => from)),
          to: Math.max(...ranges.map(({ to }) => to)),
        }
      }
    }
  }
})

const syncResponse = {
  content:
    '# Article\r\n\r\nText from the file.\r\n\r\nThis paragraph stays untouched.\r\n',
  content_hash: 'file-hash',
  path: 'notes/example.md',
  status: 'external_changed',
} as const

function mockFetch() {
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
      requests.push({ url, method, body })
      const path =
        body !== null &&
        typeof body === 'object' &&
        'path' in body &&
        typeof body.path === 'string'
          ? body.path
          : syncResponse.path

      let payload: unknown
      let status = 200
      if (method === 'GET') {
        const requestIndex =
          requests.filter((request) => request.method === 'GET').length - 1
        payload = getResponses[requestIndex] ?? syncResponse
      } else if (method === 'POST' && url.endsWith('/resume')) {
        const requestIndex =
          requests.filter(
            (request) =>
              request.method === 'POST' && request.url.endsWith('/resume'),
          ).length - 1
        const response = resumeResponses[requestIndex]
        if (response) {
          payload = response.payload
          status = response.status
        } else {
          payload = { ...syncResponse, content: importedBody, status: 'synced' }
        }
      } else if (method === 'POST' && url.endsWith('/overwrite')) {
        payload = { ...syncResponse, status: 'synced' }
      } else if (method === 'PUT') {
        payload = { ...syncResponse, path }
      } else {
        payload = syncResponse
      }

      return Promise.resolve(Response.json(payload, { status }))
    }),
  )
}

function mount(
  withEditor: boolean,
  viewHolder: { current?: EditorView },
  replaceBody: ArticleEditorContext['replaceBody'],
  initialStatus: 'unset' | 'synced' | 'external_changed' = 'external_changed',
  initialPath?: string,
) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const testDoc = new Y.Doc()
  doc = testDoc
  setBody(testDoc, originalBody)
  const testHistory = createMoveHistory(testDoc)
  history = testHistory

  act(() => {
    root?.render(
      <>
        {withEditor ? (
          <MarkdownEditor
            extensions={[captureEditorChanges]}
            history={testHistory}
            onViewChange={(nextView) => {
              if (nextView) viewHolder.current = nextView
              else delete viewHolder.current
            }}
            text={getBody(testDoc)}
          />
        ) : null}
        <ArticleFileSyncPopover
          articleId="story-article"
          doc={testDoc}
          initialPath={initialPath}
          initialStatus={initialStatus}
          replaceBody={replaceBody}
        />
      </>,
    )
  })

  return testDoc
}

function rerenderWithIndexState(
  initialPath: string,
  initialStatus: 'unset' | 'synced' | 'external_changed',
  replaceBody: ArticleEditorContext['replaceBody'],
) {
  if (!root || !doc) throw new Error('The article sync view is not mounted')

  root.render(
    <ArticleFileSyncPopover
      articleId="story-article"
      doc={doc}
      initialPath={initialPath}
      initialStatus={initialStatus}
      replaceBody={replaceBody}
    />,
  )
}

function readImportOutput(testDoc: Y.Doc, bodyAfterImport: string) {
  return {
    bodyAfterImport,
    bodyAfterUndo: getBody(testDoc).toJSON(),
    editorChangeRange,
    statuses: [...document.querySelectorAll('[role="status"]')].map(
      (element) => element.textContent,
    ),
    requests: [...requests],
  }
}

function readFailureOutput() {
  return {
    alert: document.querySelector('[role="alert"]')?.textContent,
    statuses: [...document.querySelectorAll('[role="status"]')].map(
      (element) => element.textContent,
    ),
    replacements: [...replacements],
    requests: [...requests],
  }
}

function readOperationOutput() {
  return {
    alert: document.querySelector('[role="alert"]')?.textContent,
    path: document.querySelector<HTMLInputElement>(
      '[aria-label="同期ファイルの相対パス"]',
    )?.value,
    statuses: [...document.querySelectorAll('[role="status"]')].map(
      (element) => element.textContent,
    ),
    replacements: [...replacements],
    requests: [...requests],
  }
}

function readResumeRecoveryOutput(
  afterFailure: ReturnType<typeof readOperationOutput>,
) {
  return {
    afterFailure,
    afterRetry: readOperationOutput(),
  }
}

async function waitForRequestCount(count: number) {
  await vi.waitFor(() => {
    if (requests.length !== count) throw new Error('Waiting for requests')
  })
}

async function waitForImportReady() {
  await vi.waitFor(() => {
    const button = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === '取り込む',
    )
    if (!button || button.disabled) throw new Error('Waiting for import')
  })
}

async function waitForStatus(label: string) {
  await vi.waitFor(() => {
    const statuses = [...document.querySelectorAll('[role="status"]')].map(
      (element) => element.textContent,
    )
    if (statuses.includes('同期しています…') || !statuses.includes(label))
      throw new Error('Waiting for synchronization to finish')
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  requests = []
  getResponses = []
  resumeResponses = []
  replacements = []
  editorChangeRange = undefined
  mockFetch()
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

describe('ArticleFileSyncPopover', () => {
  it('imports only changed text in one undo step and resumes with its hash', async () => {
    const viewHolder: { current?: EditorView } = {}
    const testDoc = mount(true, viewHolder, (value) => {
      if (!viewHolder.current)
        return err(new Error('The article editor is not ready'))
      replaceEditorBody(viewHolder.current, value)
      return ok(undefined)
    })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: 'ローカル同期' }))
    })
    await act(async () => {
      await page.getByRole('button', { name: '取り込む' }).click()
      await vi.waitFor(() => {
        if (getBody(testDoc).toJSON() !== importedBody)
          throw new Error('Waiting for the imported body')
      })
    })
    const bodyAfterImport = getBody(testDoc).toJSON()

    act(() => {
      if (viewHolder.current) history?.undo(viewHolder.current)
    })

    expect(readImportOutput(testDoc, bodyAfterImport)).toEqual({
      bodyAfterImport: importedBody,
      bodyAfterUndo: originalBody,
      editorChangeRange: { from: 12, to: 28 },
      statuses: ['同期済み'],
      requests: [
        {
          body: null,
          method: 'GET',
          url: '/api/articles/story-article/file-sync',
        },
        {
          body: { hash: 'file-hash' },
          method: 'POST',
          url: '/api/articles/story-article/file-sync/resume',
        },
      ],
    })
  })

  it('does not resume when the editor cannot replace the body', async () => {
    mount(false, {}, () => err(new Error('The article editor is not ready')))

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: 'ローカル同期' }))
    })
    await act(async () => {
      await page.getByRole('button', { name: '取り込む' }).click()
      await vi.waitFor(() => {
        if (
          document.querySelector('[role="alert"]')?.textContent !==
          'The article editor is not ready'
        )
          throw new Error('Waiting for the editor error')
      })
    })

    expect(readFailureOutput()).toEqual({
      alert: 'The article editor is not ready',
      statuses: ['外部で変更あり'],
      replacements: [],
      requests: [
        {
          body: null,
          method: 'GET',
          url: '/api/articles/story-article/file-sync',
        },
      ],
    })
  })

  it('sets the selected synchronization path', async () => {
    mount(
      false,
      {},
      () => err(new Error('The article editor is not ready')),
      'unset',
    )

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: 'ローカル同期' }))
    })
    await act(async () => {
      await page
        .getByRole('textbox', { name: '同期ファイルの相対パス' })
        .fill('notes/updated.md')
    })
    await act(async () => {
      await page.getByRole('button', { name: '指定' }).click()
      await waitForRequestCount(2)
    })

    expect(readOperationOutput()).toEqual({
      alert: undefined,
      path: 'notes/updated.md',
      statuses: ['外部で変更あり'],
      replacements: [],
      requests: [
        {
          body: null,
          method: 'GET',
          url: '/api/articles/story-article/file-sync',
        },
        {
          body: { path: 'notes/updated.md' },
          method: 'PUT',
          url: '/api/articles/story-article/file-sync',
        },
      ],
    })
  })

  it('overwrites the selected synchronization file', async () => {
    mount(false, {}, () => err(new Error('The article editor is not ready')))

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: 'ローカル同期' }))
    })
    await act(async () => {
      await page.getByRole('button', { name: '上書き' }).click()
      await waitForRequestCount(2)
    })

    expect(readOperationOutput()).toEqual({
      alert: undefined,
      path: 'notes/example.md',
      statuses: ['同期済み'],
      replacements: [],
      requests: [
        {
          body: null,
          method: 'GET',
          url: '/api/articles/story-article/file-sync',
        },
        {
          body: null,
          method: 'POST',
          url: '/api/articles/story-article/file-sync/overwrite',
        },
      ],
    })
  })

  it('reloads the file when its indexed status changes while the popover is open', async () => {
    getResponses = [
      { ...syncResponse, status: 'synced' },
      {
        ...syncResponse,
        content: '# Article\r\n\r\nUpdated outside.\r\n',
        content_hash: 'updated-hash',
      },
    ]
    mount(
      false,
      {},
      (value) => {
        replacements.push(value)
        return ok(undefined)
      },
      'synced',
      'notes/example.md',
    )

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: 'ローカル同期' }))
    })
    await waitForRequestCount(1)
    await waitForStatus('同期済み')
    act(() => {
      rerenderWithIndexState(
        'notes/example.md',
        'external_changed',
        (value) => {
          replacements.push(value)
          return ok(undefined)
        },
      )
    })
    await waitForImportReady()
    await act(async () => {
      await page.getByRole('button', { name: '取り込む' }).click()
    })
    await waitForRequestCount(3)
    await waitForStatus('同期済み')

    expect(readOperationOutput()).toEqual({
      alert: undefined,
      path: 'notes/example.md',
      statuses: ['同期済み'],
      replacements: ['# Article\n\nUpdated outside.\n'],
      requests: [
        {
          body: null,
          method: 'GET',
          url: '/api/articles/story-article/file-sync',
        },
        {
          body: null,
          method: 'GET',
          url: '/api/articles/story-article/file-sync',
        },
        {
          body: { hash: 'updated-hash' },
          method: 'POST',
          url: '/api/articles/story-article/file-sync/resume',
        },
      ],
    })
  })

  it('reloads changed file content after resume fails and keeps the error visible', async () => {
    const latestResponse = {
      ...syncResponse,
      content:
        '# Article\r\n\r\nThe latest file text.\r\n\r\nThis paragraph stays untouched.\r\n',
      content_hash: 'latest-hash',
    }
    getResponses = [syncResponse, latestResponse]
    resumeResponses = [
      { status: 409, payload: { error: 'The file changed after reading.' } },
      { status: 200, payload: { ...latestResponse, status: 'synced' } },
    ]
    mount(false, {}, (value) => {
      replacements.push(value)
      return ok(undefined)
    })

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: 'ローカル同期' }))
    })
    await waitForImportReady()
    await act(async () => {
      await page.getByRole('button', { name: '取り込む' }).click()
    })
    await waitForRequestCount(3)
    await waitForImportReady()
    const outputAfterFailure = readOperationOutput()
    await act(async () => {
      await page.getByRole('button', { name: '取り込む' }).click()
    })
    await waitForRequestCount(4)
    await waitForStatus('同期済み')

    expect(readResumeRecoveryOutput(outputAfterFailure)).toEqual({
      afterFailure: {
        alert: '同期を再開できませんでした: The file changed after reading.',
        path: 'notes/example.md',
        statuses: ['外部で変更あり'],
        replacements: [importedBody],
        requests: [
          {
            body: null,
            method: 'GET',
            url: '/api/articles/story-article/file-sync',
          },
          {
            body: { hash: 'file-hash' },
            method: 'POST',
            url: '/api/articles/story-article/file-sync/resume',
          },
          {
            body: null,
            method: 'GET',
            url: '/api/articles/story-article/file-sync',
          },
        ],
      },
      afterRetry: {
        alert: undefined,
        path: 'notes/example.md',
        statuses: ['同期済み'],
        replacements: [
          importedBody,
          '# Article\n\nThe latest file text.\n\nThis paragraph stays untouched.\n',
        ],
        requests: [
          {
            body: null,
            method: 'GET',
            url: '/api/articles/story-article/file-sync',
          },
          {
            body: { hash: 'file-hash' },
            method: 'POST',
            url: '/api/articles/story-article/file-sync/resume',
          },
          {
            body: null,
            method: 'GET',
            url: '/api/articles/story-article/file-sync',
          },
          {
            body: { hash: 'latest-hash' },
            method: 'POST',
            url: '/api/articles/story-article/file-sync/resume',
          },
        ],
      },
    })
  })
})
