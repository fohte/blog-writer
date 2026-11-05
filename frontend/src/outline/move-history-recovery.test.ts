import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { getBody, setBody } from '#article/index'
import { createMoveHistory } from '#outline/index'

function setupHistory(initial: string) {
  const doc = new Y.Doc()
  setBody(doc, initial)
  const body = getBody(doc)
  const history = createMoveHistory(doc)
  return { doc, body, history }
}

describe('MoveHistory recovery', () => {
  it('resolves the moved block after a remote insertion before it', () => {
    const initial = ['first', '', 'second', '', 'third', ''].join('\n')
    const { doc, body, history } = setupHistory(initial)
    const moveSucceeded = history
      .move({
        from: initial.indexOf('second'),
        destination: body.length,
      })
      .isOk()
    const afterMove = body.toJSON()
    doc.transact(() => {
      body.insert(0, 'remote\n\n')
    }, 'remote')
    const afterRemoteInsert = body.toJSON()
    const undoResult = history.undo().match(
      (value) => value,
      () => false,
    )

    const readOutput = () => ({
      moveSucceeded,
      afterMove,
      afterRemoteInsert,
      undoResult,
      finalText: body.toJSON(),
    })
    expect(readOutput()).toEqual({
      moveSucceeded: true,
      afterMove: ['first', '', 'third', '', 'second', ''].join('\n'),
      afterRemoteInsert: [
        'remote',
        '',
        'first',
        '',
        'third',
        '',
        'second',
        '',
      ].join('\n'),
      undoResult: true,
      finalText: ['remote', '', 'first', '', 'second', '', 'third', ''].join(
        '\n',
      ),
    })

    history.destroy()
    doc.destroy()
  })

  it('drops an un-reversible move and continues to the older text edit', () => {
    const initial = ['first', '', 'second', ''].join('\n')
    const { doc, body, history } = setupHistory(initial)
    const errors: string[] = []
    history.onError((error) => {
      if (error) errors.push(error.message)
    })
    body.insert(initial.indexOf('first') + 'first'.length, ' typed')
    const moveSucceeded = history
      .move({
        from: body.toJSON().indexOf('second'),
        destination: 0,
      })
      .isOk()
    doc.transact(() => {
      body.insert(0, 'remote ')
    }, 'remote')
    const beforeUndo = body.toJSON()
    const failedUndo = history.undo().match(
      () => null,
      (error) => error.message,
    )
    const afterFailedUndo = body.toJSON()
    const olderUndo = history.undo().match(
      (value) => value,
      () => false,
    )

    const readOutput = () => ({
      moveSucceeded,
      beforeUndo,
      failedUndo,
      afterFailedUndo,
      olderUndo,
      finalText: body.toJSON(),
      errors,
    })
    expect(readOutput()).toEqual({
      moveSucceeded: true,
      beforeUndo: ['remote second', '', 'first typed', ''].join('\n'),
      failedUndo: 'The moved block has changed',
      afterFailedUndo: ['remote second', '', 'first typed', ''].join('\n'),
      olderUndo: true,
      finalText: ['remote second', '', 'first', ''].join('\n'),
      errors: ['The moved block has changed'],
    })

    history.destroy()
    doc.destroy()
  })

  it('continues past a text undo whose inserted text was removed remotely', () => {
    const initial = ['alpha', '', 'bravo', '', 'charlie', ''].join('\n')
    const { doc, body, history } = setupHistory(initial)
    history
      .move({
        from: body.toJSON().indexOf('alpha'),
        destination: body.length,
      })
      ._unsafeUnwrap()
    const typedAt = body.toJSON().indexOf('bravo') + 'bravo'.length
    body.insert(typedAt, ' typed')
    history
      .move({
        from: body.toJSON().indexOf('charlie'),
        destination: 0,
      })
      ._unsafeUnwrap()
    doc.transact(() => {
      const from = body.toJSON().indexOf(' typed')
      body.delete(from, ' typed'.length)
    }, 'remote')
    const afterRemoteDelete = body.toJSON()
    const undoResults = [
      history.undo().match(
        (value) => value,
        () => false,
      ),
      history.undo().match(
        (value) => value,
        () => false,
      ),
      history.undo().match(
        (value) => value,
        () => false,
      ),
    ]

    const readOutput = () => ({
      afterRemoteDelete,
      undoResults,
      finalText: body.toJSON(),
    })
    expect(readOutput()).toEqual({
      afterRemoteDelete: ['charlie', '', 'bravo', '', 'alpha', ''].join('\n'),
      undoResults: [true, false, true],
      finalText: initial,
    })

    history.destroy()
    doc.destroy()
  })

  it('clears a move redo when text is entered after undo', () => {
    const initial = ['alpha', '', 'beta', ''].join('\n')
    const { doc, body, history } = setupHistory(initial)
    history
      .move({
        from: body.toJSON().indexOf('beta'),
        destination: 0,
      })
      ._unsafeUnwrap()
    const afterMove = body.toJSON()
    const undoResult = history.undo()._unsafeUnwrap()
    history.undoManager.stopCapturing()
    body.insert(0, 'typed ')
    history.undoManager.stopCapturing()
    const redoResult = history.redo()._unsafeUnwrap()

    const readOutput = () => ({
      afterMove,
      undoResult,
      redoResult,
      finalText: body.toJSON(),
    })
    expect(readOutput()).toEqual({
      afterMove: ['beta', '', 'alpha', ''].join('\n'),
      undoResult: true,
      redoResult: false,
      finalText: ['typed alpha', '', 'beta', ''].join('\n'),
    })

    history.destroy()
    doc.destroy()
  })
})
