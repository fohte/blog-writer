import { EditorView } from '@codemirror/view'
import { act, useMemo, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import * as Y from 'yjs'

import { addMemo, getBody, listMemos, setBody } from '#article/index'
import { MarkdownEditor } from '#components/markdown-editor'
import { MemoPanel } from '#memos/memo-panel'
import {
  ArticleOutline,
  createMoveHistory,
  createOutlineEditorExtension,
} from '#outline/index'
import type { MoveHistory } from '#outline/move-history'

type ViewRef = { current: EditorView | null }
type MountedEditor = {
  doc: Y.Doc
  history: MoveHistory
  host: HTMLDivElement
  root: Root
}

function EditorHarness({
  doc,
  history,
  viewRef,
}: {
  doc: Y.Doc
  history: MoveHistory
  viewRef: ViewRef
}) {
  const [view, setView] = useState<EditorView | null>(null)
  const extensions = useMemo(
    () => [createOutlineEditorExtension(history)],
    [history],
  )

  return (
    <>
      <MarkdownEditor
        extensions={extensions}
        history={history}
        onViewChange={(nextView) => {
          viewRef.current = nextView
          setView(nextView)
        }}
        text={getBody(doc)}
      />
      {view === null ? null : (
        <>
          <MemoPanel doc={doc} view={view} />
          <ArticleOutline doc={doc} history={history} view={view} />
        </>
      )}
    </>
  )
}

let mounted: MountedEditor | undefined
const viewRef: ViewRef = { current: null }

function currentEditor(): MountedEditor {
  if (!mounted) throw new Error('The editor has not been mounted')
  return mounted
}

function mount(markdown: string, memoText: string) {
  const doc = new Y.Doc()
  setBody(doc, markdown)
  addMemo(doc, { id: 'memo-a', text: memoText, order: 0 })
  const history = createMoveHistory(doc)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted = { doc, history, host, root }
  viewRef.current = null

  act(() => {
    root.render(<EditorHarness doc={doc} history={history} viewRef={viewRef} />)
  })
}

function memoState() {
  return listMemos(currentEditor().doc).map(({ id, state }) => ({
    id,
    state:
      state.kind === 'adopted'
        ? {
            kind: 'adopted',
            heading: {
              from: state.heading.from,
              level: state.heading.level,
              text: state.heading.text,
            },
          }
        : { kind: state.kind },
  }))
}

function readOutput() {
  const { doc, host } = currentEditor()
  return {
    body: getBody(doc).toJSON(),
    editor: viewRef.current?.state.doc.toString(),
    memos: memoState(),
    renderedStates: [...host.querySelectorAll('[role="listitem"]')].map(
      (item) => item.querySelectorAll('p').item(1).textContent,
    ),
  }
}

function findButton(label: string) {
  return [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent.trim() === label,
  )
}

function readUndoOutput(
  afterInsert: ReturnType<typeof readOutput>,
  afterUndo: ReturnType<typeof readOutput>,
) {
  return { afterInsert, afterUndo, afterRedo: readOutput() }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  const editor = mounted
  if (editor) {
    act(() => {
      editor.root.unmount()
    })
    editor.history.destroy()
    editor.doc.destroy()
    editor.host.remove()
  }
  mounted = undefined
  viewRef.current = null
  vi.unstubAllGlobals()
})

