import { Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { act, useMemo, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import * as Y from 'yjs'

import {
  addMemo,
  dismissMemo,
  getBody,
  listMemos,
  setBody,
  setMemoAdoptedTo,
} from '#article/index'
import { MarkdownEditor } from '#components/markdown-editor'
import { adoptMemoToHeading, insertMemoAsHeading } from '#memos/adoption'
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

function readAdoptionFailureOutput() {
  const { host } = currentEditor()
  return {
    output: readOutput(),
    alert: host.querySelector('[role="alert"]')?.textContent ?? null,
  }
}

function readAdoptionControls() {
  const { host } = currentEditor()
  return {
    dragHandle:
      host.querySelector(
        '[aria-label^="メモ「"][aria-label$="」をドラッグ"]',
      ) !== null,
    menu: [...host.querySelectorAll('button')].some((button) =>
      ['採用先を選ぶ', '採用先を変更'].includes(button.textContent.trim()),
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

function readHistoryOutput<T extends Record<string, unknown>>(
  previousStates: T,
  finalStateName = 'afterRedo',
) {
  return { ...previousStates, [finalStateName]: readOutput() }
}

function readAdoptionControlOutput() {
  return { output: readOutput(), controls: readAdoptionControls() }
}

function readOperationOutput<T extends { ok: boolean }>(operation: T) {
  return { operation, output: readOutput() }
}

async function dragMemoBefore(
  markdown: string,
  memoText: string,
  marker: string,
) {
  mount(markdown, memoText)
  const dragHandle = [
    ...currentEditor().host.querySelectorAll<HTMLButtonElement>('button'),
  ].find(
    (button) =>
      button.getAttribute('aria-label') === `メモ「${memoText}」をドラッグ`,
  )
  const target = currentEditor().host.querySelector<HTMLElement>(
    `[data-outline-gap="${String(markdown.indexOf(marker))}"]`,
  )
  if (!dragHandle || !target)
    throw new Error('The memo drag source or outline target is missing')
  await act(async () => {
    await userEvent.dragAndDrop(dragHandle, target)
  })
  return readOutput()
}

async function chooseEndInsertion() {
  const openMenu = findButton('採用先を選ぶ') ?? findButton('採用先を変更')
  if (!openMenu) throw new Error('The memo target menu is missing')
  await act(async () => {
    await userEvent.click(openMenu)
  })
  const insertAtEnd = findButton('末尾に追加')
  if (!insertAtEnd)
    throw new Error('The end insertion target is missing from the memo menu')
  await act(async () => {
    await userEvent.click(insertAtEnd)
  })
}

async function undoAndRedo() {
  const modifier = navigator.platform.includes('Mac') ? 'Meta' : 'Control'
  await act(async () => {
    await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
  })
  const afterUndo = readOutput()
  await act(async () => {
    await userEvent.keyboard(`{${modifier}>}{Shift>}z{/Shift}{/${modifier}}`)
  })
  return afterUndo
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
    const gap = currentEditor().host.querySelector<HTMLElement>(
      `[data-outline-gap="${String(initial.indexOf('# Second'))}"]`,
    )
    if (!dragHandle || !gap)
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

  it.each([
    {
      case: 'blockquote',
      initial: 'x\n\n> # Q\n>\n> y\n',
      marker: '# Q',
      expected: 'x\n\n# New\n\n> # Q\n>\n> y\n',
    },
    {
      case: 'list',
      initial: 'x\n\n- # Q\n  y\n',
      marker: '# Q',
      expected: 'x\n\n# New\n\n- # Q\n  y\n',
    },
    {
      case: 'indented heading',
      initial: 'x\n\n   # I\n',
      marker: '# I',
      expected: 'x\n\n# New\n\n   # I\n',
    },
  ])(
    'inserts before the entire $case block',
    async ({ initial, marker, expected }) => {
      const output = await dragMemoBefore(initial, 'New', marker)

      expect(output).toEqual({
        body: expected,
        editor: expected,
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 3, level: 1, text: 'New' },
            },
          },
        ],
        renderedStates: ['採用済み: New'],
      })
    },
  )

  it('uses the target heading level and replaces memo newlines', async () => {
    const initial = '# Parent\n\n## Child\n\nbody'
    const expected =
      '# Parent\n\n## Write summary with details later\n\n## Child\n\nbody'
    const output = await dragMemoBefore(
      initial,
      'Write summary\nwith details\r\nlater',
      '## Child',
    )

    expect(output).toEqual({
      body: expected,
      editor: expected,
      memos: [
        {
          id: 'memo-a',
          state: {
            kind: 'adopted',
            heading: {
              from: 10,
              level: 2,
              text: 'Write summary with details later',
            },
          },
        },
      ],
      renderedStates: ['採用済み: Write summary with details later'],
    })
  })

  it('allows a block to be dropped into a gap between outline rows', async () => {
    const initial = '# A\n\n# B\n\n# C'
    mount(initial, 'A memo')
    const dragHandle = currentEditor().host.querySelector<HTMLButtonElement>(
      '[aria-label="Move A"]',
    )
    const gap = currentEditor().host.querySelector<HTMLElement>(
      `[data-outline-gap="${String(initial.indexOf('# C'))}"]`,
    )
    if (!dragHandle || !gap)
      throw new Error('The block drag source or outline gap is missing')

    await act(async () => {
      await userEvent.dragAndDrop(dragHandle, gap)
    })

    expect(readOutput()).toEqual({
      body: '# B\n\n# A\n\n# C',
      editor: '# B\n\n# A\n\n# C',
      memos: [{ id: 'memo-a', state: { kind: 'unorganized' } }],
      renderedStates: ['未整理'],
    })
  })

  it.each([
    {
      destination: 'before C',
      gap: '10',
      afterMove: '# B\n\n# A\n\n# C',
    },
    {
      destination: 'the end',
      gap: 'end',
      afterMove: '# B\n\n# C\n\n# A\n',
    },
  ])(
    'keeps an adopted memo attached when A moves to $destination',
    async ({ gap, afterMove }) => {
      const initial = '# A\n\n# B\n\n# C'
      mount(initial, 'memo')
      act(() => {
        const result = setMemoAdoptedTo(
          currentEditor().doc,
          'memo-a',
          initial.indexOf('# B'),
        )
        if (result.isErr()) throw result.error
      })
      const dragHandle = currentEditor().host.querySelector<HTMLButtonElement>(
        '[aria-label="Move A"]',
      )
      const target = currentEditor().host.querySelector<HTMLElement>(
        `[data-outline-gap="${gap}"]`,
      )
      if (!dragHandle || !target)
        throw new Error('The block drag source or outline gap is missing')
      await act(async () => {
        await userEvent.dragAndDrop(dragHandle, target)
      })
      const afterMoveOutput = readOutput()
      const afterUndo = await undoAndRedo()
      expect(
        readHistoryOutput({ afterMove: afterMoveOutput, afterUndo }),
      ).toEqual({
        afterMove: {
          body: afterMove,
          editor: afterMove,
          memos: [
            {
              id: 'memo-a',
              state: {
                kind: 'adopted',
                heading: { from: 0, level: 1, text: 'B' },
              },
            },
          ],
          renderedStates: ['採用済み: B'],
        },
        afterUndo: {
          body: initial,
          editor: initial,
          memos: [
            {
              id: 'memo-a',
              state: {
                kind: 'adopted',
                heading: { from: 5, level: 1, text: 'B' },
              },
            },
          ],
          renderedStates: ['採用済み: B'],
        },
        afterRedo: {
          body: afterMove,
          editor: afterMove,
          memos: [
            {
              id: 'memo-a',
              state: {
                kind: 'adopted',
                heading: { from: 0, level: 1, text: 'B' },
              },
            },
          ],
          renderedStates: ['採用済み: B'],
        },
      })
    },
  )

  it('undoes a move before the heading insertion and redoes them in order', async () => {
    const initial = '# A\n\n# B\n\n# C'
    const afterInsert = '# A\n\n# New\n\n# B\n\n# C'
    const afterMove = '# New\n\n# B\n\n# C\n\n# A\n'
    await dragMemoBefore(initial, 'New', '# B')
    const view = viewRef.current
    if (!view) throw new Error('The editor view is not mounted')
    act(() => {
      const result = currentEditor().history.move(
        { from: 0, destination: getBody(currentEditor().doc).length },
        view,
      )
      if (result.isErr()) throw result.error
    })
    const afterMoveOutput = readOutput()
    const modifier = navigator.platform.includes('Mac') ? 'Meta' : 'Control'
    await act(async () => {
      await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
    })
    const afterUndoMove = readOutput()
    await act(async () => {
      await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
    })
    const afterUndoInsert = readOutput()
    await act(async () => {
      await userEvent.keyboard(`{${modifier}>}{Shift>}z{/Shift}{/${modifier}}`)
    })
    const afterRedoInsert = readOutput()
    await act(async () => {
      await userEvent.keyboard(`{${modifier}>}{Shift>}z{/Shift}{/${modifier}}`)
    })
    expect(
      readHistoryOutput(
        {
          afterMove: afterMoveOutput,
          afterUndoMove,
          afterUndoInsert,
          afterRedoInsert,
        },
        'afterRedoMove',
      ),
    ).toEqual({
      afterMove: {
        body: afterMove,
        editor: afterMove,
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 0, level: 1, text: 'New' },
            },
          },
        ],
        renderedStates: ['採用済み: New'],
      },
      afterUndoMove: {
        body: afterInsert,
        editor: afterInsert,
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 5, level: 1, text: 'New' },
            },
          },
        ],
        renderedStates: ['採用済み: New'],
      },
      afterUndoInsert: {
        body: initial,
        editor: initial,
        memos: [{ id: 'memo-a', state: { kind: 'unorganized' } }],
        renderedStates: ['未整理'],
      },
      afterRedoInsert: {
        body: afterInsert,
        editor: afterInsert,
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 5, level: 1, text: 'New' },
            },
          },
        ],
        renderedStates: ['採用済み: New'],
      },
      afterRedoMove: {
        body: afterMove,
        editor: afterMove,
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 0, level: 1, text: 'New' },
            },
          },
        ],
        renderedStates: ['採用済み: New'],
      },
    })
  })

  it('does not show adoption controls for a dismissed memo', () => {
    const initial = '# First'
    mount(initial, 'A dismissed memo')
    act(() => {
      const result = dismissMemo(currentEditor().doc, 'memo-a')
      if (result.isErr()) throw result.error
    })

    expect(readAdoptionControlOutput()).toEqual({
      output: {
        body: initial,
        editor: initial,
        memos: [{ id: 'memo-a', state: { kind: 'dismissed' } }],
        renderedStates: ['見送り'],
      },
      controls: { dragHandle: false, menu: false },
    })
  })

  it('rejects adoption after a remote client dismisses the memo', () => {
    const initial = '# First'
    mount(initial, 'A memo')
    const remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(currentEditor().doc))
    const dismissed = dismissMemo(remote, 'memo-a')
    if (dismissed.isErr()) throw dismissed.error
    act(() => {
      Y.applyUpdate(currentEditor().doc, Y.encodeStateAsUpdate(remote))
    })
    const operation = adoptMemoToHeading(
      currentEditor().doc,
      'memo-a',
      initial.indexOf('# First'),
    ).match(
      () => ({ ok: true as const }),
      (error) => ({ ok: false as const, error: error.message }),
    )
    expect(readOperationOutput(operation)).toEqual({
      operation: { ok: false, error: 'Dismissed memos cannot be adopted' },
      output: {
        body: initial,
        editor: initial,
        memos: [{ id: 'memo-a', state: { kind: 'dismissed' } }],
        renderedStates: ['見送り'],
      },
    })
    remote.destroy()
  })

  it('keeps remote text when an inserted heading is undone and redone', async () => {
    const initial = '# First\n\nbody'
    mount(initial, 'Add a summary')
    await chooseEndInsertion()
    const afterInsert = readOutput()
    const remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(currentEditor().doc))
    getBody(remote).insert(getBody(remote).length, '\nRemote edit')
    act(() => {
      Y.applyUpdate(
        currentEditor().doc,
        Y.encodeStateAsUpdate(remote, Y.encodeStateVector(currentEditor().doc)),
      )
    })
    const afterRemoteEdit = readOutput()
    const afterUndo = await undoAndRedo()
    expect(
      readHistoryOutput({ afterInsert, afterRemoteEdit, afterUndo }),
    ).toEqual({
      afterInsert: {
        body: '# First\n\nbody\n\n# Add a summary\n\n',
        editor: '# First\n\nbody\n\n# Add a summary\n\n',
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 15, level: 1, text: 'Add a summary' },
            },
          },
        ],
        renderedStates: ['採用済み: Add a summary'],
      },
      afterRemoteEdit: {
        body: '# First\n\nbody\n\n# Add a summary\n\n\nRemote edit',
        editor: '# First\n\nbody\n\n# Add a summary\n\n\nRemote edit',
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 15, level: 1, text: 'Add a summary' },
            },
          },
        ],
        renderedStates: ['採用済み: Add a summary'],
      },
      afterUndo: {
        body: '# First\n\nbody\nRemote edit',
        editor: '# First\n\nbody\nRemote edit',
        memos: [{ id: 'memo-a', state: { kind: 'unorganized' } }],
        renderedStates: ['未整理'],
      },
      afterRedo: {
        body: '# First\n\nbody\n\n# Add a summary\n\n\nRemote edit',
        editor: '# First\n\nbody\n\n# Add a summary\n\n\nRemote edit',
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 15, level: 1, text: 'Add a summary' },
            },
          },
        ],
        renderedStates: ['採用済み: Add a summary'],
      },
    })
    remote.destroy()
  })

  it('isolates a new heading from an immediately preceding text edit', async () => {
    mount('# First', 'Add a summary')
    const view = viewRef.current
    if (!view) throw new Error('The editor view is not mounted')
    act(() => {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: '!' },
        annotations: [
          Transaction.userEvent.of('input.type'),
          Transaction.time.of(Date.now()),
        ],
      })
      const result = insertMemoAsHeading(currentEditor().doc, view, 'memo-a')
      if (result.isErr()) throw result.error
    })
    const afterInsert = readOutput()
    const modifier = navigator.platform.includes('Mac') ? 'Meta' : 'Control'
    await act(async () => {
      await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
    })
    const afterUndoInsert = readOutput()
    await act(async () => {
      await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
    })
    expect(
      readHistoryOutput({ afterInsert, afterUndoInsert }, 'afterUndoTyping'),
    ).toEqual({
      afterInsert: {
        body: '# First!\n\n# Add a summary\n\n',
        editor: '# First!\n\n# Add a summary\n\n',
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 10, level: 1, text: 'Add a summary' },
            },
          },
        ],
        renderedStates: ['採用済み: Add a summary'],
      },
      afterUndoInsert: {
        body: '# First!',
        editor: '# First!',
        memos: [{ id: 'memo-a', state: { kind: 'unorganized' } }],
        renderedStates: ['未整理'],
      },
      afterUndoTyping: {
        body: '# First',
        editor: '# First',
        memos: [{ id: 'memo-a', state: { kind: 'unorganized' } }],
        renderedStates: ['未整理'],
      },
    })
  })

  it('undoes and redoes an insertion from the memo menu with one newline separator', async () => {
    const initial = '# First\n\nbody\n'
    mount(initial, 'Add a summary')
    await chooseEndInsertion()
    const afterInsert = readOutput()
    const afterUndo = await undoAndRedo()
    expect(readHistoryOutput({ afterInsert, afterUndo })).toEqual({
      afterInsert: {
        body: '# First\n\nbody\n\n# Add a summary\n\n',
        editor: '# First\n\nbody\n\n# Add a summary\n\n',
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 15, level: 1, text: 'Add a summary' },
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
        body: '# First\n\nbody\n\n# Add a summary\n\n',
        editor: '# First\n\nbody\n\n# Add a summary\n\n',
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 15, level: 1, text: 'Add a summary' },
            },
          },
        ],
        renderedStates: ['採用済み: Add a summary'],
      },
    })
  })

  it('restores the previous adopted heading when a memo is reinserted and undone', async () => {
    const initial = '# A\n\n# B\n\n# C'
    mount(initial, 'memo')
    act(() => {
      const result = setMemoAdoptedTo(
        currentEditor().doc,
        'memo-a',
        initial.indexOf('# B'),
      )
      if (result.isErr()) throw result.error
    })
    await chooseEndInsertion()
    const afterInsert = readOutput()
    const afterUndo = await undoAndRedo()
    expect(readHistoryOutput({ afterInsert, afterUndo })).toEqual({
      afterInsert: {
        body: '# A\n\n# B\n\n# C\n\n# memo\n\n',
        editor: '# A\n\n# B\n\n# C\n\n# memo\n\n',
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 15, level: 1, text: 'memo' },
            },
          },
        ],
        renderedStates: ['採用済み: memo'],
      },
      afterUndo: {
        body: initial,
        editor: initial,
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 5, level: 1, text: 'B' },
            },
          },
        ],
        renderedStates: ['採用済み: B'],
      },
      afterRedo: {
        body: '# A\n\n# B\n\n# C\n\n# memo\n\n',
        editor: '# A\n\n# B\n\n# C\n\n# memo\n\n',
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 15, level: 1, text: 'memo' },
            },
          },
        ],
        renderedStates: ['採用済み: memo'],
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

  it('inserts a memo at the end from the memo panel', async () => {
    const initial = '# First\n\nbody'
    mount(initial, 'Add a summary')
    const chooseTarget = findButton('採用先を選ぶ')
    if (!chooseTarget) throw new Error('The memo target menu is missing')
    await act(async () => {
      await userEvent.click(chooseTarget)
    })
    const insertAtEnd = findButton('末尾に追加')
    if (!insertAtEnd)
      throw new Error('The end insertion target is missing from the memo menu')
    await act(async () => {
      await userEvent.click(insertAtEnd)
    })

    expect(readOutput()).toEqual({
      body: '# First\n\nbody\n\n# Add a summary\n\n',
      editor: '# First\n\nbody\n\n# Add a summary\n\n',
      memos: [
        {
          id: 'memo-a',
          state: {
            kind: 'adopted',
            heading: { from: 15, level: 1, text: 'Add a summary' },
          },
        },
      ],
      renderedStates: ['採用済み: Add a summary'],
    })
  })

  it('leaves a memo unchanged when insertion would land inside a code fence', async () => {
    const initial = '# First\n\n```md\nbody'
    mount(initial, 'Add a summary')
    const chooseTarget = findButton('採用先を選ぶ')
    if (!chooseTarget) throw new Error('The memo target menu is missing')
    await act(async () => {
      await userEvent.click(chooseTarget)
    })
    const insertAtEnd = findButton('末尾に追加')
    if (!insertAtEnd)
      throw new Error('The end insertion target is missing from the memo menu')
    await act(async () => {
      await userEvent.click(insertAtEnd)
    })

    expect(readAdoptionFailureOutput()).toEqual({
      output: {
        body: initial,
        editor: initial,
        memos: [{ id: 'memo-a', state: { kind: 'unorganized' } }],
        renderedStates: ['未整理'],
      },
      alert: 'メモを更新できませんでした。',
    })
  })
})
