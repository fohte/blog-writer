import { EditorState, Transaction } from '@codemirror/state'
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
  getMemoAdoptedTo,
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
import { pressRedo, pressUndo } from '#outline/move-history.test-support.test'

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

function currentView(): EditorView {
  if (!viewRef.current) throw new Error('The editor view is not mounted')
  return viewRef.current
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

function readOutlineErrorOutput() {
  const { host } = currentEditor()
  return {
    output: readOutput(),
    alert:
      host.querySelector('[aria-label="Article outline"] [role="alert"]')
        ?.textContent ?? null,
  }
}

function readOutputWithSelection(output: ReturnType<typeof readOutput>) {
  return { output, selection: viewRef.current?.state.selection.main.head }
}

function readOutputWithAdoptionMenu() {
  return { output: readOutput(), menuOpen: adoptionMenuIsOpen() }
}

function readDismissedUndoOutput(adoptionBeforeUndo: string | undefined) {
  return {
    adoptionBeforeUndo,
    adoptionAfterUndo: JSON.stringify(
      getMemoAdoptedTo(currentEditor().doc, 'memo-a'),
    ),
    output: readOutput(),
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

function adoptionMenuIsOpen() {
  const trigger = findButton('採用先を選ぶ') ?? findButton('採用先を変更')
  return trigger?.getAttribute('aria-expanded') === 'true'
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

function dispatchDragWithInterruption(
  source: HTMLElement,
  target: HTMLElement,
  interrupt: () => void,
) {
  const bounds = target.getBoundingClientRect()
  const dataTransfer = new DataTransfer()
  const eventOptions = {
    bubbles: true,
    cancelable: true,
    clientX: bounds.left + bounds.width / 2,
    clientY: bounds.top + bounds.height / 2,
    dataTransfer,
  }
  source.dispatchEvent(new DragEvent('dragstart', eventOptions))
  interrupt()
  target.dispatchEvent(new DragEvent('dragenter', eventOptions))
  target.dispatchEvent(new DragEvent('dragover', eventOptions))
  target.dispatchEvent(new DragEvent('drop', eventOptions))
  source.dispatchEvent(new DragEvent('dragend', eventOptions))
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
  await pressUndo(currentView())
  const afterUndo = readOutput()
  await pressRedo(currentView())
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
    await pressUndo(currentView())
    const afterUndo = readOutput()
    await pressRedo(currentView())

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
    const initial = '## Child\n\n# Last'
    const expected = '## Write summary with details later\n\n## Child\n\n# Last'
    const output = await dragMemoBefore(
      initial,
      '  Write summary\nwith details\r\nlater  ',
      '## Child',
    )

    expect(readOutputWithSelection(output)).toEqual({
      output: {
        body: expected,
        editor: expected,
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: {
                from: 0,
                level: 2,
                text: 'Write summary with details later',
              },
            },
          },
        ],
        renderedStates: ['採用済み: Write summary with details later'],
      },
      selection: 35,
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
    await pressUndo(currentView())
    const afterUndoMove = readOutput()
    await pressUndo(currentView())
    const afterUndoInsert = readOutput()
    await pressRedo(currentView())
    const afterRedoInsert = readOutput()
    await pressRedo(currentView())
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

  it('preserves a remote adoption target through insertion undo and redo', async () => {
    const initial = '# Target\n\nbody'
    mount(initial, 'memo')
    await chooseEndInsertion()
    const afterInsert = readOutput()
    const remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(currentEditor().doc))
    const adoption = setMemoAdoptedTo(
      remote,
      'memo-a',
      initial.indexOf('# Target'),
    )
    if (adoption.isErr()) throw adoption.error
    act(() => {
      Y.applyUpdate(
        currentEditor().doc,
        Y.encodeStateAsUpdate(remote, Y.encodeStateVector(currentEditor().doc)),
      )
    })
    const afterRemoteAdoption = readOutput()
    await pressUndo(currentView())
    const afterUndo = readOutput()
    await pressRedo(currentView())

    expect(
      readHistoryOutput({ afterInsert, afterRemoteAdoption, afterUndo }),
    ).toEqual({
      afterInsert: {
        body: '# Target\n\nbody\n\n# memo\n\n',
        editor: '# Target\n\nbody\n\n# memo\n\n',
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 16, level: 1, text: 'memo' },
            },
          },
        ],
        renderedStates: ['採用済み: memo'],
      },
      afterRemoteAdoption: {
        body: '# Target\n\nbody\n\n# memo\n\n',
        editor: '# Target\n\nbody\n\n# memo\n\n',
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 0, level: 1, text: 'Target' },
            },
          },
        ],
        renderedStates: ['採用済み: Target'],
      },
      afterUndo: {
        body: initial,
        editor: initial,
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 0, level: 1, text: 'Target' },
            },
          },
        ],
        renderedStates: ['採用済み: Target'],
      },
      afterRedo: {
        body: '# Target\n\nbody\n\n# memo\n\n',
        editor: '# Target\n\nbody\n\n# memo\n\n',
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 0, level: 1, text: 'Target' },
            },
          },
        ],
        renderedStates: ['採用済み: Target'],
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
    await pressUndo(currentView())
    const afterUndoInsert = readOutput()
    await pressUndo(currentView())
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

    expect(readOutputWithAdoptionMenu()).toEqual({
      output: {
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
      menuOpen: false,
    })
  })

  it('uses level 2 when inserting the first heading into an article', async () => {
    mount('body', 'memo')
    const openMenu = findButton('採用先を選ぶ')
    if (!openMenu) throw new Error('The memo target menu is missing')
    await act(async () => {
      await userEvent.click(openMenu)
    })
    const insertAtStart = findButton('先頭に追加')
    if (!insertAtStart)
      throw new Error('The first insertion target is missing from the menu')
    await act(async () => {
      await userEvent.click(insertAtStart)
    })

    expect(readOutput()).toEqual({
      body: 'body\n\n## memo\n\n',
      editor: 'body\n\n## memo\n\n',
      memos: [
        {
          id: 'memo-a',
          state: {
            kind: 'adopted',
            heading: { from: 6, level: 2, text: 'memo' },
          },
        },
      ],
      renderedStates: ['採用済み: memo'],
    })
  })

  it.each([
    {
      case: 'a trailing closing marker',
      memoText: 'foo #',
      expectedBody: '# First\n\n# foo #\n\n',
      expectedHeadingText: 'foo',
    },
    {
      case: 'a standalone marker',
      memoText: '#',
      expectedBody: '# First\n\n# #\n\n',
      expectedHeadingText: '#',
    },
  ])(
    'interprets $case in the inserted heading',
    async ({ memoText, expectedBody, expectedHeadingText }) => {
      mount('# First', memoText)
      await chooseEndInsertion()

      expect(readOutput()).toEqual({
        body: expectedBody,
        editor: expectedBody,
        memos: [
          {
            id: 'memo-a',
            state: {
              kind: 'adopted',
              heading: { from: 9, level: 1, text: expectedHeadingText },
            },
          },
        ],
        renderedStates: [`採用済み: ${expectedHeadingText}`],
      })
    },
  )

  it('refuses to insert a new heading into a CRLF article', async () => {
    const initial = '# First\r\nbody'
    mount(initial, 'Memo')
    await chooseEndInsertion()

    expect(readAdoptionFailureOutput()).toEqual({
      output: {
        body: initial,
        editor: '# First\nbody',
        memos: [{ id: 'memo-a', state: { kind: 'unorganized' } }],
        renderedStates: ['未整理'],
      },
      alert: 'メモを更新できませんでした。',
    })
  })

  it('adopts an existing heading in a CRLF article with an empty heading name', async () => {
    const initial = '# First\r\nbody'
    mount(initial, 'Memo')
    const openMenu = findButton('採用先を選ぶ')
    if (!openMenu) throw new Error('The memo target menu is missing')
    await act(async () => {
      await userEvent.click(openMenu)
    })
    const heading = findButton('無題の見出し')
    if (!heading)
      throw new Error('The existing heading is missing from the menu')
    await act(async () => {
      await userEvent.click(heading)
    })

    expect(readOutput()).toEqual({
      body: initial,
      editor: '# First\nbody',
      memos: [
        {
          id: 'memo-a',
          state: {
            kind: 'adopted',
            heading: { from: 0, level: 1, text: '' },
          },
        },
      ],
      renderedStates: ['採用済み: '],
    })
  })

  it('rejects empty memo text before inserting a heading', () => {
    mount('# First', ' \n  ')
    const view = viewRef.current
    if (!view) throw new Error('The editor view is not mounted')
    const operation = insertMemoAsHeading(
      currentEditor().doc,
      view,
      'memo-a',
    ).match(
      () => ({ ok: true as const }),
      (error) => ({ ok: false as const, error: error.message }),
    )

    expect(readOperationOutput(operation)).toEqual({
      operation: { ok: false, error: 'Memo text must not be empty' },
      output: {
        body: '# First',
        editor: '# First',
        memos: [{ id: 'memo-a', state: { kind: 'unorganized' } }],
        renderedStates: ['未整理'],
      },
    })
  })

  it('rejects inserting a dismissed memo', () => {
    mount('# First', 'memo')
    act(() => {
      const result = dismissMemo(currentEditor().doc, 'memo-a')
      if (result.isErr()) throw result.error
    })
    const view = viewRef.current
    if (!view) throw new Error('The editor view is not mounted')
    const operation = insertMemoAsHeading(
      currentEditor().doc,
      view,
      'memo-a',
    ).match(
      () => ({ ok: true as const }),
      (error) => ({ ok: false as const, error: error.message }),
    )

    expect(readOperationOutput(operation)).toEqual({
      operation: {
        ok: false,
        error: 'Dismissed memos cannot be adopted',
      },
      output: {
        body: '# First',
        editor: '# First',
        memos: [{ id: 'memo-a', state: { kind: 'dismissed' } }],
        renderedStates: ['見送り'],
      },
    })
  })

  it('rejects insertion when the editor does not match the article body', () => {
    mount('# First', 'memo')
    const staleView = new EditorView({
      state: EditorState.create({ doc: '# Stale' }),
    })
    const operation = insertMemoAsHeading(
      currentEditor().doc,
      staleView,
      'memo-a',
    ).match(
      () => ({ ok: true as const }),
      (error) => ({ ok: false as const, error: error.message }),
    )
    staleView.destroy()

    expect(readOperationOutput(operation)).toEqual({
      operation: { ok: false, error: 'Editor content is out of date' },
      output: {
        body: '# First',
        editor: '# First',
        memos: [{ id: 'memo-a', state: { kind: 'unorganized' } }],
        renderedStates: ['未整理'],
      },
    })
  })

  it('rejects an insertion target that is not a heading', () => {
    mount('# First', 'memo')
    const view = viewRef.current
    if (!view) throw new Error('The editor view is not mounted')
    const operation = insertMemoAsHeading(
      currentEditor().doc,
      view,
      'memo-a',
      999,
    ).match(
      () => ({ ok: true as const }),
      (error) => ({ ok: false as const, error: error.message }),
    )

    expect(readOperationOutput(operation)).toEqual({
      operation: {
        ok: false,
        error: 'No ATX heading marker at body index 999',
      },
      output: {
        body: '# First',
        editor: '# First',
        memos: [{ id: 'memo-a', state: { kind: 'unorganized' } }],
        renderedStates: ['未整理'],
      },
    })
  })

  it('preserves an adopted anchor when undo runs while a memo is dismissed', async () => {
    const initial = '# First\n\nbody'
    mount(initial, 'memo')
    await chooseEndInsertion()
    const adoptionBeforeUndo = JSON.stringify(
      getMemoAdoptedTo(currentEditor().doc, 'memo-a'),
    )
    act(() => {
      const result = dismissMemo(currentEditor().doc, 'memo-a')
      if (result.isErr()) throw result.error
    })
    await pressUndo(currentView())

    expect(readDismissedUndoOutput(adoptionBeforeUndo)).toEqual({
      adoptionBeforeUndo,
      adoptionAfterUndo: adoptionBeforeUndo,
      output: {
        body: initial,
        editor: initial,
        memos: [{ id: 'memo-a', state: { kind: 'dismissed' } }],
        renderedStates: ['見送り'],
      },
    })
  })

  it('shows a user-facing error when a gap cannot insert a memo', async () => {
    const initial = '# First\n\nbody'
    mount(initial, ' ')
    const dragHandle = currentEditor().host.querySelector<HTMLButtonElement>(
      '[aria-label^="メモ「"][aria-label$="」をドラッグ"]',
    )
    const gap = currentEditor().host.querySelector<HTMLElement>(
      '[data-outline-gap="end"]',
    )
    if (!dragHandle || !gap)
      throw new Error('The memo drag source or outline gap is missing')
    await act(async () => {
      await userEvent.dragAndDrop(dragHandle, gap)
    })

    expect(readOutlineErrorOutput()).toEqual({
      output: {
        body: initial,
        editor: initial,
        memos: [{ id: 'memo-a', state: { kind: 'unorganized' } }],
        renderedStates: ['未整理'],
      },
      alert: 'メモを更新できませんでした。',
    })
  })

  it('shows a user-facing error when a memo is dismissed during a heading drop', () => {
    const initial = '# First\n\nbody'
    mount(initial, 'memo')
    const dragHandle = currentEditor().host.querySelector<HTMLButtonElement>(
      '[aria-label="メモ「memo」をドラッグ"]',
    )
    const heading = currentEditor().host.querySelector<HTMLElement>(
      '[aria-label="First"]',
    )
    if (!dragHandle || !heading)
      throw new Error('The memo drag source or outline heading is missing')

    act(() => {
      dispatchDragWithInterruption(dragHandle, heading, () => {
        const result = dismissMemo(currentEditor().doc, 'memo-a')
        if (result.isErr()) throw result.error
      })
    })

    expect(readOutlineErrorOutput()).toEqual({
      output: {
        body: initial,
        editor: initial,
        memos: [{ id: 'memo-a', state: { kind: 'dismissed' } }],
        renderedStates: ['見送り'],
      },
      alert: 'メモを更新できませんでした。',
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
