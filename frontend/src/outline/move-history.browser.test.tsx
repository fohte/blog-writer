import { EditorSelection } from '@codemirror/state'
import { afterEach, describe, expect, it } from 'vitest'

import { replaceBody } from '#editor/replace-body'
import {
  cleanupHistoryEditors,
  createHistoryEditor,
  edit,
  readSelection,
  step,
} from '#outline/move-history.test-support.test'

afterEach(cleanupHistoryEditors)

describe('MoveHistory text editing', () => {
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
})
