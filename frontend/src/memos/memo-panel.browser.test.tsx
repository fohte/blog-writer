import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { addMemo, listMemos, setBody, setMemoAdoptedTo } from '#article/index'
import { MemoPanel } from '#memos/memo-panel'

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

beforeEach(() => {
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
    const textarea = host?.querySelector('textarea')

    act(() => {
      if (textarea) {
        Object.defineProperty(textarea, 'value', {
          configurable: true,
          writable: true,
          value: '記事の導入を簡潔にする',
        })
      }
      textarea?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    clickButton('追加')

    const readOutput = () => ({
      memos: listMemos(doc).map(({ id, ...memo }) => ({
        ...memo,
        id: id.length > 0 ? 'generated-id' : 'empty-id',
      })),
      draft: host?.querySelector<HTMLTextAreaElement>('textarea')?.value,
    })

    expect(readOutput()).toEqual({
      memos: [
        {
          id: 'generated-id',
          text: '記事の導入を簡潔にする',
          order: 0,
          state: { kind: 'unorganized' },
        },
      ],
      draft: '',
    })
  })

  it('moves a memo in the article list', () => {
    const doc = new Y.Doc()
    addMemo(doc, { id: 'memo-a', text: '最初の案', order: 0 })
    addMemo(doc, { id: 'memo-b', text: '次の案', order: 1 })
    mountMemoPanel(doc)

    act(() => {
      host
        ?.querySelector<HTMLButtonElement>(
          '[aria-label="メモ「最初の案」を下へ"]',
        )
        ?.click()
    })

    expect(listMemos(doc)).toEqual([
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
    ])
  })

  it('marks an unorganized memo as dismissed', () => {
    const doc = new Y.Doc()
    addMemo(doc, { id: 'memo-a', text: '最初の案', order: 0 })
    mountMemoPanel(doc)

    clickButton('見送る')

    expect(listMemos(doc)).toEqual([
      {
        id: 'memo-a',
        text: '最初の案',
        order: 0,
        state: { kind: 'dismissed' },
      },
    ])
  })

  it('restores an adopted memo to unorganized', () => {
    const doc = new Y.Doc()
    setBody(doc, '# Section')
    addMemo(doc, { id: 'memo-a', text: '最初の案', order: 0 })
    setMemoAdoptedTo(doc, 'memo-a', 0)
    mountMemoPanel(doc)

    clickButton('未整理に戻す')

    expect(listMemos(doc)).toEqual([
      {
        id: 'memo-a',
        text: '最初の案',
        order: 0,
        state: { kind: 'unorganized' },
      },
    ])
  })
})
