import { EditorSelection, EditorState, Transaction } from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'

import {
  addMemo,
  getBody,
  listMemos,
  setBody,
  setMemoAdoptedTo,
  topLevelBlocks,
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

function createHistoryEditor(
  markdown: string,
  onUpdate?: (update: ViewUpdate) => void,
): HistoryEditor {
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
        ...(onUpdate ? [EditorView.updateListener.of(onUpdate)] : []),
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

function readSelection(selection: EditorSelection) {
  return {
    ranges: selection.ranges.map(({ anchor, head }) => ({ anchor, head })),
  }
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

  it('restores the text selection on undo and redo', () => {
    const initial = 'Opening target closing\n'
    const editor = createHistoryEditor(initial)
    const beforeFrom = initial.indexOf('target')
    editor.view.dispatch({
      selection: EditorSelection.range(
        beforeFrom,
        beforeFrom + 'target'.length,
      ),
    })
    const selectionBefore = readSelection(editor.view.state.selection)
    edit(editor, 0, 0, 'Added ', 'input.type', 10_000)
    const selectionAfter = readSelection(editor.view.state.selection)
    const afterEdit = editor.body.toJSON()
    const undo = step(editor, 'undo')
    const afterUndo = editor.body.toJSON()
    const selectionAfterUndo = readSelection(editor.view.state.selection)
    const redo = step(editor, 'redo')
    const selectionAfterRedo = readSelection(editor.view.state.selection)

    const readOutput = () => ({
      afterEdit,
      undo,
      afterUndo,
      selectionBefore,
      selectionAfterUndo,
      redo,
      selectionAfter,
      selectionAfterRedo,
      afterRedo: editor.body.toJSON(),
    })
    expect(readOutput()).toEqual({
      afterEdit: 'Added Opening target closing\n',
      undo: true,
      afterUndo: initial,
      selectionBefore: { ranges: [{ anchor: 8, head: 14 }] },
      selectionAfterUndo: { ranges: [{ anchor: 8, head: 14 }] },
      redo: true,
      selectionAfter: { ranges: [{ anchor: 14, head: 20 }] },
      selectionAfterRedo: { ranges: [{ anchor: 14, head: 20 }] },
      afterRedo: 'Added Opening target closing\n',
    })
  })

  it('scrolls restored text selections into view on undo and redo', async () => {
    const initial = `${Array.from(
      { length: 80 },
      (_, index) => `Paragraph ${String(index)}.`,
    ).join('\n')}\n`
    const editor = createHistoryEditor(initial)
    editor.view.scrollDOM.style.height = '80px'
    editor.view.scrollDOM.style.overflow = 'auto'
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve()
      })
    })
    const beforePosition = initial.indexOf('Paragraph 70') + 5
    editor.view.dispatch({ selection: EditorSelection.cursor(beforePosition) })
    const beforeSelection = readSelection(editor.view.state.selection)
    edit(editor, beforePosition, beforePosition, 'Added ', 'input.type', 10_000)
    const afterSelection = readSelection(editor.view.state.selection)

    editor.view.dispatch({ selection: EditorSelection.cursor(0) })
    editor.view.scrollDOM.scrollTop = 0
    const undo = step(editor, 'undo')
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve()
      })
    })
    const selectionAfterUndo = readSelection(editor.view.state.selection)
    const scrolledAfterUndo = editor.view.scrollDOM.scrollTop > 0
    const afterUndo = editor.body.toJSON()

    editor.view.dispatch({ selection: EditorSelection.cursor(0) })
    editor.view.scrollDOM.scrollTop = 0
    const redo = step(editor, 'redo')
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve()
      })
    })
    const selectionAfterRedo = readSelection(editor.view.state.selection)
    const scrolledAfterRedo = editor.view.scrollDOM.scrollTop > 0
    const afterRedo = editor.body.toJSON()

    const readOutput = () => ({
      undo,
      beforeSelection,
      selectionAfterUndo,
      scrolledAfterUndo,
      afterUndo,
      redo,
      afterSelection,
      selectionAfterRedo,
      scrolledAfterRedo,
      afterRedo,
    })
    expect(readOutput()).toEqual({
      undo: true,
      beforeSelection: {
        ranges: [{ anchor: beforePosition, head: beforePosition }],
      },
      selectionAfterUndo: {
        ranges: [{ anchor: beforePosition, head: beforePosition }],
      },
      scrolledAfterUndo: true,
      afterUndo: initial,
      redo: true,
      afterSelection: {
        ranges: [{ anchor: beforePosition, head: beforePosition }],
      },
      selectionAfterRedo: {
        ranges: [{ anchor: beforePosition, head: beforePosition }],
      },
      scrolledAfterRedo: true,
      afterRedo: `${initial.slice(0, beforePosition)}Added ${initial.slice(beforePosition)}`,
    })
  })

  it('keeps at most one hundred history entries', () => {
    const initial = 'Opening paragraph.\n'
    const editor = createHistoryEditor(initial)
    for (let index = 0; index < 105; index += 1) {
      edit(editor, 0, 0, 'x', 'input.type', (index + 1) * 1_000)
    }
    let undoCount = 0
    for (let index = 0; index < 105; index += 1) {
      if (!step(editor, 'undo')) break
      undoCount += 1
    }
    const afterUndo = editor.body.toJSON()
    const extraUndo = step(editor, 'undo')
    let redoCount = 0
    for (let index = 0; index < 105; index += 1) {
      if (!step(editor, 'redo')) break
      redoCount += 1
    }

    const readOutput = () => ({
      undoCount,
      afterUndo,
      extraUndo,
      redoCount,
      afterRedo: editor.body.toJSON(),
    })
    expect(readOutput()).toEqual({
      undoCount: 100,
      afterUndo: `xxxxx${initial}`,
      extraUndo: false,
      redoCount: 100,
      afterRedo: `${'x'.repeat(105)}${initial}`,
    })
  })

  it('undoes text before an indented block without applying stale ranges', () => {
    const initial = '# A\n\nkeep\n\nfirst\n\n    code line\n\nlast\n'
    const editor = createHistoryEditor(initial)
    const codeStart = initial.indexOf('code line')
    edit(editor, codeStart, codeStart, 'NEW', 'input.type', 1_000)
    const afterTyping = editor.body.toJSON()
    const move = editor.history.move(
      {
        from: afterTyping.indexOf('first'),
        destination: afterTyping.indexOf('last'),
      },
      editor.view,
    )
    const afterMove = editor.body.toJSON()
    const undoMove = editor.history.undo(editor.view)
    const afterUndoMove = editor.body.toJSON()
    const undoTyping = editor.history.undo(editor.view)

    const readOutput = () => ({
      afterTyping,
      moveSucceeded: move.isOk(),
      afterMove,
      undoMove: undoMove.match(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error: error.message }),
      ),
      afterUndoMove,
      undoTyping: undoTyping.match(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error: error.message }),
      ),
      finalText: editor.body.toJSON(),
      editor: editor.view.state.doc.toString(),
    })
    expect(readOutput()).toEqual({
      afterTyping: '# A\n\nkeep\n\nfirst\n\n    NEWcode line\n\nlast\n',
      moveSucceeded: true,
      afterMove: '# A\n\nkeep\n\n    NEWcode line\n\nfirst\n\nlast\n',
      undoMove: { ok: true, value: true },
      afterUndoMove: '# A\n\nkeep\n\nfirst\n\n    NEWcode line\n\nlast\n',
      undoTyping: { ok: true, value: true },
      finalText: initial,
      editor: initial,
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

  it('restores memo adoption when a deleted range contains multiple headings', () => {
    const initial = '# A\n\nFirst.\n\n# B\n\nSecond.\n\n# C\n\nThird.\n'
    const editor = createHistoryEditor(initial)
    addMemo(editor.doc, { id: 'memo-b', text: 'A note', order: 0 })
    setMemoAdoptedTo(editor.doc, 'memo-b', initial.indexOf('# B'))
    edit(editor, 0, initial.indexOf('# C'), '', 'delete.selection')
    const afterDelete = editor.body.toJSON()
    const memoAfterDelete = readMemoStates(editor.doc)
    const undo = editor.history.undo(editor.view)
    const afterUndo = editor.body.toJSON()
    const memoAfterUndo = readMemoStates(editor.doc)

    const readOutput = () => ({
      afterDelete,
      memoAfterDelete,
      undo: undo.match(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error: error.message }),
      ),
      afterUndo,
      memoAfterUndo,
    })
    expect(readOutput()).toEqual({
      afterDelete: '# C\n\nThird.\n',
      memoAfterDelete: [{ id: 'memo-b', state: { kind: 'unorganized' } }],
      undo: { ok: true, value: true },
      afterUndo: initial,
      memoAfterUndo: [
        {
          id: 'memo-b',
          state: {
            kind: 'adopted',
            heading: { from: initial.indexOf('# B'), level: 1, text: 'B' },
          },
        },
      ],
    })
  })

  it('keeps memo adoption across deleting and restoring a heading repeatedly', () => {
    const initial = '# Cedar\n\nA note remains.\n'
    const editor = createHistoryEditor(initial)
    addMemo(editor.doc, { id: 'memo-cedar', text: 'A note', order: 0 })
    setMemoAdoptedTo(editor.doc, 'memo-cedar', 0)
    edit(editor, 0, 1, '', 'delete.selection')
    const afterDelete = editor.body.toJSON()
    const undoResults = [
      editor.history.undo(editor.view).match(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error: error.message }),
      ),
      editor.history.redo(editor.view).match(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error: error.message }),
      ),
      editor.history.undo(editor.view).match(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error: error.message }),
      ),
    ]

    const readOutput = () => ({
      afterDelete,
      undoResults,
      finalText: editor.body.toJSON(),
      memo: readMemoStates(editor.doc),
    })
    expect(readOutput()).toEqual({
      afterDelete: ' Cedar\n\nA note remains.\n',
      undoResults: [
        { ok: true, value: true },
        { ok: true, value: true },
        { ok: true, value: true },
      ],
      finalText: initial,
      memo: [
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

  it('keeps a memo adopted to a typed heading through undo and redo', () => {
    const initial = 'Opening paragraph.\n'
    const editor = createHistoryEditor(initial)
    addMemo(editor.doc, { id: 'memo-opening', text: 'A note', order: 0 })
    edit(editor, 0, 0, '# Opening\n\n', 'input.type', 10_000)
    const afterTyping = editor.body.toJSON()
    setMemoAdoptedTo(editor.doc, 'memo-opening', 0)
    const afterAdoption = readMemoStates(editor.doc)
    const undo = editor.history.undo(editor.view)
    const afterUndo = editor.body.toJSON()
    const memoAfterUndo = readMemoStates(editor.doc)
    const redo = editor.history.redo(editor.view)

    const readOutput = () => ({
      afterTyping,
      afterAdoption,
      undo: undo.match(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error: error.message }),
      ),
      afterUndo,
      memoAfterUndo,
      redo: redo.match(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error: error.message }),
      ),
      afterRedo: editor.body.toJSON(),
      memoAfterRedo: readMemoStates(editor.doc),
    })
    expect(readOutput()).toEqual({
      afterTyping: '# Opening\n\nOpening paragraph.\n',
      afterAdoption: [
        {
          id: 'memo-opening',
          state: {
            kind: 'adopted',
            heading: { from: 0, level: 1, text: 'Opening' },
          },
        },
      ],
      undo: { ok: true, value: true },
      afterUndo: initial,
      memoAfterUndo: [{ id: 'memo-opening', state: { kind: 'unorganized' } }],
      redo: { ok: true, value: true },
      afterRedo: '# Opening\n\nOpening paragraph.\n',
      memoAfterRedo: [
        {
          id: 'memo-opening',
          state: {
            kind: 'adopted',
            heading: { from: 0, level: 1, text: 'Opening' },
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
    const redo = editor.history.redo(editor.view).match(
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
      redo,
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
      redo: false,
      finalText: 'second\n\nfirst typed\nremote ',
    })
  })

  it('drops history when a remote edit changes a moved separator', () => {
    const initial = 'First paragraph.\n\nSecond paragraph.\n'
    const editor = createHistoryEditor(initial)
    edit(editor, 0, 0, 'Local ', 'input.type', 10_000)
    const afterEdit = editor.body.toJSON()
    const move = editor.history.move(
      { from: afterEdit.indexOf('Second paragraph'), destination: 0 },
      editor.view,
    )
    const afterMove = editor.body.toJSON()
    const separatorPosition = move.isOk() ? move.value.to : -1
    editor.doc.transact(() => {
      editor.body.delete(separatorPosition, 1)
    }, 'remote')
    const afterRemoteDelete = editor.body.toJSON()
    const failedUndo = editor.history.undo(editor.view).match(
      () => null,
      (error) => error.message,
    )

    const readOutput = () => ({
      moveSucceeded: move.isOk(),
      afterEdit,
      afterMove,
      separatorPosition,
      afterRemoteDelete,
      failedUndo,
      afterFailedUndo: editor.body.toJSON(),
      olderUndo: step(editor, 'undo'),
      redo: step(editor, 'redo'),
    })
    expect(readOutput()).toEqual({
      moveSucceeded: true,
      afterEdit: 'Local First paragraph.\n\nSecond paragraph.\n',
      afterMove: 'Second paragraph.\n\nLocal First paragraph.\n',
      separatorPosition: 18,
      afterRemoteDelete: 'Second paragraph.\nLocal First paragraph.\n',
      failedUndo: 'A remote change overlaps a moved separator',
      afterFailedUndo: 'Second paragraph.\nLocal First paragraph.\n',
      olderUndo: false,
      redo: false,
    })
  })

  it('clears both stacks after a move can no longer be reversed', () => {
    const initial = 'first\n\nsecond\n'
    const editor = createHistoryEditor(initial)
    const firstEnd = initial.indexOf('first') + 'first'.length
    edit(editor, firstEnd, firstEnd, ' typed', 'input.type', 10_000)
    const afterEdit = editor.body.toJSON()
    const move = editor.history.move(
      { from: afterEdit.indexOf('second'), destination: 0 },
      editor.view,
    )
    const afterMove = editor.body.toJSON()
    const afterMoveEnd = editor.view.state.doc.length
    edit(editor, afterMoveEnd, afterMoveEnd, ' later', 'input.type', 20_000)
    const afterLaterEdit = editor.body.toJSON()
    const undoLaterEdit = editor.history.undo(editor.view)
    const afterUndoLaterEdit = editor.body.toJSON()
    const secondFrom = afterMove.indexOf('second')
    editor.view.dispatch({
      changes: {
        from: secondFrom,
        to: secondFrom + 'second'.length,
        insert: 'Sxyznd',
      },
      annotations: Transaction.addToHistory.of(false),
    })
    const beforeFailedUndo = editor.body.toJSON()
    const failedUndo = editor.history.undo(editor.view).match(
      () => null,
      (error) => error.message,
    )
    const afterFailedUndo = editor.body.toJSON()
    const olderUndo = editor.history.undo(editor.view).match(
      (value) => value,
      () => false,
    )
    const redo = editor.history.redo(editor.view).match(
      (value) => value,
      () => false,
    )

    const readOutput = () => ({
      afterEdit,
      moveSucceeded: move.isOk(),
      afterMove,
      afterLaterEdit,
      undoLaterEdit: undoLaterEdit.isOk() && undoLaterEdit.value,
      afterUndoLaterEdit,
      beforeFailedUndo,
      failedUndo,
      afterFailedUndo,
      olderUndo,
      redo,
      finalText: editor.body.toJSON(),
      editor: editor.view.state.doc.toString(),
    })
    expect(readOutput()).toEqual({
      afterEdit: 'first typed\n\nsecond\n',
      moveSucceeded: true,
      afterMove: 'second\n\nfirst typed\n',
      afterLaterEdit: 'second\n\nfirst typed\n later',
      undoLaterEdit: true,
      afterUndoLaterEdit: 'second\n\nfirst typed\n',
      beforeFailedUndo: 'Sxyznd\n\nfirst typed\n',
      failedUndo:
        'The block can no longer be restored to its previous position',
      afterFailedUndo: 'Sxyznd\n\nfirst typed\n',
      olderUndo: false,
      redo: false,
      finalText: 'Sxyznd\n\nfirst typed\n',
      editor: 'Sxyznd\n\nfirst typed\n',
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

  it('keeps CodeMirror and Yjs aligned for seeded emoji moves and remote edits', () => {
    const initial =
      '# A\n\naaa aaa\n\n## A1\n\na1 a1\n\n# B\n\nbbb 😀 bbb\n\npara two\n\n# C\n\nccc\n'
    const seeds = [3386, 3668]
    const actual = seeds.map((seed) => {
      let randomState = seed * 9_973
      const random = (length: number) => {
        randomState = (randomState * 1_664_525 + 1_013_904_223) >>> 0
        return (randomState >>> 8) % length
      }
      const isSafeBoundary = (text: string, position: number) => {
        const before = text.charCodeAt(position - 1)
        const after = text.charCodeAt(position)
        return !(
          before >= 0xd800 &&
          before <= 0xdbff &&
          after >= 0xdc00 &&
          after <= 0xdfff
        )
      }
      const splitBoundaries: { event: string; from: number; to: number }[] = []
      const editor = createHistoryEditor(initial, (update) => {
        for (const transaction of update.transactions) {
          const event = transaction.annotation(Transaction.userEvent)
          if (event !== 'undo' && event !== 'redo') continue
          const before = transaction.startState.doc.toString()
          transaction.changes.iterChangedRanges((from, to) => {
            if (!isSafeBoundary(before, from) || !isSafeBoundary(before, to)) {
              splitBoundaries.push({ event, from, to })
            }
          })
        }
      })
      const peer = new Y.Doc()
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(editor.doc))
      const peerBody = peer.getText('body')
      const sync = () => {
        Y.applyUpdate(
          editor.doc,
          Y.encodeStateAsUpdate(peer, Y.encodeStateVector(editor.doc)),
        )
        Y.applyUpdate(
          peer,
          Y.encodeStateAsUpdate(editor.doc, Y.encodeStateVector(peer)),
        )
      }
      const characters = ['x', 'yy', '\n', '\n\n', '# H\n', '😀', ' ', '## ']
      let remoteCount = 0
      const remote = () => {
        const text = peerBody.toJSON()
        const position = random(text.length + 1)
        if (!isSafeBoundary(text, position)) return
        const character = 'QWERTYUIOPLKJHGFDSAZXCVBNM'[remoteCount % 26] ?? 'R'
        peer.transact(() => {
          peerBody.insert(position, character)
        })
        remoteCount += 1
        sync()
      }
      const local = (operation: number) => {
        const text = editor.body.toJSON()
        const kind = random(10)
        if (kind < 3) {
          const position = random(text.length + 1)
          if (!isSafeBoundary(text, position)) return
          const value = characters[random(characters.length)]
          if (value === undefined) return
          edit(
            editor,
            position,
            position,
            value,
            value.length === 0 ? 'delete.selection' : 'input.type',
            operation * 1_000 + 1_000,
          )
          return
        }
        if (kind < 5 && text.length > 0) {
          const from = random(text.length)
          const to = Math.min(from + 1 + random(12), text.length)
          if (!isSafeBoundary(text, from) || !isSafeBoundary(text, to)) return
          edit(
            editor,
            from,
            to,
            '',
            'delete.selection',
            operation * 1_000 + 1_000,
          )
          return
        }
        if (kind < 6 && text.length > 0) {
          const from = random(text.length)
          const to = Math.min(from + 1 + random(6), text.length)
          if (!isSafeBoundary(text, from) || !isSafeBoundary(text, to)) return
          const value = characters[random(characters.length)]
          if (value === undefined || text.slice(from, to) === value) return
          edit(
            editor,
            from,
            to,
            value,
            'input.replace',
            operation * 1_000 + 1_000,
          )
          return
        }
        const blocks = topLevelBlocks(text)
        if (blocks.length < 2) return
        const source = blocks[random(blocks.length)]
        const target = blocks[random(blocks.length)]
        if (!source || !target) return
        const destination = random(4) === 0 ? text.length : target.from
        editor.history.move({ from: source.from, destination }, editor.view)
      }

      for (let operation = 0; operation < 12; operation += 1) {
        if (random(3) === 0) remote()
        else local(operation)
      }

      const errors: { direction: string; error: string }[] = []
      const mismatches: { direction: string; body: string; editor: string }[] =
        []
      for (const direction of ['undo', 'redo'] as const) {
        for (let count = 0; count < 80; count += 1) {
          const result = editor.history[direction](editor.view)
          if (result.isErr()) {
            errors.push({ direction, error: result.error.message })
            continue
          }
          if (!result.value) break
          if (editor.view.state.doc.toString() !== editor.body.toJSON()) {
            mismatches.push({
              direction,
              body: editor.body.toJSON(),
              editor: editor.view.state.doc.toString(),
            })
            break
          }
        }
      }
      sync()
      const output = {
        seed,
        errors,
        mismatches,
        splitBoundaries,
        converged: peerBody.toJSON() === editor.body.toJSON(),
      }
      editor.view.destroy()
      editor.history.destroy()
      editor.doc.destroy()
      editor.host.remove()
      peer.destroy()
      return output
    })

    expect(actual).toEqual(
      seeds.map((seed) => ({
        seed,
        errors: [],
        mismatches: [],
        splitBoundaries: [],
        converged: true,
      })),
    )
  })

  it('maps remote edits at multiple history stages without losing their text', () => {
    const initial =
      '# A\n\nalpha 😀 alpha\n\n# B\n\nbeta paragraph\n\n    indented code\n\n# C\n\nthird paragraph\n'
    const seeds = Array.from({ length: 12 }, (_, index) => index + 1)
    const actual = seeds.map((seed) => {
      let randomState = seed
      const random = (length: number) => {
        randomState = (randomState * 1_664_525 + 1_013_904_223) >>> 0
        return (randomState >>> 8) % length
      }
      const editor = createHistoryEditor(initial)
      const peer = new Y.Doc()
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(editor.doc))
      const peerBody = peer.getText('body')
      const sync = () => {
        Y.applyUpdate(
          editor.doc,
          Y.encodeStateAsUpdate(peer, Y.encodeStateVector(editor.doc)),
        )
        Y.applyUpdate(
          peer,
          Y.encodeStateAsUpdate(editor.doc, Y.encodeStateVector(peer)),
        )
      }
      const remoteTokens: string[] = []
      const foundTokens = (text: string) =>
        remoteTokens.filter((token) => text.indexOf(token) >= 0)
      const remoteInsert = (position: number, label: string) => {
        const token = `R${String(seed)}${label}`
        remoteTokens.push(token)
        peer.transact(() => {
          peerBody.insert(position, token)
        })
        sync()
        return token
      }

      const alphaEnd = initial.indexOf('alpha') + 'alpha'.length
      edit(editor, alphaEnd, alphaEnd, ' local', 'input.type', 10_000)
      const afterEdit = editor.body.toJSON()
      const move = editor.history.move(
        {
          from: afterEdit.indexOf('# B'),
          destination: afterEdit.indexOf('# A'),
        },
        editor.view,
      )
      const afterMove = editor.body.toJSON()
      const firstRemotePosition =
        initial.indexOf('alpha') + random('alpha'.length + 1)
      const firstToken = remoteInsert(firstRemotePosition, 'a')
      const afterFirstRemote = editor.body.toJSON()
      const undoMove = editor.history.undo(editor.view)
      const afterUndo = editor.body.toJSON()
      sync()
      const tokensAfterUndoSync = foundTokens(editor.body.toJSON())
      const peerTokensAfterUndoSync = foundTokens(peerBody.toJSON())
      const matchesAfterUndoSync = peerBody.toJSON() === editor.body.toJSON()
      const secondRemotePosition =
        afterUndo.indexOf('local') + random('local'.length + 1)
      const secondToken = remoteInsert(secondRemotePosition, 'b')
      const afterSecondRemote = editor.body.toJSON()
      const redoMove = editor.history.redo(editor.view)
      const afterRedo = editor.body.toJSON()
      sync()
      const seamPosition = afterRedo.indexOf('# C')
      const seamToken = remoteInsert(seamPosition, 'c')
      const beforeFailedUndo = editor.body.toJSON()
      const failedUndo = editor.history.undo(editor.view).match(
        () => null,
        (error) => error.message,
      )
      const afterFailedUndo = editor.body.toJSON()
      const nextUndo = editor.history.undo(editor.view).match(
        (value) => value,
        () => false,
      )
      const nextRedo = editor.history.redo(editor.view).match(
        (value) => value,
        () => false,
      )
      const output = {
        seed,
        afterEdit,
        moveSucceeded: move.isOk(),
        afterMove,
        firstToken,
        tokensAfterFirstRemote: foundTokens(afterFirstRemote),
        undoMove: undoMove.match(
          (value) => ({ ok: true, value }),
          (error) => ({ ok: false, error: error.message }),
        ),
        tokensAfterUndo: foundTokens(afterUndo),
        tokensAfterUndoSync,
        peerTokensAfterUndoSync,
        matchesAfterUndoSync,
        secondToken,
        tokensAfterSecondRemote: foundTokens(afterSecondRemote),
        redoMove: redoMove.match(
          (value) => ({ ok: true, value }),
          (error) => ({ ok: false, error: error.message }),
        ),
        tokensAfterRedo: foundTokens(afterRedo),
        seamToken,
        foundTokensBeforeFailedUndo: foundTokens(beforeFailedUndo),
        failedUndo,
        foundTokensAfterFailedUndo: foundTokens(afterFailedUndo),
        stateUnchangedByFailedUndo: afterFailedUndo === beforeFailedUndo,
        nextUndo,
        nextRedo,
        peerMatches: peerBody.toJSON() === editor.body.toJSON(),
        editorMatches:
          editor.view.state.doc.toString() === editor.body.toJSON(),
      }
      peer.destroy()
      editor.view.destroy()
      editor.history.destroy()
      editor.doc.destroy()
      editor.host.remove()
      return output
    })

    expect(actual).toEqual(
      seeds.map((seed) => ({
        seed,
        afterEdit:
          '# A\n\nalpha local 😀 alpha\n\n# B\n\nbeta paragraph\n\n    indented code\n\n# C\n\nthird paragraph\n',
        moveSucceeded: true,
        afterMove:
          '# B\n\nbeta paragraph\n\n    indented code\n\n# A\n\nalpha local 😀 alpha\n\n# C\n\nthird paragraph\n',
        firstToken: `R${String(seed)}a`,
        tokensAfterFirstRemote: [`R${String(seed)}a`],
        undoMove: { ok: true, value: true },
        tokensAfterUndo: [`R${String(seed)}a`],
        tokensAfterUndoSync: [`R${String(seed)}a`],
        peerTokensAfterUndoSync: [`R${String(seed)}a`],
        matchesAfterUndoSync: true,
        secondToken: `R${String(seed)}b`,
        tokensAfterSecondRemote: [`R${String(seed)}a`, `R${String(seed)}b`],
        redoMove: { ok: true, value: true },
        tokensAfterRedo: [`R${String(seed)}a`, `R${String(seed)}b`],
        seamToken: `R${String(seed)}c`,
        foundTokensBeforeFailedUndo: [
          `R${String(seed)}a`,
          `R${String(seed)}b`,
          `R${String(seed)}c`,
        ],
        failedUndo: 'A remote change overlaps a moved block boundary',
        foundTokensAfterFailedUndo: [
          `R${String(seed)}a`,
          `R${String(seed)}b`,
          `R${String(seed)}c`,
        ],
        stateUnchangedByFailedUndo: true,
        nextUndo: false,
        nextRedo: false,
        peerMatches: true,
        editorMatches: true,
      })),
    )
  })

  it('restores seeded paragraph edits and moves exactly through undo and redo', () => {
    const initial =
      '# A\n\nalpha 😀 alpha\n\n## A1\n\nchild paragraph\n\n# B\n\nbeta paragraph\n\n    indented code\n\n# C\n\nlast paragraph\n'
    const seeds = Array.from({ length: 24 }, (_, index) => index + 1)
    const operationCount = 40
    const actual = seeds.map((seed) => {
      let randomState = seed
      const random = (length: number) => {
        randomState = (randomState * 1_664_525 + 1_013_904_223) >>> 0
        return (randomState >>> 8) % length
      }
      const safeBoundary = (text: string, position: number) => {
        const before = text.charCodeAt(position - 1)
        const after = text.charCodeAt(position)
        return !(
          before >= 0xd800 &&
          before <= 0xdbff &&
          after >= 0xdc00 &&
          after <= 0xdfff
        )
      }
      const editor = createHistoryEditor(initial)
      const insertions = ['x', 'yy', '\n', '\n\n', '# H\n\n', '😀', ' ']
      const undoStates = [initial]
      const redoStates: string[] = []
      const errors: { operation: number; message: string }[] = []
      const mismatches: {
        operation: number
        expected: string
        body: string
        editor: string
      }[] = []
      let expectedCurrent = initial
      let expectedLatest = initial

      const recordEdit = (before: string) => {
        const after = editor.body.toJSON()
        if (after === before) return
        undoStates.push(expectedCurrent)
        expectedCurrent = after
        expectedLatest = after
        redoStates.length = 0
      }

      for (let operation = 0; operation < operationCount; operation += 1) {
        const before = editor.body.toJSON()
        const choice = random(8)
        if (choice < 3) {
          const from = random(before.length + 1)
          const value = insertions[random(insertions.length)]
          if (value !== undefined && safeBoundary(before, from)) {
            edit(
              editor,
              from,
              from,
              value,
              'input.type',
              (operation + 1) * 1_000,
            )
            recordEdit(before)
          }
        } else if (choice < 5 && before.length > 0) {
          const from = random(before.length)
          const to = Math.min(from + 1 + random(14), before.length)
          if (safeBoundary(before, from) && safeBoundary(before, to)) {
            edit(
              editor,
              from,
              to,
              '',
              'delete.selection',
              (operation + 1) * 1_000,
            )
            recordEdit(before)
          }
        } else if (choice === 5) {
          const from = random(before.length + 1)
          if (safeBoundary(before, from)) {
            edit(
              editor,
              from,
              from,
              '\n\n',
              'input.type',
              (operation + 1) * 1_000,
            )
            recordEdit(before)
          }
        } else if (choice === 6) {
          const blocks = topLevelBlocks(before)
          const paragraphs = blocks.filter(
            (block) =>
              !before.slice(block.from, block.contentTo).startsWith('#'),
          )
          const source = paragraphs[random(paragraphs.length)]
          const target = paragraphs[random(paragraphs.length)]
          if (source && target && source.from !== target.from) {
            const move = editor.history.move(
              { from: source.from, destination: target.from },
              editor.view,
            )
            const after = editor.body.toJSON()
            if (move.isOk() && after !== before) {
              undoStates.push(expectedCurrent)
              expectedCurrent = after
              expectedLatest = after
              redoStates.length = 0
            }
          }
        } else if (random(2) === 0) {
          const result = editor.history.undo(editor.view)
          if (undoStates.length > 1) {
            const expected = undoStates.pop()
            redoStates.push(expectedCurrent)
            if (result.isErr())
              errors.push({ operation, message: result.error.message })
            else if (!result.value)
              errors.push({ operation, message: 'undo returned false' })
            else if (expected !== undefined) expectedCurrent = expected
          } else if (result.isErr() || result.value) {
            errors.push({
              operation,
              message: 'undo found an unexpected action',
            })
          }
        } else {
          const result = editor.history.redo(editor.view)
          if (redoStates.length > 0) {
            const expected = redoStates.pop()
            undoStates.push(expectedCurrent)
            if (result.isErr())
              errors.push({ operation, message: result.error.message })
            else if (!result.value)
              errors.push({ operation, message: 'redo returned false' })
            else if (expected !== undefined) expectedCurrent = expected
          } else if (result.isErr() || result.value) {
            errors.push({
              operation,
              message: 'redo found an unexpected action',
            })
          }
        }

        const body = editor.body.toJSON()
        const editorText = editor.view.state.doc.toString()
        if (body !== expectedCurrent || editorText !== expectedCurrent) {
          mismatches.push({
            operation,
            expected: expectedCurrent,
            body,
            editor: editorText,
          })
        }
      }

      for (let count = 0; count < operationCount; count += 1) {
        if (undoStates.length <= 1) break
        const expected = undoStates.pop()
        redoStates.push(expectedCurrent)
        const result = editor.history.undo(editor.view)
        if (result.isErr())
          errors.push({
            operation: operationCount,
            message: result.error.message,
          })
        else if (!result.value)
          errors.push({
            operation: operationCount,
            message: 'undo returned false',
          })
        else if (expected !== undefined) expectedCurrent = expected
        if (editor.body.toJSON() !== expectedCurrent) {
          mismatches.push({
            operation: operationCount,
            expected: expectedCurrent,
            body: editor.body.toJSON(),
            editor: editor.view.state.doc.toString(),
          })
        }
      }
      const afterUndo = editor.body.toJSON()
      for (let count = 0; count < operationCount; count += 1) {
        if (redoStates.length === 0) break
        const expected = redoStates.pop()
        undoStates.push(expectedCurrent)
        const result = editor.history.redo(editor.view)
        if (result.isErr())
          errors.push({
            operation: operationCount + 1,
            message: result.error.message,
          })
        else if (!result.value)
          errors.push({
            operation: operationCount + 1,
            message: 'redo returned false',
          })
        else if (expected !== undefined) expectedCurrent = expected
        if (editor.body.toJSON() !== expectedCurrent) {
          mismatches.push({
            operation: operationCount + 1,
            expected: expectedCurrent,
            body: editor.body.toJSON(),
            editor: editor.view.state.doc.toString(),
          })
        }
      }
      const output = {
        seed,
        errors,
        mismatches,
        undoRestoredStart: afterUndo === initial,
        redoRestoredLatest: editor.body.toJSON() === expectedLatest,
      }
      editor.view.destroy()
      editor.history.destroy()
      editor.doc.destroy()
      editor.host.remove()
      return output
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
})
