import { afterEach, describe, expect, it } from 'vitest'

import { addMemo, setMemoAdoptedTo } from '#article/index'
import {
  cleanupHistoryEditors,
  createHistoryEditor,
  edit,
  readMemoStates,
  step,
} from '#outline/move-history.test-support.test'

afterEach(cleanupHistoryEditors)

describe('MoveHistory local operations', () => {
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

  it('undoes and redoes a paragraph move without changing its text', () => {
    const initial =
      'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n'
    const editor = createHistoryEditor(initial)
    const move = editor.history.move(
      { from: 0, destination: initial.length },
      editor.view,
    )
    const afterMove = editor.body.toJSON()
    const undo = step(editor, 'undo')
    const afterUndo = editor.body.toJSON()
    const redo = step(editor, 'redo')
    const afterRedo = editor.body.toJSON()
    const secondUndo = step(editor, 'undo')
    const afterSecondUndo = editor.body.toJSON()

    const readOutput = () => ({
      moveSucceeded: move.isOk(),
      afterMove,
      undo,
      afterUndo,
      redo,
      afterRedo,
      secondUndo,
      afterSecondUndo,
      editor: editor.view.state.doc.toString(),
    })
    expect(readOutput()).toEqual({
      moveSucceeded: true,
      afterMove: 'Second paragraph.\n\nThird paragraph.\n\nFirst paragraph.\n',
      undo: true,
      afterUndo: initial,
      redo: true,
      afterRedo: 'Second paragraph.\n\nThird paragraph.\n\nFirst paragraph.\n',
      secondUndo: true,
      afterSecondUndo: initial,
      editor: initial,
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
})
