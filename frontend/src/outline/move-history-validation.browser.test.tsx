import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { getBody } from '#article/index'
import {
  cleanupHistoryEditors,
  createHistoryEditor,
  syncDocs,
} from '#outline/move-history.test-support.test'

const peers: Y.Doc[] = []

afterEach(() => {
  cleanupHistoryEditors()
  for (const peer of peers.splice(0)) peer.destroy()
})

describe('MoveHistory move validation', () => {
  it('undoes a local move around indented blocks without reparsing its range', () => {
    const initial = `a

      z

 indented

b
`
    const expectedAfterMove = [
      'a',
      '',
      ' '.repeat(5),
      '',
      '  z',
      '',
      'indented',
      '',
      'b',
      '',
    ].join('\n')
    const editor = createHistoryEditor(initial)
    const move = editor.history.move({ from: 7, destination: 13 }, editor.view)
    const afterMove = editor.body.toJSON()
    const undo = editor.history.undo(editor.view).match(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error: error.message }),
    )
    const afterUndo = editor.body.toJSON()
    const redo = editor.history.redo(editor.view).match(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error: error.message }),
    )

    const readOutput = () => ({
      moveSucceeded: move.isOk(),
      afterMove,
      undo,
      afterUndo,
      redo,
      afterRedo: editor.body.toJSON(),
    })
    expect(readOutput()).toEqual({
      moveSucceeded: true,
      afterMove: expectedAfterMove,
      undo: { ok: true, value: true },
      afterUndo: initial,
      redo: { ok: true, value: true },
      afterRedo: expectedAfterMove,
    })
  })

  it('validates a move history entry after a remote edit changes block structure', () => {
    const initial = `First.

Second.
`
    const editor = createHistoryEditor(initial)
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(editor.doc), 'remote')
    peers.push(peer)
    const move = editor.history.move(
      { from: initial.indexOf('Second'), destination: 0 },
      editor.view,
    )
    const afterMove = editor.body.toJSON()
    const peerBody = getBody(peer)
    const firstStart = peerBody.toJSON().indexOf('First.')
    peerBody.delete(firstStart, 'First.'.length)
    peerBody.insert(firstStart, '```')
    syncDocs(peer, editor.doc)
    const beforeUndo = editor.body.toJSON()
    const undo = editor.history.undo(editor.view).match(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error: error.message }),
    )
    const afterUndo = editor.body.toJSON()
    const redo = editor.history.redo(editor.view).match(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error: error.message }),
    )

    const readOutput = () => ({
      moveSucceeded: move.isOk(),
      afterMove,
      beforeUndo,
      undo,
      afterUndo,
      redo,
      editor: editor.view.state.doc.toString(),
      peer: getBody(peer).toJSON(),
    })
    expect(readOutput()).toEqual({
      moveSucceeded: true,
      afterMove: `Second.

First.
`,
      beforeUndo: `Second.

\`\`\`
`,
      undo: {
        ok: false,
        error: 'The block can no longer be restored to its previous position',
      },
      afterUndo: `Second.

\`\`\`
`,
      redo: { ok: true, value: false },
      editor: `Second.

\`\`\`
`,
      peer: `Second.

\`\`\`
`,
    })
  })
})
