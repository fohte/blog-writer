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

const readPanelOutput = (doc: Y.Doc) => ({
  memos: listMemos(doc).map(({ id, ...memo }) => ({
    ...memo,
    id: id.length > 0 ? 'generated-id' : 'empty-id',
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
})

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

    expect(readPanelOutput(doc)).toEqual({
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

    expect(readPanelOutput(doc)).toEqual({
      memos: [
        {
          id: 'generated-id',
          text: '次の案',
          order: 0,
          state: { kind: 'unorganized' },
        },
        {
          id: 'generated-id',
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
          id: 'generated-id',
          text: '最初の案',
          order: 0,
          state: { kind: 'dismissed' },
        },
      ],
      rendered: [{ text: '最初の案', state: '見送り' }],
      draft: '',
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
          id: 'generated-id',
          text: '最初の案',
          order: 0,
          state: { kind: 'unorganized' },
        },
      ],
      rendered: [{ text: '最初の案', state: '未整理' }],
      draft: '',
    })
  })

  it('refreshes an adopted heading after the article body changes', () => {
    const doc = new Y.Doc()
    setBody(doc, '# Section')
    addMemo(doc, { id: 'memo-a', text: '最初の案', order: 0 })
    setMemoAdoptedTo(doc, 'memo-a', 0)
    mountMemoPanel(doc)
    const body = doc.getText('body')

    act(() => {
      body.delete(2, 'Section'.length)
      body.insert(2, 'Updated')
    })

    expect(readPanelOutput(doc)).toEqual({
      memos: [
        {
          id: 'generated-id',
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
    })
  })
})
