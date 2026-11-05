import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { getBody, setBody } from '#article/index'
import { createMoveHistory } from '#outline/move-history'

describe('MoveHistory', () => {
  it('undoes and redoes text edits and moves in reverse chronological order', () => {
    const initial = '# Alpha\n\nFirst section.\n\n# Beta\n\nSecond section.\n'
    const doc = new Y.Doc()
    setBody(doc, initial)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const beta = initial.indexOf('Beta')

    body.insert(beta + 'Beta'.length, '!')
    const beforeMove = body.toJSON()
    const move = history.move({
      from: beforeMove.indexOf('# Beta'),
      destination: 0,
    })
    const afterMove = body.toJSON()
    body.insert(body.length, ' Draft.')
    const afterSecondEdit = body.toJSON()

    history.undo()._unsafeUnwrap()
    const afterUndoSecondEdit = body.toJSON()
    history.undo()._unsafeUnwrap()
    const afterUndoMove = body.toJSON()
    history.undo()._unsafeUnwrap()
    const afterUndoFirstEdit = body.toJSON()

    history.redo()._unsafeUnwrap()
    const afterRedoFirstEdit = body.toJSON()
    history.redo()._unsafeUnwrap()
    const afterRedoMove = body.toJSON()
    history.redo()._unsafeUnwrap()
    const afterRedoSecondEdit = body.toJSON()

    const readOutput = () => ({
      moveSucceeded: move.isOk(),
      beforeMove,
      afterMove,
      afterSecondEdit,
      afterUndoSecondEdit,
      afterUndoMove,
      afterUndoFirstEdit,
      afterRedoFirstEdit,
      afterRedoMove,
      afterRedoSecondEdit,
    })
    expect(readOutput()).toEqual({
      moveSucceeded: true,
      beforeMove: '# Alpha\n\nFirst section.\n\n# Beta!\n\nSecond section.\n',
      afterMove: '# Beta!\n\nSecond section.\n\n# Alpha\n\nFirst section.\n',
      afterSecondEdit:
        '# Beta!\n\nSecond section.\n\n# Alpha\n\nFirst section.\n Draft.',
      afterUndoSecondEdit:
        '# Beta!\n\nSecond section.\n\n# Alpha\n\nFirst section.\n',
      afterUndoMove:
        '# Alpha\n\nFirst section.\n\n# Beta!\n\nSecond section.\n',
      afterUndoFirstEdit:
        '# Alpha\n\nFirst section.\n\n# Beta\n\nSecond section.\n',
      afterRedoFirstEdit:
        '# Alpha\n\nFirst section.\n\n# Beta!\n\nSecond section.\n',
      afterRedoMove:
        '# Beta!\n\nSecond section.\n\n# Alpha\n\nFirst section.\n',
      afterRedoSecondEdit:
        '# Beta!\n\nSecond section.\n\n# Alpha\n\nFirst section.\n Draft.',
    })

    history.destroy()
    doc.destroy()
  })

  it('restores a deleted character after undoing a later move', () => {
    const initial = '# Alpha\n\nFirst section.\n\n# Beta\n\nSecond section.\n'
    const doc = new Y.Doc()
    setBody(doc, initial)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const deletedCharacter = initial.indexOf('Second')

    body.delete(deletedCharacter, 1)
    const afterEdit = body.toJSON()
    history
      .move({
        from: afterEdit.indexOf('# Beta'),
        destination: 0,
      })
      ._unsafeUnwrap()
    const afterMove = body.toJSON()

    history.undo()._unsafeUnwrap()
    const afterUndoMove = body.toJSON()
    history.undo()._unsafeUnwrap()
    const afterUndoEdit = body.toJSON()
    history.redo()._unsafeUnwrap()
    const afterRedoEdit = body.toJSON()
    history.redo()._unsafeUnwrap()
    const afterRedoMove = body.toJSON()

    const readOutput = () => ({
      afterEdit,
      afterMove,
      afterUndoMove,
      afterUndoEdit,
      afterRedoEdit,
      afterRedoMove,
    })
    expect(readOutput()).toEqual({
      afterEdit: '# Alpha\n\nFirst section.\n\n# Beta\n\necond section.\n',
      afterMove: '# Beta\n\necond section.\n\n# Alpha\n\nFirst section.\n',
      afterUndoMove: '# Alpha\n\nFirst section.\n\n# Beta\n\necond section.\n',
      afterUndoEdit: initial,
      afterRedoEdit: '# Alpha\n\nFirst section.\n\n# Beta\n\necond section.\n',
      afterRedoMove: '# Beta\n\necond section.\n\n# Alpha\n\nFirst section.\n',
    })

    history.destroy()
    doc.destroy()
  })
})
