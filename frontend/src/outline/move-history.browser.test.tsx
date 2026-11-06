import { EditorState, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'

import {
  addMemo,
  getBody,
  listMemos,
  setBody,
  setMemoAdoptedTo,
} from '#article/index'
import { replaceBody } from '#editor/replace-body'
import { createMoveHistory } from '#outline/index'

type HistoryEditor = {
  body: Y.Text
  doc: Y.Doc
  history: ReturnType<typeof createMoveHistory>
  view: EditorView
  host: HTMLDivElement
}

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups) cleanup()
  cleanups.length = 0
})

function createHistoryEditor(markdown: string): HistoryEditor {
  const doc = new Y.Doc()
  setBody(doc, markdown)
  const body = getBody(doc)
  const history = createMoveHistory(doc)
  const host = document.createElement('div')
  document.body.append(host)
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: markdown,
      extensions: [
        history.extension,
        yCollab(body, null, { undoManager: false }),
      ],
    }),
  })

  cleanups.push(() => {
    view.destroy()
    history.destroy()
    doc.destroy()
    host.remove()
  })

  return { body, doc, history, view, host }
}

function edit(
  editor: HistoryEditor,
  from: number,
  to: number,
  insert: string,
  userEvent: string,
  time?: number,
): void {
  editor.view.dispatch({
    changes: { from, to, insert },
    annotations: [
      Transaction.userEvent.of(userEvent),
      ...(time === undefined ? [] : [Transaction.time.of(time)]),
    ],
  })
}

function step(editor: HistoryEditor, direction: 'undo' | 'redo'): boolean {
  return editor.history[direction](editor.view).match(
    (changed) => changed,
    () => false,
  )
}

function readMemoStates(doc: Y.Doc) {
  return listMemos(doc).map(({ id, state }) => ({
    id,
    state:
      state.kind === 'adopted'
        ? {
            kind: state.kind,
            heading: {
              from: state.heading.from,
              level: state.heading.level,
              text: state.heading.text,
            },
          }
        : { kind: state.kind },
  }))
}

