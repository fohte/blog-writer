import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'

import {
  addMemo,
  getBody,
  listMemos,
  setBody,
  setMemoAdoptedTo,
} from '#article/index'
import { insertMemoAsHeading } from '#memos/adoption'
import { createMoveHistory } from '#outline/index'
import { pressRedo, pressUndo } from '#outline/move-history.test-support.test'

type MountedEditor = {
  doc: Y.Doc
  host: HTMLDivElement
  history: ReturnType<typeof createMoveHistory>
  view: EditorView
}

const cleanups: (() => void)[] = []

function mount(markdownText: string) {
  const doc = new Y.Doc()
  setBody(doc, markdownText)
  for (const [id, text, order] of [
    ['memo-m', 'M', 0],
    ['memo-n', 'N', 1],
  ] as const) {
    const result = addMemo(doc, { id, text, order })
    if (result.isErr()) throw result.error
  }
  const history = createMoveHistory(doc)
  const host = document.createElement('div')
  document.body.append(host)
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: markdownText,
      extensions: [
        markdown(),
        history.extension,
        keymap.of([
          {
            key: 'Mod-z',
            run: (editorView) =>
              history.undo(editorView).match(
                () => true,
                () => true,
              ),
          },
          {
            key: 'Mod-Shift-z',
            run: (editorView) =>
              history.redo(editorView).match(
                () => true,
                () => true,
              ),
          },
        ]),
        yCollab(getBody(doc), null, { undoManager: false }),
      ],
    }),
  })
  const mounted = { doc, host, history, view }
  cleanups.push(() => {
    view.destroy()
    history.destroy()
    doc.destroy()
    host.remove()
  })
  return mounted
}

function readOutput({ doc, view }: MountedEditor) {
  return {
    body: getBody(doc).toJSON(),
    editor: view.state.doc.toString(),
    memos: listMemos(doc).map(({ id, state }) => ({
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
    })),
  }
}

function readHistoryOutput<T extends Record<string, unknown>>(
  states: T,
  afterRedo: ReturnType<typeof readOutput>,
) {
  return { ...states, afterRedo }
}

function insertMemo(mounted: MountedEditor) {
  const result = insertMemoAsHeading(mounted.doc, mounted.view, 'memo-m')
  if (result.isErr()) throw result.error
}

async function undoAndRedo(mounted: MountedEditor) {
  await pressUndo(mounted.view)
  const afterUndo = readOutput(mounted)
  await pressRedo(mounted.view)
  return afterUndo
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.unstubAllGlobals()
})

