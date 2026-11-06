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
    const initial = `first

second

third
`
    const editor = createHistoryEditor(initial)
    const move = editor.history.move(
      { from: initial.indexOf('second'), destination: editor.body.length },
      editor.view,
    )
    const afterMove = editor.body.toJSON()
    editor.doc.transact(() => {
      editor.body.insert(
        0,
        `remote

`,
      )
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
      afterMove: `first

third

second
`,
      afterRemoteInsert: `remote

first

third

second
`,
      undoSucceeded: true,
      body: `remote

first

second

third
`,
      editor: `remote

first

second

third
`,
    })
  })

  it('undoes a move with a remote edit inside the moved block', () => {
    const initial = `first

second
`
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
      afterEdit: `first typed

second
`,
      moveSucceeded: true,
      beforeUndo: `sremote econd

first typed
`,
      moveUndo: true,
      afterMoveUndo: `first typed

sremote econd
`,
      afterRemoteWhileRedo: `first peer typed

sremote econd
`,
      moveRedo: true,
      afterMoveRedo: `sremote econd

first peer typed
`,
      secondMoveUndo: true,
      afterSecondMoveUndo: `first peer typed

sremote econd
`,
      olderUndo: true,
      finalText: `first peer

sremote econd
`,
      errors: [],
    })
  })

  it('drops older history after a remote edit crosses a move seam', () => {
    const initial = `first

second
`
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
      afterEdit: `first typed

second
`,
      moveSucceeded: true,
      movedSecond: `second

first typed
`,
      beforeUndo: `second

first typed
remote `,
      failedUndo: 'A remote change overlaps a moved block boundary',
      afterFailedUndo: `second

first typed
remote `,
      olderUndo: false,
      redo: false,
      finalText: `second

first typed
remote `,
    })
  })

  it('drops history when a remote edit changes a moved separator', () => {
    const initial = `First paragraph.

Second paragraph.
`
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
      afterEdit: `Local First paragraph.

Second paragraph.
`,
      afterMove: `Second paragraph.

Local First paragraph.
`,
      separatorPosition: 18,
      afterRemoteDelete: `Second paragraph.
Local First paragraph.
`,
      failedUndo: 'A remote change overlaps a moved separator',
      afterFailedUndo: `Second paragraph.
Local First paragraph.
`,
      olderUndo: false,
      redo: false,
    })
  })

  it('clears both stacks after a move can no longer be reversed', () => {
    const initial = `first

second
`
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
      afterEdit: `first typed

second
`,
      moveSucceeded: true,
      afterMove: `second

first typed
`,
      afterLaterEdit: `second

first typed
 later`,
      undoLaterEdit: true,
      afterUndoLaterEdit: `second

first typed
`,
      beforeFailedUndo: `Sxyznd

first typed
`,
      failedUndo:
        'The block can no longer be restored to its previous position',
      afterFailedUndo: `Sxyznd

first typed
`,
      olderUndo: false,
      redo: false,
      finalText: `Sxyznd

first typed
`,
      editor: `Sxyznd

first typed
`,
    })
  })

  it('continues past a text undo invalidated by a remote deletion', () => {
    const initial = `alpha

bravo

charlie
`
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
      afterAlphaMove: `bravo

charlie

alpha
`,
      afterEdit: `bravo typed

charlie

alpha
`,
      charlieMoveSucceeded: true,
      afterCharlieMove: `charlie

bravo typed

alpha
`,
      afterRemoteDelete: `charlie

bravo

alpha
`,
      undoResults: [true, true, false],
      finalText: initial,
      editor: initial,
    })
  })

  it('clears move redo after a new text edit', () => {
    const initial = `alpha

beta
`
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
      afterMove: `beta

alpha
`,
      undoSucceeded: true,
      afterUndo: initial,
      afterEdit: `typed alpha

beta
`,
      redoAvailable: false,
      finalText: `typed alpha

beta
`,
      editor: `typed alpha

beta
`,
    })
  })

  it('restores the first moved heading section after another section moves', () => {
    const initial = `# A

aaa

## A1

x

# B

b

# C

c
`
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
      afterFirstMove: `# A

## A1

x

# B

b

aaa

# C

c
`,
      secondMoveSucceeded: true,
      afterSecondMove: `# B

b

aaa

# C

c

# A

## A1

x
`,
      undoResults: [true, true],
      finalText: initial,
      editor: initial,
    })
  })

  it('restores deleted text in its original section after moving that section', () => {
    const initial = `# A

keep

## A1

deleted para

# B

b

# C

c
`
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
      afterDelete: `# A

keep

## A1



# B

b

# C

c
`,
      moveSucceeded: true,
      afterMove: `# B

b

# C

c

# A

keep

## A1
`,
      undoResults: [true, true],
      finalText: initial,
      editor: initial,
    })
  })
})