describe('MoveHistory', () => {
  it('undoes and redoes a body replacement as one history entry', () => {
    const initial = 'previous imported text\n'
    const replacement = 'replacement imported text\n'
    const editor = createHistoryEditor(initial)
    replaceBody(editor.view, replacement)
    const afterReplace = editor.body.toJSON()
    const undo = editor.history.undo(editor.view).match(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error: error.message }),
    )
    const afterUndo = editor.body.toJSON()
    const extraUndo = editor.history.undo(editor.view).match(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error: error.message }),
    )
    const redo = editor.history.redo(editor.view).match(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error: error.message }),
    )

    const readOutput = () => ({
      afterReplace,
      undo,
      afterUndo,
      extraUndo,
      redo,
      afterRedo: editor.body.toJSON(),
    })
    expect(readOutput()).toEqual({
      afterReplace: replacement,
      undo: { ok: true, value: true },
      afterUndo: initial,
      extraUndo: { ok: true, value: false },
      redo: { ok: true, value: true },
      afterRedo: replacement,
    })
  })

  it('groups IME composition updates into one history entry', () => {
    const initial = 'first\n\ntwo\n'
    const editor = createHistoryEditor(initial)
    const insertion = initial.indexOf('first')
    edit(editor, insertion, insertion, 'に', 'input.type.compose', 10_000)
    edit(
      editor,
      insertion + 1,
      insertion + 1,
      'ほん',
      'input.type.compose',
      20_000,
    )
    const afterComposition = editor.body.toJSON()
    const undo = editor.history.undo(editor.view).match(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error: error.message }),
    )
    const afterUndo = editor.body.toJSON()
    const extraUndo = editor.history.undo(editor.view).match(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error: error.message }),
    )
    const redo = editor.history.redo(editor.view).match(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error: error.message }),
    )

    const readOutput = () => ({
      afterComposition,
      undo,
      afterUndo,
      extraUndo,
      redo,
      afterRedo: editor.body.toJSON(),
    })
    expect(readOutput()).toEqual({
      afterComposition: 'にほんfirst\n\ntwo\n',
      undo: { ok: true, value: true },
      afterUndo: initial,
      extraUndo: { ok: true, value: false },
      redo: { ok: true, value: true },
      afterRedo: 'にほんfirst\n\ntwo\n',
    })
  })

  it('groups adjacent ordinary typing into one history entry', () => {
    const initial = 'first\n\nsecond\n'
    const editor = createHistoryEditor(initial)
    edit(editor, 0, 0, 'a', 'input.type', 10_000)
    edit(editor, 1, 1, 'b', 'input.type', 10_100)
    const afterTyping = editor.body.toJSON()
    const undo = step(editor, 'undo')
    const afterUndo = editor.body.toJSON()
    const extraUndo = step(editor, 'undo')
    const redo = step(editor, 'redo')

    const readOutput = () => ({
      afterTyping,
      undo,
      afterUndo,
      extraUndo,
      redo,
      afterRedo: editor.body.toJSON(),
    })
    expect(readOutput()).toEqual({
      afterTyping: 'abfirst\n\nsecond\n',
      undo: true,
      afterUndo: initial,
      extraUndo: false,
      redo: true,
      afterRedo: 'abfirst\n\nsecond\n',
    })
  })

  it('undoes and redoes local text changes and moves newest first', () => {
    const initial = '# Redwood\n\nAmber meadow.\n\n# Indigo\n\nCobalt shore.\n'
    const editor = createHistoryEditor(initial)
    const titleEnd = initial.indexOf('Indigo') + 'Indigo'.length
    edit(editor, titleEnd, titleEnd, '!', 'input.type')
    const beforeMove = editor.body.toJSON()
    const move = editor.history.move(
      {
        from: beforeMove.indexOf('# Indigo'),
        destination: 0,
      },
      editor.view,
    )
    const afterMove = editor.body.toJSON()
    const documentEnd = editor.view.state.doc.length
    edit(editor, documentEnd, documentEnd, ' Draft.', 'input.type')
    const afterSecondEdit = editor.body.toJSON()

    const undoResults = [
      step(editor, 'undo'),
      step(editor, 'undo'),
      step(editor, 'undo'),
    ]
    const afterUndo = editor.body.toJSON()
    const redoResults = [
      step(editor, 'redo'),
      step(editor, 'redo'),
      step(editor, 'redo'),
    ]
    const afterRedo = editor.body.toJSON()

    const readOutput = () => ({
      moveSucceeded: move.isOk(),
      beforeMove,
      afterMove,
      afterSecondEdit,
      undoResults,
      afterUndo,
      redoResults,
      afterRedo,
      editor: editor.view.state.doc.toString(),
    })
    expect(readOutput()).toEqual({
      moveSucceeded: true,
      beforeMove: '# Redwood\n\nAmber meadow.\n\n# Indigo!\n\nCobalt shore.\n',
      afterMove: '# Indigo!\n\nCobalt shore.\n\n# Redwood\n\nAmber meadow.\n',
      afterSecondEdit:
        '# Indigo!\n\nCobalt shore.\n\n# Redwood\n\nAmber meadow.\n Draft.',
      undoResults: [true, true, true],
      afterUndo: initial,
      redoResults: [true, true, true],
      afterRedo:
        '# Indigo!\n\nCobalt shore.\n\n# Redwood\n\nAmber meadow.\n Draft.',
      editor:
        '# Indigo!\n\nCobalt shore.\n\n# Redwood\n\nAmber meadow.\n Draft.',
    })
  })

  it('restores split paragraphs after undoing a later move', () => {
    const initial =
      '# Loom\n\nFirst sentence. Next sentence.\n\nFollowing paragraph.\n'
    const editor = createHistoryEditor(initial)
    const splitAt = initial.indexOf('Next sentence') - 1
    edit(editor, splitAt, splitAt, '\n\n', 'input.type', 1_000)
    const afterFirstSplit = editor.body.toJSON()
    edit(editor, splitAt + 2, splitAt + 2, '\n\n', 'input.type', 2_000)
    const afterSecondSplit = editor.body.toJSON()
    const move = editor.history.move(
      {
        from: afterSecondSplit.indexOf('Next sentence'),
        destination: editor.view.state.doc.length,
      },
      editor.view,
    )
    const afterMove = editor.body.toJSON()
    const undoResults = [
      step(editor, 'undo'),
      step(editor, 'undo'),
      step(editor, 'undo'),
    ]

    const readOutput = () => ({
      afterFirstSplit,
      afterSecondSplit,
      moveSucceeded: move.isOk(),
      afterMove,
      undoResults,
      finalText: editor.body.toJSON(),
      editor: editor.view.state.doc.toString(),
    })
    expect(readOutput()).toEqual({
      afterFirstSplit:
        '# Loom\n\nFirst sentence.\n\n Next sentence.\n\nFollowing paragraph.\n',
      afterSecondSplit:
        '# Loom\n\nFirst sentence.\n\n\n\n Next sentence.\n\nFollowing paragraph.\n',
      moveSucceeded: true,
      afterMove:
        '# Loom\n\nFirst sentence.\n\n\n\n Following paragraph.\n\nNext sentence.\n',
      undoResults: [true, true, true],
      finalText: initial,
      editor: initial,
    })
  })

  it('restores separated edits around a moved paragraph', () => {
    const initial =
      '# Maple\n\npqr\n\n# Ocean\n\nfirst memo\n\n# Stone\n\nlast line\n'
    const editor = createHistoryEditor(initial)
    const removedPrefix = initial.indexOf('pq')
    edit(editor, removedPrefix, removedPrefix + 2, '', 'delete.selection')
    const afterFirstEdit = editor.body.toJSON()
    const move = editor.history.move(
      {
        from: afterFirstEdit.indexOf('first memo'),
        destination: afterFirstEdit.indexOf('last line'),
      },
      editor.view,
    )
    const afterMove = editor.body.toJSON()
    const lastLine = afterMove.indexOf('last line')
    edit(editor, lastLine, lastLine + 4, '', 'delete.selection')
    const afterLastEdit = editor.body.toJSON()
    const undoResults = [
      step(editor, 'undo'),
      step(editor, 'undo'),
      step(editor, 'undo'),
    ]

    const readOutput = () => ({
      afterFirstEdit,
      moveSucceeded: move.isOk(),
      afterMove,
      afterLastEdit,
      undoResults,
      finalText: editor.body.toJSON(),
      editor: editor.view.state.doc.toString(),
    })
    expect(readOutput()).toEqual({
      afterFirstEdit:
        '# Maple\n\nr\n\n# Ocean\n\nfirst memo\n\n# Stone\n\nlast line\n',
      moveSucceeded: true,
      afterMove:
        '# Maple\n\nr\n\n# Ocean\n\n# Stone\n\nfirst memo\n\nlast line\n',
      afterLastEdit:
        '# Maple\n\nr\n\n# Ocean\n\n# Stone\n\nfirst memo\n\n line\n',
      undoResults: [true, true, true],
      finalText: initial,
      editor: initial,
    })
  })

  it('keeps a memo adopted when undo restores its deleted heading', () => {
    const initial = '# Cedar\n\nA note remains.\n'
    const editor = createHistoryEditor(initial)
    addMemo(editor.doc, { id: 'memo-cedar', text: 'Keep this title', order: 0 })
    setMemoAdoptedTo(editor.doc, 'memo-cedar', 0)
    edit(editor, 0, 1, '', 'delete.selection')
    const afterDelete = readMemoStates(editor.doc)
    const undo = editor.history.undo(editor.view)
    const afterUndo = readMemoStates(editor.doc)

    const readOutput = () => ({
      afterDelete,
      undoSucceeded: undo.isOk() && undo.value,
      afterUndo,
    })
    const expected = {
      afterDelete: [{ id: 'memo-cedar', state: { kind: 'unorganized' } }],
      undoSucceeded: true,
      afterUndo: [
        {
          id: 'memo-cedar',
          state: {
            kind: 'adopted',
            heading: { from: 0, level: 1, text: 'Cedar' },
          },
        },
      ],
    }
    expect(readOutput()).toEqual(expected)
  })

  it('keeps a memo adopted when grouped edits delete and restore its heading', () => {
    const initial = '#  Cedar\n\nA note remains.\n'
    const editor = createHistoryEditor(initial)
    addMemo(editor.doc, { id: 'memo-cedar', text: 'Keep this title', order: 0 })
    setMemoAdoptedTo(editor.doc, 'memo-cedar', 0)
    edit(editor, 1, 2, '', 'delete.selection', 10_000)
    const afterFirstDelete = editor.body.toJSON()
    edit(editor, 0, 1, '', 'delete.selection', 10_100)
    const afterSecondDelete = editor.body.toJSON()
    const undo = editor.history.undo(editor.view)
    const afterUndo = editor.body.toJSON()
    const afterUndoMemoStates = readMemoStates(editor.doc)

    const readOutput = () => ({
      afterFirstDelete,
      afterSecondDelete,
      undo: undo.isOk() && undo.value,
      afterUndo,
      afterUndoMemoStates,
    })
    expect(readOutput()).toEqual({
      afterFirstDelete: '# Cedar\n\nA note remains.\n',
      afterSecondDelete: ' Cedar\n\nA note remains.\n',
      undo: true,
      afterUndo: initial,
      afterUndoMemoStates: [
        {
          id: 'memo-cedar',
          state: {
            kind: 'adopted',
            heading: { from: 0, level: 1, text: 'Cedar' },
          },
        },
      ],
    })
  })

  it('undoes and redoes a replacement around a later move', () => {
    const initial = '# Cedar\n\nbefore target after\n\n# Flint\n\nsecond\n'
    const editor = createHistoryEditor(initial)
    const targetFrom = initial.indexOf('target')
    edit(
      editor,
      targetFrom,
      targetFrom + 'target'.length,
      'replacement',
      'input.replace',
    )
    const afterReplacement = editor.body.toJSON()
    const move = editor.history.move(
      {
        from: afterReplacement.indexOf('# Cedar'),
        destination: editor.body.length,
      },
      editor.view,
    )
    const afterMove = editor.body.toJSON()
    const undoResults = [step(editor, 'undo'), step(editor, 'undo')]
    const afterUndo = editor.body.toJSON()
    const redoResults = [step(editor, 'redo'), step(editor, 'redo')]

    const readOutput = () => ({
      afterReplacement,
      moveSucceeded: move.isOk(),
      afterMove,
      undoResults,
      afterUndo,
      redoResults,
      afterRedo: editor.body.toJSON(),
      editor: editor.view.state.doc.toString(),
    })
    expect(readOutput()).toEqual({
      afterReplacement:
        '# Cedar\n\nbefore replacement after\n\n# Flint\n\nsecond\n',
      moveSucceeded: true,
      afterMove: '# Flint\n\nsecond\n\n# Cedar\n\nbefore replacement after\n',
      undoResults: [true, true],
      afterUndo: initial,
      redoResults: [true, true],
      afterRedo: '# Flint\n\nsecond\n\n# Cedar\n\nbefore replacement after\n',
      editor: '# Flint\n\nsecond\n\n# Cedar\n\nbefore replacement after\n',
    })
  })

  it('resolves a move after a remote insertion before the moved block', () => {
    const initial = 'first\n\nsecond\n\nthird\n'
    const editor = createHistoryEditor(initial)
    const move = editor.history.move(
      { from: initial.indexOf('second'), destination: editor.body.length },
      editor.view,
    )
    const afterMove = editor.body.toJSON()
    editor.doc.transact(() => {
      editor.body.insert(0, 'remote\n\n')
    }, 'remote')
    const afterRemoteInsert = editor.body.toJSON()
    const undo = editor.history.undo(editor.view)

    const readOutput = () => ({
      moveSucceeded: move.isOk(),
      afterMove,
      afterRemoteInsert,
      undoSucceeded: undo.isOk() && undo.value,
      body: editor.body.toJSON(),
      editor: editor.view.state.doc.toString(),
    })
    expect(readOutput()).toEqual({
      moveSucceeded: true,
      afterMove: 'first\n\nthird\n\nsecond\n',
      afterRemoteInsert: 'remote\n\nfirst\n\nthird\n\nsecond\n',
      undoSucceeded: true,
      body: 'remote\n\nfirst\n\nsecond\n\nthird\n',
      editor: 'remote\n\nfirst\n\nsecond\n\nthird\n',
    })
  })

  it('undoes a move with a remote edit inside the moved block', () => {
    const initial = 'first\n\nsecond\n'
    const editor = createHistoryEditor(initial)
    const errors: string[] = []
    editor.history.onError((error) => {
      if (error) errors.push(error.message)
    })
    const firstEnd = initial.indexOf('first') + 'first'.length
    edit(editor, firstEnd, firstEnd, ' typed', 'input.type')
    const afterEdit = editor.body.toJSON()
    const move = editor.history.move(
      { from: afterEdit.indexOf('second'), destination: 0 },
      editor.view,
    )
    const movedSecond = editor.body.toJSON()
    editor.doc.transact(() => {
      editor.body.insert(movedSecond.indexOf('second') + 1, 'remote ')
    }, 'remote')
    const beforeUndo = editor.body.toJSON()
    const moveUndo = editor.history.undo(editor.view).match(
      (value) => value,
      () => false,
    )
    const afterMoveUndo = editor.body.toJSON()
    const olderUndo = editor.history.undo(editor.view).match(
      (value) => value,
      () => false,
    )

    const readOutput = () => ({
      afterEdit,
      moveSucceeded: move.isOk(),
      beforeUndo,
      moveUndo,
      afterMoveUndo,
      olderUndo,
      finalText: editor.body.toJSON(),
      errors,
    })
    expect(readOutput()).toEqual({
      afterEdit: 'first typed\n\nsecond\n',
      moveSucceeded: true,
      beforeUndo: 'sremote econd\n\nfirst typed\n',
      moveUndo: true,
      afterMoveUndo: 'first typed\n\nsremote econd\n',
      olderUndo: true,
      finalText: 'first\n\nsremote econd\n',
      errors: [],
    })
  })

  it('drops older history after a remote edit crosses a move seam', () => {
    const initial = 'first\n\nsecond\n'
    const editor = createHistoryEditor(initial)
    const firstEnd = initial.indexOf('first') + 'first'.length
    edit(editor, firstEnd, firstEnd, ' typed', 'input.type')
    const afterEdit = editor.body.toJSON()
    const move = editor.history.move(
      { from: afterEdit.indexOf('second'), destination: 0 },
      editor.view,
    )
    const movedSecond = editor.body.toJSON()
    const remotePosition = move.isOk() ? move.value.seam : -1
    editor.doc.transact(() => {
      editor.body.insert(remotePosition, 'remote ')
    }, 'remote')
    const beforeUndo = editor.body.toJSON()
    const failedUndo = editor.history.undo(editor.view).match(
      () => null,
      (error) => error.message,
    )
    const afterFailedUndo = editor.body.toJSON()
    const olderUndo = editor.history.undo(editor.view).match(
      (value) => value,
      () => false,
    )

    const readOutput = () => ({
      afterEdit,
      moveSucceeded: move.isOk(),
      movedSecond,
      beforeUndo,
      failedUndo,
      afterFailedUndo,
      olderUndo,
      finalText: editor.body.toJSON(),
    })
    expect(readOutput()).toEqual({
      afterEdit: 'first typed\n\nsecond\n',
      moveSucceeded: true,
      movedSecond: 'second\n\nfirst typed\n',
      beforeUndo: 'second\n\nfirst typed\nremote ',
      failedUndo: 'A remote change overlaps a moved block boundary',
      afterFailedUndo: 'second\n\nfirst typed\nremote ',
      olderUndo: false,
      finalText: 'second\n\nfirst typed\nremote ',
    })
  })

  it('continues past a text undo invalidated by a remote deletion', () => {
    const initial = 'alpha\n\nbravo\n\ncharlie\n'
    const editor = createHistoryEditor(initial)
    const alphaMove = editor.history.move(
      { from: initial.indexOf('alpha'), destination: editor.body.length },
      editor.view,
    )
    const afterAlphaMove = editor.body.toJSON()
    const typedAt = afterAlphaMove.indexOf('bravo') + 'bravo'.length
    edit(editor, typedAt, typedAt, ' typed', 'input.type')
    const afterEdit = editor.body.toJSON()
    const charlieMove = editor.history.move(
      { from: afterEdit.indexOf('charlie'), destination: 0 },
      editor.view,
    )
    const afterCharlieMove = editor.body.toJSON()
    editor.doc.transact(() => {
      const typedFrom = editor.body.toJSON().indexOf(' typed')
      editor.body.delete(typedFrom, ' typed'.length)
    }, 'remote')
    const afterRemoteDelete = editor.body.toJSON()
    const undoResults = [
      step(editor, 'undo'),
      step(editor, 'undo'),
      step(editor, 'undo'),
    ]

    const readOutput = () => ({
      alphaMoveSucceeded: alphaMove.isOk(),
      afterAlphaMove,
      afterEdit,
      charlieMoveSucceeded: charlieMove.isOk(),
      afterCharlieMove,
      afterRemoteDelete,
      undoResults,
      finalText: editor.body.toJSON(),
      editor: editor.view.state.doc.toString(),
    })
    expect(readOutput()).toEqual({
      alphaMoveSucceeded: true,
      afterAlphaMove: 'bravo\n\ncharlie\n\nalpha\n',
      afterEdit: 'bravo typed\n\ncharlie\n\nalpha\n',
      charlieMoveSucceeded: true,
      afterCharlieMove: 'charlie\n\nbravo typed\n\nalpha\n',
      afterRemoteDelete: 'charlie\n\nbravo\n\nalpha\n',
      undoResults: [true, true, false],
      finalText: initial,
      editor: initial,
    })
  })

  it('clears move redo after a new text edit', () => {
    const initial = 'alpha\n\nbeta\n'
    const editor = createHistoryEditor(initial)
    const move = editor.history.move(
      { from: initial.indexOf('beta'), destination: 0 },
      editor.view,
    )
    const afterMove = editor.body.toJSON()
    const undo = editor.history.undo(editor.view)
    const afterUndo = editor.body.toJSON()
    edit(editor, 0, 0, 'typed ', 'input.type')
    const afterEdit = editor.body.toJSON()
    const redo = editor.history.redo(editor.view)

    const readOutput = () => ({
      moveSucceeded: move.isOk(),
      afterMove,
      undoSucceeded: undo.isOk() && undo.value,
      afterUndo,
      afterEdit,
      redoAvailable: redo.isOk() && redo.value,
      finalText: editor.body.toJSON(),
      editor: editor.view.state.doc.toString(),
    })
    expect(readOutput()).toEqual({
      moveSucceeded: true,
      afterMove: 'beta\n\nalpha\n',
      undoSucceeded: true,
      afterUndo: initial,
      afterEdit: 'typed alpha\n\nbeta\n',
      redoAvailable: false,
      finalText: 'typed alpha\n\nbeta\n',
      editor: 'typed alpha\n\nbeta\n',
    })
  })

  it('restores the first moved heading section after another section moves', () => {
    const initial = '# A\n\naaa\n\n## A1\n\nx\n\n# B\n\nb\n\n# C\n\nc\n'
    const editor = createHistoryEditor(initial)
    const firstMove = editor.history.move(
      { from: initial.indexOf('aaa'), destination: initial.indexOf('# C') },
      editor.view,
    )
    const afterFirstMove = editor.body.toJSON()
    const secondMove = editor.history.move(
      {
        from: afterFirstMove.indexOf('# A'),
        destination: afterFirstMove.length,
      },
      editor.view,
    )
    const afterSecondMove = editor.body.toJSON()
    const undoResults = [step(editor, 'undo'), step(editor, 'undo')]

    const readOutput = () => ({
      firstMoveSucceeded: firstMove.isOk(),
      afterFirstMove,
      secondMoveSucceeded: secondMove.isOk(),
      afterSecondMove,
      undoResults,
      finalText: editor.body.toJSON(),
      editor: editor.view.state.doc.toString(),
    })
    expect(readOutput()).toEqual({
      firstMoveSucceeded: true,
      afterFirstMove: '# A\n\n## A1\n\nx\n\n# B\n\nb\n\naaa\n\n# C\n\nc\n',
      secondMoveSucceeded: true,
      afterSecondMove: '# B\n\nb\n\naaa\n\n# C\n\nc\n\n# A\n\n## A1\n\nx\n',
      undoResults: [true, true],
      finalText: initial,
      editor: initial,
    })
  })

  it('restores deleted text in its original section after moving that section', () => {
    const initial =
      '# A\n\nkeep\n\n## A1\n\ndeleted para\n\n# B\n\nb\n\n# C\n\nc\n'
    const editor = createHistoryEditor(initial)
    const deletedFrom = initial.indexOf('deleted para')
    edit(
      editor,
      deletedFrom,
      deletedFrom + 'deleted para'.length,
      '',
      'delete.selection',
    )
    const afterDelete = editor.body.toJSON()
    const move = editor.history.move(
      { from: afterDelete.indexOf('# A'), destination: editor.body.length },
      editor.view,
    )
    const afterMove = editor.body.toJSON()
    const undoResults = [step(editor, 'undo'), step(editor, 'undo')]

    const readOutput = () => ({
      afterDelete,
      moveSucceeded: move.isOk(),
      afterMove,
      undoResults,
      finalText: editor.body.toJSON(),
      editor: editor.view.state.doc.toString(),
    })
    expect(readOutput()).toEqual({
      afterDelete: '# A\n\nkeep\n\n## A1\n\n\n\n# B\n\nb\n\n# C\n\nc\n',
      moveSucceeded: true,
      afterMove: '# B\n\nb\n\n# C\n\nc\n\n# A\n\nkeep\n\n## A1\n',
      undoResults: [true, true],
      finalText: initial,
      editor: initial,
    })
  })

  it('preserves mixed move undo and redo sequences across seeded runs', () => {
    const initial =
      '# Saffron\n\nseed-a\n\n# Glacier\n\nseed-b\n\n# Meadow\n\nseed-c\n'
    const seeds = Array.from({ length: 32 }, (_, index) => index + 1)
    const operationCount = 48
    const actual = seeds.map((seed) => {
      let randomState = seed
      const nextRandom = () => {
        randomState = (randomState * 1_664_525 + 1_013_904_223) >>> 0
        return randomState
      }
      const editor = createHistoryEditor(initial)
      const headings = ['# Saffron', '# Glacier', '# Meadow']
      const undoStates: string[] = []
      const redoStates: string[] = []
      const errors: string[] = []
      const mismatches: {
        operation: number
        expected: string
        actual: string
      }[] = []
      let expectedCurrent = initial
      let expectedLatest = initial

      const compareCurrent = (operation: number) => {
        const current = editor.body.toJSON()
        if (current !== expectedCurrent) {
          mismatches.push({
            operation,
            expected: expectedCurrent,
            actual: current,
          })
        }
      }

      for (let operation = 0; operation < operationCount; operation += 1) {
        const choice = nextRandom() % 4
        if (choice < 2) {
          const markdown = editor.body.toJSON()
          const source = headings[nextRandom() % headings.length]
          if (source === undefined) {
            errors.push('heading seed was missing')
            continue
          }
          const from = markdown.indexOf(source)
          const destination = from === 0 ? markdown.length : 0
          const result = editor.history.move({ from, destination }, editor.view)
          if (result.isErr()) {
            errors.push(result.error.message)
          } else {
            undoStates.push(expectedCurrent)
            expectedCurrent = editor.body.toJSON()
            expectedLatest = expectedCurrent
            redoStates.length = 0
          }
        } else if (choice === 2) {
          const result = editor.history.undo(editor.view)
          if (undoStates.length > 0) {
            const expected = undoStates.pop()
            redoStates.push(expectedCurrent)
            if (result.isErr()) errors.push(result.error.message)
            else if (!result.value) errors.push('undo returned false')
            else if (expected !== undefined) expectedCurrent = expected
          } else if (result.isErr() || result.value) {
            errors.push('undo found an unexpected action')
          }
        } else {
          const result = editor.history.redo(editor.view)
          if (redoStates.length > 0) {
            const expected = redoStates.pop()
            undoStates.push(expectedCurrent)
            if (result.isErr()) errors.push(result.error.message)
            else if (!result.value) errors.push('redo returned false')
            else if (expected !== undefined) expectedCurrent = expected
          } else if (result.isErr() || result.value) {
            errors.push('redo found an unexpected action')
          }
        }
        compareCurrent(operation)
      }
      while (undoStates.length > 0) {
        redoStates.push(expectedCurrent)
        const expected = undoStates.pop()
        const result = editor.history.undo(editor.view)
        if (result.isErr()) errors.push(result.error.message)
        else if (!result.value) errors.push('undo returned false')
        else if (expected !== undefined) expectedCurrent = expected
        compareCurrent(operationCount)
      }
      const afterUndo = editor.body.toJSON()
      while (redoStates.length > 0) {
        const expected = redoStates.pop()
        undoStates.push(expectedCurrent)
        const result = editor.history.redo(editor.view)
        if (result.isErr()) errors.push(result.error.message)
        else if (!result.value) errors.push('redo returned false')
        else if (expected !== undefined) expectedCurrent = expected
        compareCurrent(operationCount + 1)
      }
      const afterRedo = editor.body.toJSON()
      return {
        seed,
        errors,
        mismatches,
        restoredStart: afterUndo === initial,
        restoredFinal: afterRedo === expectedLatest,
      }
    })

    expect(actual).toEqual(
      seeds.map((seed) => ({
        seed,
        errors: [],
        mismatches: [],
        restoredStart: true,
        restoredFinal: true,
      })),
    )
  })

  it('keeps seeded text and move undo and redo states exact', () => {
    const initial =
      '# Saffron\n\nsaffron-para: seed\n\n# Glacier\n\nglacier-para: seed\n\n# Meadow\n\nmeadow-para: seed\n'
    const seeds = Array.from({ length: 64 }, (_, index) => index + 1)
    const operationCount = 48
    const actual = seeds.map((seed) => {
      let randomState = seed
      const nextRandom = () => {
        randomState = (randomState * 1_664_525 + 1_013_904_223) >>> 0
        return randomState
      }
      const editor = createHistoryEditor(initial)
      const editMarkers = ['saffron-para:', 'glacier-para:', 'meadow-para:']
      const headings = ['# Saffron', '# Glacier', '# Meadow']
      const errors: string[] = []
      const mismatches: {
        operation: number
        expected: string
        actual: string
      }[] = []
      const undoStates: string[] = []
      const redoStates: string[] = []
      let expectedCurrent = initial
      let expectedLatest = initial
      let verificationStep = 0

      const compareCurrent = (operation: number) => {
        const current = editor.body.toJSON()
        if (current !== expectedCurrent) {
          mismatches.push({
            operation,
            expected: expectedCurrent,
            actual: current,
          })
        }
      }

      const recordNewAction = (before: string) => {
        const after = editor.body.toJSON()
        if (after === before) return
        undoStates.push(before)
        expectedCurrent = after
        expectedLatest = after
        redoStates.length = 0
      }

      for (let index = 0; index < operationCount; index += 1) {
        const markdown = editor.body.toJSON()
        const operation = nextRandom() % 7
        const editTime = (index + 1) * 1_000
        if (operation < 3) {
          const marker = editMarkers[nextRandom() % editMarkers.length]
          if (marker === undefined) {
            errors.push('paragraph marker was missing')
            continue
          }
          const markerFrom = markdown.indexOf(marker)
          const position = markerFrom + marker.length + 1
          if (operation === 0) {
            edit(editor, position, position, 'x', 'input.type', editTime)
          } else if (operation === 1) {
            const character = markdown[position]
            if (character !== undefined && character !== '\n') {
              edit(
                editor,
                position,
                position + 1,
                '',
                'delete.selection',
                editTime,
              )
            } else {
              edit(editor, position, position, 'x', 'input.type', editTime)
            }
          } else {
            edit(editor, position, position, '\n', 'input.type', editTime)
          }
          recordNewAction(markdown)
        } else if (operation === 3) {
          const heading = headings[nextRandom() % headings.length]
          if (heading === undefined) {
            errors.push('heading seed was missing')
            continue
          }
          const titleEnd = markdown.indexOf(heading) + heading.length
          edit(editor, titleEnd, titleEnd, 'x', 'input.type', editTime)
          recordNewAction(markdown)
        } else if (operation === 4) {
          const fromHeading = headings[nextRandom() % headings.length]
          if (fromHeading === undefined) {
            errors.push('heading seed was missing')
            continue
          }
          const from = markdown.indexOf(fromHeading)
          const destination = from === 0 ? markdown.length : 0
          const result = editor.history.move({ from, destination }, editor.view)
          if (result.isErr()) errors.push(result.error.message)
          else recordNewAction(markdown)
        } else if (operation === 5) {
          const result = editor.history.undo(editor.view)
          if (undoStates.length === 0) {
            if (result.isErr() || result.value)
              errors.push('undo found an unexpected action')
          } else {
            const expected = undoStates.pop()
            if (result.isErr()) errors.push(result.error.message)
            else if (!result.value) errors.push('undo returned false')
            else {
              redoStates.push(expectedCurrent)
              if (expected !== undefined) expectedCurrent = expected
            }
          }
        } else {
          const result = editor.history.redo(editor.view)
          if (redoStates.length === 0) {
            if (result.isErr() || result.value)
              errors.push('redo found an unexpected action')
          } else {
            const expected = redoStates.pop()
            if (result.isErr()) errors.push(result.error.message)
            else if (!result.value) errors.push('redo returned false')
            else {
              undoStates.push(expectedCurrent)
              if (expected !== undefined) expectedCurrent = expected
            }
          }
        }
        compareCurrent(verificationStep)
        verificationStep += 1
      }

      while (undoStates.length > 0) {
        const expected = undoStates.pop()
        const result = editor.history.undo(editor.view)
        if (result.isErr()) errors.push(result.error.message)
        else if (!result.value) errors.push('undo returned false')
        else {
          redoStates.push(expectedCurrent)
          if (expected !== undefined) expectedCurrent = expected
        }
        compareCurrent(verificationStep)
        verificationStep += 1
      }
      const afterUndo = editor.body.toJSON()
      while (redoStates.length > 0) {
        const expected = redoStates.pop()
        const result = editor.history.redo(editor.view)
        if (result.isErr()) errors.push(result.error.message)
        else if (!result.value) errors.push('redo returned false')
        else {
          undoStates.push(expectedCurrent)
          if (expected !== undefined) expectedCurrent = expected
        }
        compareCurrent(verificationStep)
        verificationStep += 1
      }
      const afterRedo = editor.body.toJSON()
      return {
        seed,
        errors,
        mismatches,
        undoRestoredStart: afterUndo === initial,
        redoRestoredLatest: afterRedo === expectedLatest,
      }
    })

    expect(actual).toEqual(
      seeds.map((seed) => ({
        seed,
        errors: [],
        mismatches: [],
        undoRestoredStart: true,
        redoRestoredLatest: true,
      })),
    )
  })

  it('preserves remote text across seeded local undo and redo sequences', () => {
    const initial =
      'Opening paragraph.\n\n# Saffron\n\nsaffron-para: seed\n\nsaffron-shared: stable\n\n# Glacier\n\nglacier-para: seed\n\n# Meadow\n\nmeadow-para: seed\n'
    const seeds = Array.from({ length: 24 }, (_, index) => index + 1)
    const operationCount = 32
    const remoteText = (markdown: string, seed: number) =>
      markdown
        .replace('Opening paragraph.', `Shared opening note ${String(seed)}.`)
        .replace(
          'saffron-shared: stable',
          `saffron-shared: Peer ${String(seed)} stable`,
        )
    const actual = seeds.map((seed) => {
      let randomState = seed
      const nextRandom = () => {
        randomState = (randomState * 1_664_525 + 1_013_904_223) >>> 0
        return randomState
      }
      const editor = createHistoryEditor(initial)
      const paragraphMarkers = [
        'saffron-para:',
        'glacier-para:',
        'meadow-para:',
      ]
      const headingMarkers = ['# Saffron', '# Glacier', '# Meadow']
      const errors: string[] = []

      for (let index = 0; index < operationCount; index += 1) {
        const markdown = editor.body.toJSON()
        const operation = nextRandom() % 5
        if (operation < 2) {
          const marker =
            paragraphMarkers[nextRandom() % paragraphMarkers.length]
          if (marker === undefined) {
            errors.push('paragraph marker was missing')
            continue
          }
          const markerFrom = markdown.indexOf(marker)
          const position = markerFrom + marker.length + 1
          if (operation === 0) {
            edit(editor, position, position, 'x', 'input.type', index * 1_000)
          } else {
            const character = markdown[position]
            if (character !== undefined && character !== '\n') {
              edit(
                editor,
                position,
                position + 1,
                '',
                'delete.selection',
                index * 1_000,
              )
            }
          }
        } else if (operation === 2) {
          const marker = headingMarkers[nextRandom() % headingMarkers.length]
          if (marker === undefined) {
            errors.push('heading marker was missing')
            continue
          }
          const titleEnd = markdown.indexOf(marker) + marker.length
          edit(editor, titleEnd, titleEnd, 'x', 'input.type', index * 1_000)
        } else {
          const marker = headingMarkers[nextRandom() % headingMarkers.length]
          if (marker === undefined) {
            errors.push('heading marker was missing')
            continue
          }
          const from = markdown.indexOf(marker)
          const headingPositions = headingMarkers
            .map((candidate) => markdown.indexOf(candidate))
            .filter((position) => position >= 0)
            .sort((left, right) => left - right)
          const nextHeading = headingPositions.find(
            (position) => position > from,
          )
          const destinations = headingPositions.filter(
            (position) => position !== from && position !== nextHeading,
          )
          if (nextHeading !== undefined) destinations.push(markdown.length)
          const destination =
            destinations[nextRandom() % destinations.length] ?? markdown.length
          const result = editor.history.move({ from, destination }, editor.view)
          if (result.isErr()) errors.push(result.error.message)
        }
      }

      const beforeRemote = editor.body.toJSON()
      const openingParagraph = beforeRemote.indexOf('Opening paragraph.')
      const sharedParagraph = beforeRemote.indexOf('saffron-shared: stable')
      if (openingParagraph === -1 || sharedParagraph === -1) {
        errors.push('opening paragraph was missing')
      } else {
        editor.doc.transact(() => {
          editor.body.delete(
            openingParagraph,
            openingParagraph + 'Opening paragraph'.length,
          )
          editor.body.insert(
            openingParagraph,
            `Shared opening note ${String(seed)}`,
          )
          const updatedSharedParagraph = editor.body
            .toJSON()
            .indexOf('saffron-shared: stable')
          editor.body.insert(
            updatedSharedParagraph + 'saffron-shared: '.length,
            `Peer ${String(seed)} `,
          )
        }, 'remote')
      }

      let undoCount = 0
      for (let stepIndex = 0; stepIndex < 100; stepIndex += 1) {
        const result = editor.history.undo(editor.view)
        if (result.isErr()) {
          errors.push(result.error.message)
          continue
        }
        if (!result.value) break
        undoCount += 1
      }
      const afterUndo = editor.body.toJSON()
      let redoCount = 0
      for (let stepIndex = 0; stepIndex < 100; stepIndex += 1) {
        const result = editor.history.redo(editor.view)
        if (result.isErr()) {
          errors.push(result.error.message)
          continue
        }
        if (!result.value) break
        redoCount += 1
      }

      const afterRedo = editor.body.toJSON()
      return {
        seed,
        errors,
        undoRestored: afterUndo === remoteText(initial, seed),
        redoRestored: afterRedo === remoteText(beforeRemote, seed),
        redoCountMatchesUndo: redoCount === undoCount,
      }
    })

    expect(actual).toEqual(
      seeds.map((seed) => ({
        seed,
        errors: [],
        undoRestored: true,
        redoRestored: true,
        redoCountMatchesUndo: true,
      })),
    )
  })
})
