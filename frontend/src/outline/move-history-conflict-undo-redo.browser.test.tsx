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

describe('MoveHistory conflict restoration', () => {
  it('keeps restored text reported through undo, redo, and undo after a boundary deletion', () => {
    const initial = `## Cedar
a1
## Fjord
maple maple
## Vista
z9
`
    const editor = createHistoryEditor(initial)
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(editor.doc), 'remote')
    peers.push(peer)
    observerStops.push(
      observeMoveConflicts(editor.doc),
      observeMoveConflicts(peer),
    )

    const removedFrom = initial.indexOf('a1')
    const removedTo = initial.indexOf('maple')
    edit(editor, removedFrom, removedTo, '', 'delete.selection')
    const afterDelete = editor.body.toJSON()

    const peerText = getBody(peer).toJSON()
    const peerMove = moveBlock(peer, {
      from: peerText.indexOf('## Fjord'),
      destination: peerText.length,
    })
    syncDocs(peer, editor.doc)
    const afterSync = editor.body.toJSON()
    const conflictsBeforeUndo = [editor.doc, peer].map((doc) =>
      getMoveConflicts(doc).map(({ text }) => text),
    )

    const firstUndo = editor.history.undo(editor.view)
    const afterFirstUndo = editor.body.toJSON()
    syncDocs(editor.doc, peer)
    const conflictsAfterFirstUndo = [editor.doc, peer].map((doc) =>
      getMoveConflicts(doc).map(({ text }) => text),
    )

    const redo = editor.history.redo(editor.view)
    const afterRedo = editor.body.toJSON()
    syncDocs(editor.doc, peer)
    const conflictsAfterRedo = [editor.doc, peer].map((doc) =>
      getMoveConflicts(doc).map(({ text }) => text),
    )

    const secondUndo = editor.history.undo(editor.view)
    const afterSecondUndo = editor.body.toJSON()
    syncDocs(editor.doc, peer)
    const conflictsAfterSecondUndo = [editor.doc, peer].map((doc) =>
      getMoveConflicts(doc).map(({ text }) => text),
    )

    const readOutput = () => ({
      afterDelete,
      peerMoveSucceeded: peerMove.isOk(),
      afterSync,
      conflictsBeforeUndo,
      firstUndo: firstUndo.match(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error: error.message }),
      ),
      afterFirstUndo,
      conflictsAfterFirstUndo,
      redo: redo.match(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error: error.message }),
      ),
      afterRedo,
      conflictsAfterRedo,
      secondUndo: secondUndo.match(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error: error.message }),
      ),
      afterSecondUndo,
      conflictsAfterSecondUndo,
    })
    expect(readOutput()).toEqual({
      afterDelete: `## Cedar
maple maple
## Vista
z9
`,
      peerMoveSucceeded: true,
      afterSync: `## Cedar
## Vista
z9

maple maple
`,
      conflictsBeforeUndo: [[], []],
      firstUndo: { ok: true, value: true },
      afterFirstUndo: `## Cedar
a1
## Fjord
## Vista
z9

maple maple
`,
      conflictsAfterFirstUndo: [['a1\n## Fjord\n'], ['a1\n## Fjord\n']],
      redo: { ok: true, value: true },
      afterRedo: `## Cedar
## Vista
z9

maple maple
`,
      conflictsAfterRedo: [[], []],
      secondUndo: { ok: true, value: true },
      afterSecondUndo: `## Cedar
a1
## Fjord
## Vista
z9

maple maple
`,
      conflictsAfterSecondUndo: [['a1\n## Fjord\n'], ['a1\n## Fjord\n']],
    })
  })
})
