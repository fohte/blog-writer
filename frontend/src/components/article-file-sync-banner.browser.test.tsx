import type { EditorView } from '@codemirror/view'
import { err, ok } from 'neverthrow'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import * as Y from 'yjs'

import { getBody, setBody } from '#article/body'
import type { ArticleExportSection } from '#components/article-export-screen'
import { ArticleFileSyncBanner } from '#components/article-file-sync-banner'
import { MarkdownEditor } from '#components/markdown-editor'
import { replaceBody as replaceEditorBody } from '#editor/replace-body'
import type { ArticleFileSyncStatus } from '#lib/file-sync-api'
import { createMoveHistory } from '#outline/move-history'
import type { MoveHistory } from '#outline/move-history-types'

let host: HTMLDivElement | undefined
let root: Root | undefined
let doc: Y.Doc | undefined
let history: MoveHistory | undefined
let requests: Array<{ url: string; method: string }> = []
let fileResponse: unknown
let openedSections: Array<ArticleExportSection | undefined> = []
let editorView: EditorView | null = null
let holdResume = false
let releaseResume: (() => void) | undefined

const originalBody = '# Article\n\nThe original text.\n'
const fileBody = '# Article\n\nText from the file.\n'

function stubFetch() {
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
      requests.push({ url, method })
      const payload =
        method === 'GET'
          ? fileResponse
          : {
              content: fileBody,
              content_hash: 'file-hash',
              path: 'notes/example.md',
              status: 'synced',
            }
      if (holdResume && url.endsWith('/resume'))
        return new Promise<Response>((resolve) => {
          releaseResume = () => {
            resolve(Response.json(payload))
          }
        })
      return Promise.resolve(Response.json(payload))
    }),
  )
}

function BannerHarness({
  articleDoc,
  moveHistory,
  initialStatus,
}: {
  articleDoc: Y.Doc
  moveHistory: MoveHistory
  initialStatus: ArticleFileSyncStatus
}) {
  const [view, setView] = useState<EditorView | null>(null)

  return (
    <>
      <MarkdownEditor
        history={moveHistory}
        onViewChange={(nextView) => {
          editorView = nextView
          setView(nextView)
        }}
        text={getBody(articleDoc)}
      />
      <ArticleFileSyncBanner
        context={{
          articleId: 'sample-article',
          doc: articleDoc,
          history: moveHistory,
          view,
          replaceBody: (value) => {
            if (!view) return err(new Error('The article editor is not ready'))
            replaceEditorBody(view, value)
            return ok(undefined)
          },
          showSources: () => {},
          openExport: (section) => {
            openedSections.push(section)
          },
        }}
        initialPath="notes/example.md"
        initialStatus={initialStatus}
      />
    </>
  )
}

function mount(initialStatus: ArticleFileSyncStatus) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const articleDoc = new Y.Doc()
  doc = articleDoc
  setBody(articleDoc, originalBody)
  const moveHistory = createMoveHistory(articleDoc)
  history = moveHistory
  act(() => {
    root?.render(
      <BannerHarness
        articleDoc={articleDoc}
        initialStatus={initialStatus}
        moveHistory={moveHistory}
      />,
    )
  })
}

function readBanner() {
  const banner = document.querySelector('[aria-label="ファイル同期"]')
  return {
    message: banner?.querySelector('span')?.textContent ?? null,
    actions: [...(banner?.querySelectorAll('button') ?? [])].map(
      ({ textContent }) => textContent,
    ),
    body: doc === undefined ? null : getBody(doc).toJSON(),
    requests: [...requests],
    openedSections: [...openedSections],
  }
}

async function waitForEnabledButton(name: string) {
  await vi.waitFor(() => {
    const button = [...document.querySelectorAll('button')].find(
      ({ textContent }) => textContent === name,
    )
    if (!button || button.disabled) throw new Error(`Waiting for ${name}`)
  })
}

