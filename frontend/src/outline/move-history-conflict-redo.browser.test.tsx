import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { getBody, getMoveConflicts, moveBlock } from '#article/index'
import { observeMoveConflicts } from '#article/move-conflicts'
import {
  cleanupHistoryEditors,
  createHistoryEditor,
  edit,
  syncDocs,
} from '#outline/move-history.test-support.test'

const peers: Y.Doc[] = []
const observerStops: (() => void)[] = []

afterEach(() => {
  for (const stop of observerStops.splice(0)) stop()
  cleanupHistoryEditors()
  for (const peer of peers.splice(0)) peer.destroy()
})

describe('MoveHistory conflict restoration on redo', () => {
  it('reports only redone text restored at the old section location', () => {
    const initial = `# Cedar

cedar text

# Fjord

fjord text

# Vista

vista text
`
    const editor = createHistoryEditor(initial)
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(editor.doc), 'remote')
    peers.push(peer)
    observerStops.push(
      observeMoveConflicts(editor.doc),
      observeMoveConflicts(peer),
    )

    const insertionAt = initial.indexOf('cedar text')
    edit(editor, insertionAt, insertionAt, 'XYZ', 'input.type', 10_000)
    const afterTyping = editor.body.toJSON()
    const undo = editor.history.undo(editor.view)
    const afterUndo = editor.body.toJSON()
    syncDocs(editor.doc, peer)

    const peerText = getBody(peer).toJSON()
    const peerMove = moveBlock(peer, {
      from: peerText.indexOf('# Cedar'),
      destination: peerText.length,
    })
    const afterPeerMove = getBody(peer).toJSON()
    syncDocs(editor.doc, peer)

    const redo = editor.history.redo(editor.view)
    const afterRedo = editor.body.toJSON()
    syncDocs(editor.doc, peer)
    const readOutput = () => ({
      afterTyping,
      undo: undo.isOk() && undo.value,
      afterUndo,
      peerMoveSucceeded: peerMove.isOk(),
      afterPeerMove,
      redo: redo.isOk() && redo.value,
      afterRedo,
      bodies: [editor.body.toJSON(), getBody(peer).toJSON()],
      conflicts: [editor.doc, peer].map((doc) =>
        getMoveConflicts(doc).map(({ text }) => text),
      ),
    })
    expect(readOutput()).toEqual({
      afterTyping: `# Cedar

XYZcedar text

# Fjord

fjord text

# Vista

vista text
`,
      undo: true,
      afterUndo: initial,
      peerMoveSucceeded: true,
      afterPeerMove: `# Fjord

fjord text

# Vista

vista text

# Cedar

cedar text
`,
      redo: true,
      afterRedo: `XYZ# Fjord

fjord text

# Vista

vista text

# Cedar

cedar text
`,
      bodies: [
        `XYZ# Fjord

fjord text

# Vista

vista text

# Cedar

cedar text
`,
        `XYZ# Fjord

fjord text

# Vista

vista text

# Cedar

cedar text
`,
      ],
      conflicts: [['XYZ'], ['XYZ']],
    })
  })
})
