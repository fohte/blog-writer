import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { getBody, setBody, topLevelBlocks } from '#article/index'
import { createMoveHistory } from '#outline/index'

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

  it('undoes and redoes a replacement edit around a later move', () => {
    const initial = '# Alpha\n\nFirst section.\n\n# Beta\n\nSecond section.\n'
    const doc = new Y.Doc()
    setBody(doc, initial)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const replacementFrom = initial.indexOf('Second')
    doc.transact(() => {
      body.delete(replacementFrom, 'Second'.length)
      body.insert(replacementFrom, 'Third')
    })
    const afterReplacement = body.toJSON()
    history
      .move({
        from: afterReplacement.indexOf('# Beta'),
        destination: 0,
      })
      ._unsafeUnwrap()
    const afterMove = body.toJSON()

    history.undo()._unsafeUnwrap()
    const afterUndoMove = body.toJSON()
    history.undo()._unsafeUnwrap()
    const afterUndoReplacement = body.toJSON()
    history.redo()._unsafeUnwrap()
    const afterRedoReplacement = body.toJSON()
    history.redo()._unsafeUnwrap()
    const afterRedoMove = body.toJSON()

    const readOutput = () => ({
      afterReplacement,
      afterMove,
      afterUndoMove,
      afterUndoReplacement,
      afterRedoReplacement,
      afterRedoMove,
    })
    expect(readOutput()).toEqual({
      afterReplacement:
        '# Alpha\n\nFirst section.\n\n# Beta\n\nThird section.\n',
      afterMove: '# Beta\n\nThird section.\n\n# Alpha\n\nFirst section.\n',
      afterUndoMove: '# Alpha\n\nFirst section.\n\n# Beta\n\nThird section.\n',
      afterUndoReplacement: initial,
      afterRedoReplacement:
        '# Alpha\n\nFirst section.\n\n# Beta\n\nThird section.\n',
      afterRedoMove: '# Beta\n\nThird section.\n\n# Alpha\n\nFirst section.\n',
    })

    history.destroy()
    doc.destroy()
  })

  it('undoes text typed before moving the same section twice', () => {
    const initial = '# A\n\na\n\n# B\n\nb\n\n# C\n\nc\n'
    const doc = new Y.Doc()
    setBody(doc, initial)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const errors: string[] = []
    history.onError((error) => {
      if (error) errors.push(error.message)
    })
    body.insert(initial.indexOf('a\n\n# B'), 'TYPED ')
    const afterEdit = body.toJSON()

    const moveA = (destination: number) =>
      history.move({
        from: body.toJSON().indexOf('# A'),
        destination,
      })
    const firstMove = moveA(body.toJSON().indexOf('# C'))
    const afterFirstMove = body.toJSON()
    const secondMove = moveA(body.length)
    const afterSecondMove = body.toJSON()
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
      afterEdit,
      firstMoveSucceeded: firstMove.isOk(),
      afterFirstMove,
      secondMoveSucceeded: secondMove.isOk(),
      afterSecondMove,
      undoResults,
      errors,
      finalText: body.toJSON(),
    })
    expect(readOutput()).toEqual({
      afterEdit: '# A\n\nTYPED a\n\n# B\n\nb\n\n# C\n\nc\n',
      firstMoveSucceeded: true,
      afterFirstMove: '# B\n\nb\n\n# A\n\nTYPED a\n\n# C\n\nc\n',
      secondMoveSucceeded: true,
      afterSecondMove: '# B\n\nb\n\n# C\n\nc\n\n# A\n\nTYPED a\n',
      undoResults: [true, true, true],
      errors: [],
      finalText: initial,
    })

    history.destroy()
    doc.destroy()
  })

  it('restores replaced text after moving its section', () => {
    const initial = '# Alpha\n\nbefore target after\n\n# Beta\n\nsecond\n'
    const doc = new Y.Doc()
    setBody(doc, initial)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const targetFrom = initial.indexOf('target')

    history.undoManager.stopCapturing()
    doc.transact(() => {
      body.delete(targetFrom, 'target'.length)
      body.insert(targetFrom, 'replacement')
    })
    history.undoManager.stopCapturing()
    const afterReplacement = body.toJSON()
    const move = history.move({
      from: body.toJSON().indexOf('# Alpha'),
      destination: body.length,
    })
    const afterMove = body.toJSON()
    const undoResults = [
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
      afterReplacement,
      moveSucceeded: move.isOk(),
      afterMove,
      undoResults,
      finalText: body.toJSON(),
    })
    expect(readOutput()).toEqual({
      afterReplacement:
        '# Alpha\n\nbefore replacement after\n\n# Beta\n\nsecond\n',
      moveSucceeded: true,
      afterMove: '# Beta\n\nsecond\n\n# Alpha\n\nbefore replacement after\n',
      undoResults: [true, true],
      finalText: initial,
    })

    history.destroy()
    doc.destroy()
  })

  it('restores a moved section to its original place after another section moves', () => {
    const initial = '# A\n\naaa\n\n## A1\n\nx\n\n# B\n\nb\n\n# C\n\nc\n'
    const doc = new Y.Doc()
    setBody(doc, initial)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const firstMove = history.move({
      from: body.toJSON().indexOf('aaa'),
      destination: body.toJSON().indexOf('# C'),
    })
    const afterFirstMove = body.toJSON()
    const secondMove = history.move({
      from: body.toJSON().indexOf('# A'),
      destination: body.length,
    })
    const afterSecondMove = body.toJSON()
    const undoResults = [
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
      firstMoveSucceeded: firstMove.isOk(),
      afterFirstMove,
      secondMoveSucceeded: secondMove.isOk(),
      afterSecondMove,
      undoResults,
      finalText: body.toJSON(),
    })
    expect(readOutput()).toEqual({
      firstMoveSucceeded: true,
      afterFirstMove: '# A\n\n## A1\n\nx\n\n# B\n\nb\n\naaa\n\n# C\n\nc\n',
      secondMoveSucceeded: true,
      afterSecondMove: '# B\n\nb\n\naaa\n\n# C\n\nc\n\n# A\n\n## A1\n\nx\n',
      undoResults: [true, true],
      finalText: initial,
    })

    history.destroy()
    doc.destroy()
  })

  it('restores deleted text in its original section after moving that section', () => {
    const initial =
      '# A\n\nkeep\n\n## A1\n\ndeleted para\n\n# B\n\nb\n\n# C\n\nc\n'
    const doc = new Y.Doc()
    setBody(doc, initial)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const deletedFrom = body.toJSON().indexOf('deleted para')
    body.delete(deletedFrom, 'deleted para'.length)
    const afterDelete = body.toJSON()
    const move = history.move({
      from: body.toJSON().indexOf('# A'),
      destination: body.length,
    })
    const afterMove = body.toJSON()
    const undoResults = [
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
      afterDelete,
      moveSucceeded: move.isOk(),
      afterMove,
      undoResults,
      finalText: body.toJSON(),
    })
    expect(readOutput()).toEqual({
      afterDelete: '# A\n\nkeep\n\n## A1\n\n\n\n# B\n\nb\n\n# C\n\nc\n',
      moveSucceeded: true,
      afterMove: '# B\n\nb\n\n# C\n\nc\n\n# A\n\nkeep\n\n## A1\n',
      undoResults: [true, true],
      finalText: initial,
    })

    history.destroy()
    doc.destroy()
  })

  it('restores the exact starting text after seeded mixed edits and moves', () => {
    const initial = 'alpha\n\nbravo\n\ncharlie\n\ndelta\n\necho\n'
    const seeds = Array.from({ length: 128 }, (_, index) => index + 1)
    const operationCount = 24
    const actual = seeds.map((seed) => {
      let randomState = seed
      const nextRandom = () => {
        randomState = (randomState * 1_664_525 + 1_013_904_223) >>> 0
        return randomState
      }
      const doc = new Y.Doc()
      setBody(doc, initial)
      const body = getBody(doc)
      const history = createMoveHistory(doc)
      let moveErrors = 0
      const errors: string[] = []
      let historyEntries = 0
      history.onError((error) => {
        if (error) errors.push(error.message)
      })

      for (let index = 0; index < operationCount; index += 1) {
        const markdown = body.toJSON()
        const blocks = topLevelBlocks(markdown)
        if (nextRandom() % 3 === 0) {
          const block = blocks[nextRandom() % blocks.length]
          if (block) {
            history.undoManager.stopCapturing()
            body.insert(block.contentTo, 'x')
            history.undoManager.stopCapturing()
            historyEntries += 1
          }
          continue
        }

        const fromIndex = nextRandom() % blocks.length
        const targetOffset = nextRandom() % (blocks.length - 1)
        const targetIndex =
          targetOffset >= fromIndex ? targetOffset + 1 : targetOffset
        const from = blocks[fromIndex]
        const target = blocks[targetIndex]
        if (!from || !target) continue
        const destination = fromIndex < targetIndex ? target.to : target.from
        if (history.move({ from: from.from, destination }).isErr()) {
          moveErrors += 1
        } else {
          historyEntries += 1
        }
      }

      const undoResults = Array.from({ length: historyEntries }, () =>
        history.undo().match(
          (value) => value,
          () => false,
        ),
      )
      const result = {
        seed,
        moveErrors,
        errors,
        undoResults,
        finalText: body.toJSON(),
      }
      history.destroy()
      doc.destroy()
      return result
    })

    expect(actual).toEqual(
      seeds.map((seed) => ({
        seed,
        moveErrors: 0,
        errors: [],
        undoResults: Array.from({ length: operationCount }, () => true),
        finalText: initial,
      })),
    )
  })
})
