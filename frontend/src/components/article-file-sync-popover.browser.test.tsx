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

      return Promise.resolve(
        Response.json(
          method === 'POST' && url.endsWith('/resume')
            ? {
                ...syncResponse,
                content: '# Article\n\nText from the file.\n',
                status: 'synced',
              }
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
          initialStatus="external_changed"
          replaceBody={replaceBody}
        />
      </>,
    )
  })

  return testDoc
}

function readImportOutput(testDoc: Y.Doc) {
  return {
    bodyAfterUndo: getBody(testDoc).toJSON(),
    requests,
  }
}

function readFailureOutput() {
  return {
    alert: document.querySelector('[role="alert"]')?.textContent,
    requests,
  }
}

function readImportButtonDisabled() {
  return [...document.querySelectorAll('button')].find(
    (button) => button.textContent === '取り込む',
  )?.disabled
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
        expect(getBody(testDoc).toJSON()).toEqual(
          '# Article\n\nText from the file.\n',
        )
      })
    })

    act(() => {
      if (viewHolder.current) history?.undo(viewHolder.current)
    })

    expect(readImportOutput(testDoc)).toEqual({
      bodyAfterUndo: '# Article\n\nThe original text.\n',
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
      await vi.waitFor(() => {
        expect(readImportButtonDisabled()).toEqual(false)
      })
    })
    await act(async () => {
      await page.getByRole('button', { name: '取り込む' }).click()
      await vi.waitFor(() => {
        expect(readFailureOutput().alert).toEqual(
          'The article editor is not ready',
        )
      })
    })

    expect(readFailureOutput()).toEqual({
      alert: 'The article editor is not ready',
      requests: [
        {
          body: null,
          method: 'GET',
          url: '/api/articles/story-article/file-sync',
        },
      ],
    })
  })
})
