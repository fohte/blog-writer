import { Transaction } from '@codemirror/state'
import { afterEach, describe, expect, it } from 'vitest'

import {
  cleanupHistoryEditors,
  createHistoryEditor,
  edit,
  step,
} from '#outline/move-history.test-support.test'

afterEach(cleanupHistoryEditors)

describe('MoveHistory remote operations', () => {
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
    const peerInsertion = editor.body.toJSON().indexOf('first') + 'first'.length
    editor.doc.transact(() => {
      editor.body.insert(peerInsertion, ' peer')
    }, 'remote')
    const afterRemoteWhileRedo = editor.body.toJSON()
    const moveRedo = editor.history.redo(editor.view).match(
      (value) => value,
      () => false,
    )
    const afterMoveRedo = editor.body.toJSON()
    const secondMoveUndo = editor.history.undo(editor.view).match(
      (value) => value,
      () => false,
    )
    const afterSecondMoveUndo = editor.body.toJSON()
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
      afterRemoteWhileRedo,
      moveRedo,
      afterMoveRedo,
      secondMoveUndo,
      afterSecondMoveUndo,
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
      afterRemoteWhileRedo: 'first peer typed\n\nsremote econd\n',
      moveRedo: true,
      afterMoveRedo: 'sremote econd\n\nfirst peer typed\n',
      secondMoveUndo: true,
      afterSecondMoveUndo: 'first peer typed\n\nsremote econd\n',
      olderUndo: true,
      finalText: 'first peer\n\nsremote econd\n',
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
})
