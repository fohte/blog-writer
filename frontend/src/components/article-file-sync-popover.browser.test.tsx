import type { EditorView } from '@codemirror/view'
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

const syncResponse = {
  content: '# Article\r\n\r\nText from the file.\r\n',
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

      return Promise.resolve(
        Response.json(
          method === 'POST' && url.endsWith('/resume')
            ? {
                ...syncResponse,
                content: '# Article\n\nText from the file.\n',
                status: 'synced',
              }
            : method === 'POST' && url.endsWith('/overwrite')
              ? { ...syncResponse, status: 'synced' }
              : method === 'PUT'
                ? { ...syncResponse, path }
                : syncResponse,
        ),
      )
    }),
  )
}

function mount(
  withEditor: boolean,
  viewHolder: { current?: EditorView },
  replaceBody: ArticleEditorContext['replaceBody'],
  initialStatus: 'unset' | 'synced' | 'external_changed' = 'external_changed',
) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const testDoc = new Y.Doc()
  doc = testDoc
  setBody(testDoc, '# Article\n\nThe original text.\n')
  const testHistory = createMoveHistory(testDoc)
  history = testHistory

  act(() => {
    root?.render(
      <>
        {withEditor ? (
          <MarkdownEditor
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
          initialStatus={initialStatus}
          replaceBody={replaceBody}
        />
      </>,
    )
  })

  return testDoc
}

function readImportOutput(testDoc: Y.Doc, bodyAfterImport: string) {
  return {
    bodyAfterImport,
    bodyAfterUndo: getBody(testDoc).toJSON(),
    statuses: [...document.querySelectorAll('[role="status"]')].map(
      (element) => element.textContent,
    ),
    requests,
  }
}

function readFailureOutput() {
  return {
    alert: document.querySelector('[role="alert"]')?.textContent,
    statuses: [...document.querySelectorAll('[role="status"]')].map(
      (element) => element.textContent,
    ),
    requests,
  }
}

function readOperationOutput() {
  return {
    path: document.querySelector<HTMLInputElement>(
      '[aria-label="同期ファイルの相対パス"]',
    )?.value,
    statuses: [...document.querySelectorAll('[role="status"]')].map(
      (element) => element.textContent,
    ),
    requests,
  }
}

async function waitForRequestCount(count: number) {
  await vi.waitFor(() => {
    if (requests.length !== count) throw new Error('Waiting for requests')
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  requests = []
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
  it('imports the displayed LF content in one undo step and resumes with its hash', async () => {
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
        if (getBody(testDoc).toJSON() !== '# Article\n\nText from the file.\n')
          throw new Error('Waiting for the imported body')
      })
    })
    const bodyAfterImport = getBody(testDoc).toJSON()

    act(() => {
      if (viewHolder.current) history?.undo(viewHolder.current)
    })

    expect(readImportOutput(testDoc, bodyAfterImport)).toEqual({
      bodyAfterImport: '# Article\n\nText from the file.\n',
      bodyAfterUndo: '# Article\n\nThe original text.\n',
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
      path: 'notes/updated.md',
      statuses: ['外部で変更あり'],
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
      path: 'notes/example.md',
      statuses: ['同期済み'],
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
})
