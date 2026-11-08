import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import * as Y from 'yjs'

import {
  addMemo,
  dismissMemo,
  getBody,
  listMemos,
  restoreMemo,
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

const mountMemoPanel = (doc: Y.Doc, mobile = false) => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)

  act(() => {
    root?.render(<MemoPanel doc={doc} mobile={mobile} />)
  })
}

const clickButton = (name: string) => {
  // The adoption menu renders in a portal outside the panel host.
  const button = [...document.body.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === name,
  )
  if (!button) throw new Error(`The button ${name} is missing`)
  act(() => {
    button.click()
  })
}

const openAdoptionMenu = (memoId: string) => {
  const trigger = [
    ...(host?.querySelectorAll<HTMLButtonElement>(
      `[data-memo-id="${memoId}"] button`,
    ) ?? []),
  ].find((button) => ['採用', '変更'].includes(button.textContent))
  if (!trigger) throw new Error(`The adoption menu of ${memoId} is missing`)
  act(() => {
    trigger.click()
  })
}

const submitDraft = async (value: string) => {
  const input = page.getByRole('textbox', { name: 'メモを足す' })
  await userEvent.fill(input, value)
  await userEvent.keyboard('{Enter}')
}

const readPanelOutput = (doc: Y.Doc, generatedId?: string) => ({
  memos: listMemos(doc).map(({ id, ...memo }) => ({
    ...memo,
    id: id === generatedId ? 'generated-id' : id,
  })),
  filters: [
    ...(host?.querySelectorAll('[aria-label="表示するメモ"] button') ?? []),
  ].map((button) =>
    button.getAttribute('aria-pressed') === 'true'
      ? `${button.textContent} (selected)`
      : button.textContent,
  ),
  rendered: [...(host?.querySelectorAll('[role="listitem"]') ?? [])].map(
    (item) => [...item.querySelectorAll('p')].map((p) => p.textContent),
  ),
  draft: host?.querySelector<HTMLInputElement>('#new-memo')?.value,
  alert: host?.querySelector('[role="alert"]')?.textContent,
})

const readPanelOutputWithMenu = (doc: Y.Doc) => ({
  output: readPanelOutput(doc),
  menuOpen:
    document.body.querySelector('[data-slot="popover-content"]') !== null,
})