describe('memo adoption history', () => {
  it('restores another memo adopted to an inserted heading after redo', async () => {
    const initial = '# Start'
    const mounted = mount(initial)
    insertMemo(mounted)
    const markerIndex = getBody(mounted.doc).toJSON().indexOf('# M')
    const adoption = setMemoAdoptedTo(mounted.doc, 'memo-n', markerIndex)
    if (adoption.isErr()) throw adoption.error
    const afterInsert = readOutput(mounted)

    const afterUndo = await undoAndRedo(mounted)
    const afterRedo = readOutput(mounted)
    await pressUndo(mounted.view)
    const afterRedoUndo = readOutput(mounted)

    expect(
      readHistoryOutput({ afterInsert, afterUndo, afterRedoUndo }, afterRedo),
    ).toEqual({
      afterInsert: {
        body: '# Start\n\n# M\n\n',
        editor: '# Start\n\n# M\n\n',
        memos: [
          {
            id: 'memo-m',
            state: {
              kind: 'adopted',
              heading: { from: 9, level: 1, text: 'M' },
            },
          },
          {
            id: 'memo-n',
            state: {
              kind: 'adopted',
              heading: { from: 9, level: 1, text: 'M' },
            },
          },
        ],
      },
      afterUndo: {
        body: initial,
        editor: initial,
        memos: [
          { id: 'memo-m', state: { kind: 'unorganized' } },
          { id: 'memo-n', state: { kind: 'unorganized' } },
        ],
      },
      afterRedo: {
        body: '# Start\n\n# M\n\n',
        editor: '# Start\n\n# M\n\n',
        memos: [
          {
            id: 'memo-m',
            state: {
              kind: 'adopted',
              heading: { from: 9, level: 1, text: 'M' },
            },
          },
          {
            id: 'memo-n',
            state: {
              kind: 'adopted',
              heading: { from: 9, level: 1, text: 'M' },
            },
          },
        ],
      },
      afterRedoUndo: {
        body: initial,
        editor: initial,
        memos: [
          { id: 'memo-m', state: { kind: 'unorganized' } },
          { id: 'memo-n', state: { kind: 'unorganized' } },
        ],
      },
    })
  })

  it('restores adoption after undoing a remotely edited inserted heading', async () => {
    const initial = '# Start'
    const mounted = mount(initial)
    insertMemo(mounted)
    const remote = new Y.Doc()
    cleanups.push(() => {
      remote.destroy()
    })
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(mounted.doc))
    const remoteBody = getBody(remote)
    const markerIndex = remoteBody.toJSON().indexOf('# M')
    remoteBody.delete(markerIndex + 2, 1)
    remoteBody.insert(markerIndex + 2, 'MXX')
    act(() => {
      Y.applyUpdate(
        mounted.doc,
        Y.encodeStateAsUpdate(remote, Y.encodeStateVector(mounted.doc)),
      )
    })
    const afterRemoteEdit = readOutput(mounted)

    const afterUndo = await undoAndRedo(mounted)
    const afterRedo = readOutput(mounted)

    expect(
      readHistoryOutput({ afterRemoteEdit, afterUndo }, afterRedo),
    ).toEqual({
      afterRemoteEdit: {
        body: '# Start\n\n# MXX\n\n',
        editor: '# Start\n\n# MXX\n\n',
        memos: [
          {
            id: 'memo-m',
            state: {
              kind: 'adopted',
              heading: { from: 9, level: 1, text: 'MXX' },
            },
          },
          { id: 'memo-n', state: { kind: 'unorganized' } },
        ],
      },
      afterUndo: {
        body: '# StartMXX',
        editor: '# StartMXX',
        memos: [
          { id: 'memo-m', state: { kind: 'unorganized' } },
          { id: 'memo-n', state: { kind: 'unorganized' } },
        ],
      },
      afterRedo: {
        body: '# Start\n\n# MXX\n\n',
        editor: '# Start\n\n# MXX\n\n',
        memos: [
          {
            id: 'memo-m',
            state: {
              kind: 'adopted',
              heading: { from: 9, level: 1, text: 'MXX' },
            },
          },
          { id: 'memo-n', state: { kind: 'unorganized' } },
        ],
      },
    })
  })

  it('documents adoption history when its previous heading moves after insertion', async () => {
    const initial = '# A\n\n# B\n\n# C'
    const mounted = mount(initial)
    const previousAdoption = setMemoAdoptedTo(
      mounted.doc,
      'memo-m',
      initial.indexOf('# B'),
    )
    if (previousAdoption.isErr()) throw previousAdoption.error
    insertMemo(mounted)
    const afterInsert = readOutput(mounted)
    const moved = mounted.history.move(
      {
        from: getBody(mounted.doc).toJSON().indexOf('# B'),
        destination: getBody(mounted.doc).length,
      },
      mounted.view,
    )
    if (moved.isErr()) throw moved.error
    const afterMove = readOutput(mounted)
    await pressUndo(mounted.view)
    const afterUndoMove = readOutput(mounted)
    await pressUndo(mounted.view)
    const afterUndoInsert = readOutput(mounted)
    await pressRedo(mounted.view)
    const afterRedoInsert = readOutput(mounted)

    expect(
      readHistoryOutput(
        { afterInsert, afterMove, afterUndoMove, afterUndoInsert },
        afterRedoInsert,
      ),
    ).toEqual({
      afterInsert: {
        body: '# A\n\n# B\n\n# C\n\n# M\n\n',
        editor: '# A\n\n# B\n\n# C\n\n# M\n\n',
        memos: [
          {
            id: 'memo-m',
            state: {
              kind: 'adopted',
              heading: { from: 15, level: 1, text: 'M' },
            },
          },
          { id: 'memo-n', state: { kind: 'unorganized' } },
        ],
      },
      afterMove: {
        body: '# A\n\n# C\n\n# M\n\n# B\n',
        editor: '# A\n\n# C\n\n# M\n\n# B\n',
        memos: [
          {
            id: 'memo-m',
            state: {
              kind: 'adopted',
              heading: { from: 10, level: 1, text: 'M' },
            },
          },
          { id: 'memo-n', state: { kind: 'unorganized' } },
        ],
      },
      afterUndoMove: {
        body: '# A\n\n# B\n\n# C\n\n# M\n\n',
        editor: '# A\n\n# B\n\n# C\n\n# M\n\n',
        memos: [
          {
            id: 'memo-m',
            state: {
              kind: 'adopted',
              heading: { from: 15, level: 1, text: 'M' },
            },
          },
          { id: 'memo-n', state: { kind: 'unorganized' } },
        ],
      },
      afterUndoInsert: {
        body: initial,
        editor: initial,
        memos: [
          { id: 'memo-m', state: { kind: 'unorganized' } },
          { id: 'memo-n', state: { kind: 'unorganized' } },
        ],
      },
      afterRedo: {
        body: '# A\n\n# B\n\n# C\n\n# M\n\n',
        editor: '# A\n\n# B\n\n# C\n\n# M\n\n',
        memos: [
          {
            id: 'memo-m',
            state: {
              kind: 'adopted',
              heading: { from: 15, level: 1, text: 'M' },
            },
          },
          { id: 'memo-n', state: { kind: 'unorganized' } },
        ],
      },
    })
  })
})
