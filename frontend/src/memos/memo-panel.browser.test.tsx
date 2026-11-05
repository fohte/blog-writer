import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import {
  addMemo,
  dismissMemo,
  getBody,
  listMemos,
  setBody,
  setMemoAdoptedTo,
} from '#article/index'
import { MemoPanel } from '#memos/memo-panel'

const memoMocks = vi.hoisted(() => ({
  failNextDismiss: false,
}))

vi.mock('#article/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#article/index')>()

  return {
    ...actual,
    dismissMemo: (...args: Parameters<typeof actual.dismissMemo>) => {
      if (!memoMocks.failNextDismiss) return actual.dismissMemo(...args)

      memoMocks.failNextDismiss = false
      return actual.dismissMemo(args[0], 'missing-memo')
    },
  }
})

let host: HTMLDivElement | undefined
let root: Root | undefined

const mountMemoPanel = (doc: Y.Doc) => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)

  act(() => {
    root?.render(<MemoPanel doc={doc} />)
  })
}

const clickButton = (name: string) => {
  const button = [...(host?.querySelectorAll('button') ?? [])].find(
    (candidate) => candidate.textContent === name,
  )
  act(() => {
    button?.click()
  })
}

const setDraft = (value: string) => {
  const textarea = host?.querySelector<HTMLTextAreaElement>('textarea')

  act(() => {
    if (textarea) {
      Object.defineProperty(textarea, 'value', {
        configurable: true,
        writable: true,
        value,
      })
    }
    textarea?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const readPanelOutput = (doc: Y.Doc, generatedId?: string) => ({
  memos: listMemos(doc).map(({ id, ...memo }) => ({
    ...memo,
    id: id === generatedId ? 'generated-id' : id,
  })),
  rendered: [...(host?.querySelectorAll('[role="listitem"]') ?? [])].map(
    (item) => {
      const paragraphs = item.querySelectorAll('p')
      return {
        text: paragraphs.item(0).textContent,
        state: paragraphs.item(1).textContent,
      }
    },
  ),
  draft: host?.querySelector<HTMLTextAreaElement>('textarea')?.value,
  alert: host?.querySelector('[role="alert"]')?.textContent,
})

beforeEach(() => {
  memoMocks.failNextDismiss = false
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = undefined
  host?.remove()
  host = undefined
  vi.unstubAllGlobals()
})

describe('MemoPanel', () => {
  it('adds a memo to the article and clears the draft', () => {
    const doc = new Y.Doc()
    mountMemoPanel(doc)
    setDraft('記事の導入を簡潔にする')
    clickButton('追加')
    const generatedId = listMemos(doc)[0]?.id

    expect(readPanelOutput(doc, generatedId)).toEqual({
      memos: [
        {
          id: 'generated-id',
          text: '記事の導入を簡潔にする',
          order: 0,
          state: { kind: 'unorganized' },
        },
      ],
      rendered: [{ text: '記事の導入を簡潔にする', state: '未整理' }],
      draft: '',
      alert: undefined,
    })
  })

  it('shows an alert when a dismiss action fails', () => {
    const doc = new Y.Doc()
    addMemo(doc, { id: 'memo-a', text: '最初の案', order: 0 })
    mountMemoPanel(doc)
    memoMocks.failNextDismiss = true

    clickButton('見送る')

    expect(readPanelOutput(doc)).toEqual({
      memos: [
        {
          id: 'memo-a',
          text: '最初の案',
          order: 0,
          state: { kind: 'unorganized' },
        },
      ],
      rendered: [{ text: '最初の案', state: '未整理' }],
      draft: '',
      alert: 'メモを更新できませんでした。',
    })
  })

  it('moves a memo up in the article list', () => {
    const doc = new Y.Doc()
    addMemo(doc, { id: 'memo-a', text: '最初の案', order: 0 })
    addMemo(doc, { id: 'memo-b', text: '次の案', order: 1 })
    mountMemoPanel(doc)

    act(() => {
      host
        ?.querySelector<HTMLButtonElement>(
          '[aria-label="メモ「次の案」を上へ"]',
        )
        ?.click()
    })

    expect(readPanelOutput(doc)).toEqual({
      memos: [
        {
          id: 'memo-b',
          text: '次の案',
          order: 0,
          state: { kind: 'unorganized' },
        },
        {
          id: 'memo-a',
          text: '最初の案',
          order: 1,
          state: { kind: 'unorganized' },
        },
      ],
      rendered: [
        { text: '次の案', state: '未整理' },
        { text: '最初の案', state: '未整理' },
      ],
      draft: '',
      alert: undefined,
    })
  })

  it('marks an unorganized memo as dismissed', () => {
    const doc = new Y.Doc()
    addMemo(doc, { id: 'memo-a', text: '最初の案', order: 0 })
    mountMemoPanel(doc)

    clickButton('見送る')

    expect(readPanelOutput(doc)).toEqual({
      memos: [
        {
          id: 'memo-a',
          text: '最初の案',
          order: 0,
          state: { kind: 'dismissed' },
        },
      ],
      rendered: [{ text: '最初の案', state: '見送り' }],
      draft: '',
      alert: undefined,
    })
  })

  it('dismisses an adopted memo', () => {
    const doc = new Y.Doc()
    setBody(doc, '# Section')
    addMemo(doc, { id: 'memo-a', text: '最初の案', order: 0 })
    setMemoAdoptedTo(doc, 'memo-a', 0)
    mountMemoPanel(doc)

    clickButton('見送る')

    expect(readPanelOutput(doc)).toEqual({
      memos: [
        {
          id: 'memo-a',
          text: '最初の案',
          order: 0,
          state: { kind: 'dismissed' },
        },
      ],
      rendered: [{ text: '最初の案', state: '見送り' }],
      draft: '',
      alert: undefined,
    })
  })

  it('restores an adopted memo to unorganized', () => {
    const doc = new Y.Doc()
    setBody(doc, '# Section')
    addMemo(doc, { id: 'memo-a', text: '最初の案', order: 0 })
    setMemoAdoptedTo(doc, 'memo-a', 0)
    mountMemoPanel(doc)

    clickButton('未整理に戻す')

    expect(readPanelOutput(doc)).toEqual({
      memos: [
        {
          id: 'memo-a',
          text: '最初の案',
          order: 0,
          state: { kind: 'unorganized' },
        },
      ],
      rendered: [{ text: '最初の案', state: '未整理' }],
      draft: '',
      alert: undefined,
    })
  })

  it('restores a dismissed memo to unorganized', () => {
    const doc = new Y.Doc()
    addMemo(doc, { id: 'memo-a', text: '最初の案', order: 0 })
    dismissMemo(doc, 'memo-a')
    mountMemoPanel(doc)

    clickButton('未整理に戻す')

    expect(readPanelOutput(doc)).toEqual({
      memos: [
        {
          id: 'memo-a',
          text: '最初の案',
          order: 0,
          state: { kind: 'unorganized' },
        },
      ],
      rendered: [{ text: '最初の案', state: '未整理' }],
      draft: '',
      alert: undefined,
    })
  })

  it('refreshes an adopted heading after the article body changes', () => {
    const doc = new Y.Doc()
    setBody(doc, '# Section')
    addMemo(doc, { id: 'memo-a', text: '最初の案', order: 0 })
    setMemoAdoptedTo(doc, 'memo-a', 0)
    mountMemoPanel(doc)
    const body = getBody(doc)

    act(() => {
      body.delete(2, 'Section'.length)
      body.insert(2, 'Updated')
    })

    expect(readPanelOutput(doc)).toEqual({
      memos: [
        {
          id: 'memo-a',
          text: '最初の案',
          order: 0,
          state: {
            kind: 'adopted',
            heading: {
              level: 1,
              text: 'Updated',
              from: 0,
              to: 9,
              children: [],
            },
          },
        },
      ],
      rendered: [{ text: '最初の案', state: '採用済み: Updated' }],
      draft: '',
      alert: undefined,
    })
  })
})