describe('memo adoption', () => {
  it('inserts a memo between headings and restores its state with undo and redo', async () => {
    const initial = '# First\n\none\n\n# Second\n\ntwo'
    mount(initial, 'Add a summary')
    const dragHandle = currentEditor().host.querySelector<HTMLButtonElement>(
      '[aria-label="メモ「Add a summary」をドラッグ"]',
    )
    const secondHeading = currentEditor().host.querySelector<HTMLElement>(
      '[aria-label="Second"]',
    )
    const gap = currentEditor().host.querySelector<HTMLElement>(
      `[data-outline-gap="${String(initial.indexOf('# Second'))}"]`,
    )
    if (!dragHandle || !secondHeading || !gap)
      throw new Error('The memo drag source or outline target is missing')

    await act(async () => {
      await userEvent.dragAndDrop(dragHandle, gap)
    })
    const afterInsert = readOutput()
    const modifier = navigator.platform.includes('Mac') ? 'Meta' : 'Control'
    await act(async () => {
      await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
    })
    const afterUndo = readOutput()
    await act(async () => {
      await userEvent.keyboard(`{${modifier}>}{Shift>}z{/Shift}{/${modifier}}`)
    })

    expect(readUndoOutput(afterInsert, afterUndo)).toEqual({
      afterInsert: {
        body: '# First\n\none\n\n# Add a summary\n\n# Second\n\ntwo',
        editor: '# First\n\none\n\n# Add a summary\n\n# Second\n\ntwo',
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 14, level: 1, text: 'Add a summary' },
            },
          },
        ],
        renderedStates: ['採用済み: Add a summary'],
      },
      afterUndo: {
        body: initial,
        editor: initial,
        memos: [{ id: 'memo-a', state: { kind: 'unorganized' } }],
        renderedStates: ['未整理'],
      },
      afterRedo: {
        body: '# First\n\none\n\n# Add a summary\n\n# Second\n\ntwo',
        editor: '# First\n\none\n\n# Add a summary\n\n# Second\n\ntwo',
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 14, level: 1, text: 'Add a summary' },
            },
          },
        ],
        renderedStates: ['採用済み: Add a summary'],
      },
    })
  })

  it('adopts a memo to the heading it is dropped on', async () => {
    const initial = '# First\n\none\n\n# Second\n\ntwo'
    mount(initial, 'Add a summary')
    const dragHandle = currentEditor().host.querySelector<HTMLButtonElement>(
      '[aria-label="メモ「Add a summary」をドラッグ"]',
    )
    const secondHeading = currentEditor().host.querySelector<HTMLElement>(
      '[aria-label="Second"]',
    )
    if (!dragHandle || !secondHeading)
      throw new Error('The memo drag source or heading target is missing')

    await act(async () => {
      await userEvent.dragAndDrop(dragHandle, secondHeading)
    })

    expect(readOutput()).toEqual({
      body: initial,
      editor: initial,
      memos: [
        {
          id: 'memo-a',
          state: {
            kind: 'adopted',
            heading: { from: 14, level: 1, text: 'Second' },
          },
        },
      ],
      renderedStates: ['採用済み: Second'],
    })
  })

  it('adopts a memo to an existing heading chosen from the memo panel', async () => {
    const initial = '# First\n\none\n\n# Second\n\ntwo'
    mount(initial, 'Add a summary')
    const chooseTarget = findButton('採用先を選ぶ')
    if (!chooseTarget) throw new Error('The memo target menu is missing')
    await act(async () => {
      await userEvent.click(chooseTarget)
    })
    const secondHeading = findButton('Second')
    if (!secondHeading)
      throw new Error('The existing heading is missing from the memo menu')
    await act(async () => {
      await userEvent.click(secondHeading)
    })

    expect(readOutput()).toEqual({
      body: initial,
      editor: initial,
      memos: [
        {
          id: 'memo-a',
          state: {
            kind: 'adopted',
            heading: { from: 14, level: 1, text: 'Second' },
          },
        },
      ],
      renderedStates: ['採用済み: Second'],
    })
  })

  it('offers the same existing and new heading targets from the memo panel', async () => {
    const initial = '# First\n\none\n\n# Second\n\ntwo'
    mount(initial, 'Add a summary')
    const chooseTarget = findButton('採用先を選ぶ')
    if (!chooseTarget) throw new Error('The memo target menu is missing')
    await act(async () => {
      await userEvent.click(chooseTarget)
    })
    const insertBeforeSecond = findButton('「Second」の前')
    if (!insertBeforeSecond)
      throw new Error('The insertion target is missing from the memo menu')
    await act(async () => {
      await userEvent.click(insertBeforeSecond)
    })

    expect(readOutput()).toEqual({
      body: '# First\n\none\n\n# Add a summary\n\n# Second\n\ntwo',
      editor: '# First\n\none\n\n# Add a summary\n\n# Second\n\ntwo',
      memos: [
        {
          id: 'memo-a',
          state: {
            kind: 'adopted',
            heading: { from: 14, level: 1, text: 'Add a summary' },
          },
        },
      ],
      renderedStates: ['採用済み: Add a summary'],
    })
  })
})