const readLatestAdoption = () =>
  [...(host?.querySelectorAll('[aria-label="最近の採用"] p') ?? [])].map(
    (line) => line.textContent,
  )

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
  it('adds a memo with Enter and clears the draft', async () => {
    const doc = new Y.Doc()
    mountMemoPanel(doc)
    await submitDraft('記事の導入を簡潔にする')
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
      filters: ['未整理 1 (selected)', '採用済み 0', '見送り 0'],
      rendered: [['記事の導入を簡潔にする']],
      draft: '',
      alert: undefined,
    })
  })

  it('ignores Enter while the draft is blank', async () => {
    const doc = new Y.Doc()
    mountMemoPanel(doc)
    await submitDraft('   ')

    expect(readPanelOutput(doc)).toEqual({
      memos: [],
      filters: ['未整理 0 (selected)', '採用済み 0', '見送り 0'],
      rendered: [],
      draft: '   ',
      alert: undefined,
    })
  })

  it('shows an alert when a dismiss action fails', () => {
    const doc = new Y.Doc()
    addMemo(doc, { id: 'memo-a', text: '最初の案', order: 0 })
    mountMemoPanel(doc)
    memoMocks.failNextDismiss = true

    openAdoptionMenu('memo-a')
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
      filters: ['未整理 1 (selected)', '採用済み 0', '見送り 0'],
      rendered: [['最初の案']],
      draft: '',
      alert: 'メモを更新できませんでした。',
    })
  })

  it.each([
    {
      name: 'moves a memo above the previous memo in the same state',
      memoId: 'memo-b',
      action: 'メモ「次の案」を上へ',
      expectedMemos: [
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
        {
          id: 'memo-x',
          text: '見送った案',
          order: 2,
          state: { kind: 'dismissed' },
        },
      ],
    },
    {
      name: 'moves a memo below the next memo in the same state',
      memoId: 'memo-a',
      action: 'メモ「最初の案」を下へ',
      expectedMemos: [
        {
          id: 'memo-x',
          text: '見送った案',
          order: 0,
          state: { kind: 'dismissed' },
        },
        {
          id: 'memo-b',
          text: '次の案',
          order: 1,
          state: { kind: 'unorganized' },
        },
        {
          id: 'memo-a',
          text: '最初の案',
          order: 2,
          state: { kind: 'unorganized' },
        },
      ],
    },
  ])('$name', ({ memoId, action, expectedMemos }) => {
    const doc = new Y.Doc()
    addMemo(doc, { id: 'memo-a', text: '最初の案', order: 0 })
    addMemo(doc, { id: 'memo-x', text: '見送った案', order: 1 })
    addMemo(doc, { id: 'memo-b', text: '次の案', order: 2 })
    dismissMemo(doc, 'memo-x')
    mountMemoPanel(doc)

    openAdoptionMenu(memoId)
    act(() => {
      document.body
        .querySelector<HTMLButtonElement>(`[aria-label="${action}"]`)
        ?.click()
    })

    expect(readPanelOutput(doc)).toEqual({
      memos: expectedMemos,
      filters: ['未整理 2 (selected)', '採用済み 0', '見送り 1'],
      rendered: [['次の案'], ['最初の案']],
      draft: '',
      alert: undefined,
    })
  })

  it('keeps the adoption menu closed after its memo leaves and returns to the filter', () => {
    const doc = new Y.Doc()
    addMemo(doc, { id: 'memo-a', text: '最初の案', order: 0 })
    mountMemoPanel(doc)

    openAdoptionMenu('memo-a')
    act(() => {
      dismissMemo(doc, 'memo-a')
    })
    act(() => {
      restoreMemo(doc, 'memo-a')
    })

    expect(readPanelOutputWithMenu(doc)).toEqual({
      output: {
        memos: [
          {
            id: 'memo-a',
            text: '最初の案',
            order: 0,
            state: { kind: 'unorganized' },
          },
        ],
        filters: ['未整理 1 (selected)', '採用済み 0', '見送り 0'],
        rendered: [['最初の案']],
        draft: '',
        alert: undefined,
      },
      menuOpen: false,
    })
  })

  it('marks an unorganized memo as dismissed', () => {
    const doc = new Y.Doc()
    addMemo(doc, { id: 'memo-a', text: '最初の案', order: 0 })
    mountMemoPanel(doc)

    openAdoptionMenu('memo-a')
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
      filters: ['未整理 0 (selected)', '採用済み 0', '見送り 1'],
      rendered: [],
      draft: '',
      alert: undefined,
    })
  })

  it('adopts a memo to a heading from the bottom sheet on a phone', () => {
    const doc = new Y.Doc()
    setBody(doc, '# Section')
    addMemo(doc, { id: 'memo-a', text: '最初の案', order: 0 })
    mountMemoPanel(doc, true)

    openAdoptionMenu('memo-a')
    const sheet = document.body.querySelector('[role="dialog"]')
    const sheetBeforeAdopt = {
      label: sheet?.getAttribute('aria-label'),
      title: sheet?.querySelector('h2')?.textContent,
      buttons: [...(sheet?.querySelectorAll('button') ?? [])].map(
        (button) => button.textContent,
      ),
    }
    clickButton('# Section')

    const readOutput = () => ({
      sheetBeforeAdopt,
      sheetOpenAfterAdopt:
        document.body.querySelector('[role="dialog"]') !== null,
      memos: listMemos(doc),
    })
    expect(readOutput()).toEqual({
      sheetBeforeAdopt: {
        label: '採用先',
        title: '最初の案',
        buttons: ['# Section', '上へ', '下へ', '見送る', 'キャンセル'],
      },
      sheetOpenAfterAdopt: false,
      memos: [
        {
          id: 'memo-a',
          text: '最初の案',
          order: 0,
          state: {
            kind: 'adopted',
            heading: {
              level: 1,
              text: 'Section',
              from: 0,
              to: 9,
              children: [],
            },
          },
        },
      ],
    })
  })

  it('dismisses an adopted memo', () => {
    const doc = new Y.Doc()
    setBody(doc, '# Section')
    addMemo(doc, { id: 'memo-a', text: '最初の案', order: 0 })
    setMemoAdoptedTo(doc, 'memo-a', 0)
    mountMemoPanel(doc)

    clickButton('採用済み 1')
    openAdoptionMenu('memo-a')
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
      filters: ['未整理 0', '採用済み 0 (selected)', '見送り 1'],
      rendered: [],
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

    clickButton('採用済み 1')
    openAdoptionMenu('memo-a')
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
      filters: ['未整理 1', '採用済み 0 (selected)', '見送り 0'],
      rendered: [],
      draft: '',
      alert: undefined,
    })
  })

  it('restores a dismissed memo to unorganized', () => {
    const doc = new Y.Doc()
    addMemo(doc, { id: 'memo-a', text: '最初の案', order: 0 })
    dismissMemo(doc, 'memo-a')
    mountMemoPanel(doc)

    clickButton('見送り 1')
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
      filters: ['未整理 1', '採用済み 0', '見送り 0 (selected)'],
      rendered: [],
      draft: '',
      alert: undefined,
    })
  })

  it('names the memo adopted most recently, even when its heading stays the same', () => {
    const doc = new Y.Doc()
    const markdown = '# Alpha\n\n## Beta\n'
    setBody(doc, markdown)
    addMemo(doc, { id: 'memo-a', text: '最初の案', order: 0 })
    addMemo(doc, { id: 'memo-b', text: '次の案', order: 1 })
    setMemoAdoptedTo(doc, 'memo-a', 0, '2026-03-01T00:00:00.000Z')
    setMemoAdoptedTo(
      doc,
      'memo-b',
      markdown.indexOf('## Beta'),
      '2026-03-02T00:00:00.000Z',
    )
    mountMemoPanel(doc)
    const afterMount = readLatestAdoption()

    act(() => {
      setMemoAdoptedTo(doc, 'memo-a', 0, '2026-03-03T00:00:00.000Z')
    })

    const readOutput = () => ({
      afterMount,
      afterAdoptingAgain: readLatestAdoption(),
    })
    expect(readOutput()).toEqual({
      afterMount: ['最近の採用', '[x] 次の案', '→ ## Beta'],
      afterAdoptingAgain: ['最近の採用', '[x] 最初の案', '→ # Alpha'],
    })
  })

  it('refreshes an adopted heading after the article body changes', () => {
    const doc = new Y.Doc()
    setBody(doc, '# Section')
    addMemo(doc, { id: 'memo-a', text: '最初の案', order: 0 })
    setMemoAdoptedTo(doc, 'memo-a', 0)
    mountMemoPanel(doc)
    clickButton('採用済み 1')
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
      filters: ['未整理 0', '採用済み 1 (selected)', '見送り 0'],
      rendered: [['[x] 最初の案', '→ # Updated']],
      draft: '',
      alert: undefined,
    })
  })
})