async function clickButton(name: string) {
  await waitForEnabledButton(name)
  await act(async () => {
    await page.getByRole('button', { name, exact: true }).click()
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  requests = []
  openedSections = []
  holdResume = false
  releaseResume = undefined
  fileResponse = {
    content: fileBody.replaceAll('\n', '\r\n'),
    content_hash: 'file-hash',
    path: 'notes/example.md',
    status: 'external_changed',
  }
  stubFetch()
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

describe('ArticleFileSyncBanner', () => {
  it('stays hidden without reading the file while the file is in sync', () => {
    mount('synced')

    expect(readBanner()).toEqual({
      message: null,
      actions: [],
      body: originalBody,
      requests: [],
      openedSections: [],
    })
  })

  it('opens the file sync form to compare the changed file', async () => {
    mount('external_changed')
    await clickButton('差分を見る')

    expect(readBanner()).toEqual({
      message:
        '! notes/example.md がアプリの外で変更されました。ファイルへの書き込みだけ止めています。ここでの編集は保存されています。',
      actions: [
        '差分を見る',
        'ファイルの内容を取り込む',
        'アプリの内容で上書き',
      ],
      body: originalBody,
      requests: [
        { url: '/api/articles/sample-article/file-sync', method: 'GET' },
      ],
      openedSections: ['sync'],
    })
  })

  it('imports the changed file and offers to undo the import', async () => {
    mount('external_changed')
    await clickButton('ファイルの内容を取り込む')

    expect(readBanner()).toEqual({
      message: 'ファイルの内容を取り込みました',
      actions: ['元に戻す ⌘Z'],
      body: fileBody,
      requests: [
        { url: '/api/articles/sample-article/file-sync', method: 'GET' },
        {
          url: '/api/articles/sample-article/file-sync/resume',
          method: 'POST',
        },
      ],
      openedSections: [],
    })
  })

  it('restores the body and hides the banner when the import is undone', async () => {
    mount('external_changed')
    await clickButton('ファイルの内容を取り込む')
    await clickButton('元に戻す ⌘Z')

    expect(readBanner()).toEqual({
      message: null,
      actions: [],
      body: originalBody,
      requests: [
        { url: '/api/articles/sample-article/file-sync', method: 'GET' },
        {
          url: '/api/articles/sample-article/file-sync/resume',
          method: 'POST',
        },
      ],
      openedSections: [],
    })
  })

  it('does not offer to undo the import once the body was edited during the import', async () => {
    holdResume = true
    mount('external_changed')
    await clickButton('ファイルの内容を取り込む')
    act(() => {
      editorView?.dispatch({
        changes: {
          from: editorView.state.doc.length,
          insert: 'A later edit.\n',
        },
        userEvent: 'input.type',
      })
    })
    releaseResume?.()
    await vi.waitFor(() => {
      if (readBanner().message?.startsWith('!') === true)
        throw new Error('Waiting for the import to finish')
    })

    expect(readBanner()).toEqual({
      message: null,
      actions: [],
      body: `${fileBody}A later edit.\n`,
      requests: [
        { url: '/api/articles/sample-article/file-sync', method: 'GET' },
        {
          url: '/api/articles/sample-article/file-sync/resume',
          method: 'POST',
        },
      ],
      openedSections: [],
    })
  })

  it('recreates a missing file from the app body', async () => {
    fileResponse = {
      content: null,
      content_hash: null,
      path: 'notes/example.md',
      status: 'external_changed',
    }
    mount('external_changed')
    await waitForEnabledButton('作り直す')
    const missingBanner = readBanner()
    await clickButton('作り直す')
    const readRecreation = () => ({ missingBanner, after: readBanner() })

    expect(readRecreation()).toEqual({
      missingBanner: {
        message:
          '! notes/example.md が見つかりません。ファイルへの書き込みだけ止めています。ここでの編集は保存されています。',
        actions: ['作り直す', 'パスを指定し直す'],
        body: originalBody,
        requests: [
          { url: '/api/articles/sample-article/file-sync', method: 'GET' },
        ],
        openedSections: [],
      },
      after: {
        message: null,
        actions: [],
        body: originalBody,
        requests: [
          { url: '/api/articles/sample-article/file-sync', method: 'GET' },
          {
            url: '/api/articles/sample-article/file-sync/overwrite',
            method: 'POST',
          },
        ],
        openedSections: [],
      },
    })
  })
})
