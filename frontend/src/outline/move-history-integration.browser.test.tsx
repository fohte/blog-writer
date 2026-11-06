import { EditorSelection } from '@codemirror/state'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { getBody, getMoveConflicts, moveBlock } from '#article/index'
import { observeMoveConflicts } from '#article/move-conflicts'
import {
  cleanupHistoryEditors,
  createHistoryEditor,
  edit,
  readSelection,
  step,
} from '#outline/move-history.test-support.test'

const peers: Y.Doc[] = []
const observerStops: (() => void)[] = []

afterEach(() => {
  for (const stop of observerStops.splice(0)) stop()
  cleanupHistoryEditors()
  for (const peer of peers.splice(0)) peer.destroy()
})

function replicate(source: Y.Doc): Y.Doc {
  const peer = new Y.Doc()
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(source), 'remote')
  peers.push(peer)
  return peer
}

function applyMissingUpdate(source: Y.Doc, destination: Y.Doc): void {
  Y.applyUpdate(
    destination,
    Y.encodeStateAsUpdate(source, Y.encodeStateVector(destination)),
    'remote',
  )
}

describe('MoveHistory integration', () => {
  it('records text restored by undo for move conflict detection', () => {
    const initial = `## Cedar
a1
## Fjord
maple maple
## Vista
z9
`
    const editor = createHistoryEditor(initial)
    const peer = replicate(editor.doc)
    observerStops.push(
      observeMoveConflicts(editor.doc),
      observeMoveConflicts(peer),
    )
    const removedFrom = initial.lastIndexOf('ple')
    edit(editor, removedFrom, removedFrom + 3, '', 'delete.selection')

    const peerBody = getBody(peer)
    const peerText = peerBody.toJSON()
    moveBlock(peer, {
      from: peerText.indexOf('## Fjord'),
      destination: peerText.length,
    })._unsafeUnwrap()
    applyMissingUpdate(peer, editor.doc)

    const conflictsBeforeUndo = getMoveConflicts(editor.doc).map(
      ({ from, to, text, target }) => ({ from, to, text, target }),
    )
    const undo = editor.history.undo(editor.view).match(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error: error.message }),
    )
    const bodyAfterUndo = editor.body.toJSON()
    const editorAfterUndo = editor.view.state.doc.toString()
    applyMissingUpdate(editor.doc, peer)
    const conflictsAfterUndo = [editor.doc, peer].map((doc) =>
      getMoveConflicts(doc).map(({ from, to, text, target }) => ({
        from,
        to,
        text,
        target,
      })),
    )

    const readOutput = () => ({
      conflictsBeforeUndo,
      undo,
      bodyAfterUndo,
      editorAfterUndo,
      conflictsAfterUndo,
    })
    expect(readOutput()).toEqual({
      conflictsBeforeUndo: [],
      undo: { ok: true, value: true },
      bodyAfterUndo: `## Cedar
a1
ple## Vista
z9

## Fjord
maple ma
`,
      editorAfterUndo: `## Cedar
a1
ple## Vista
z9

## Fjord
maple ma
`,
      conflictsAfterUndo: [
        [{ from: 12, to: 15, text: 'ple', target: 46 }],
        [{ from: 12, to: 15, text: 'ple', target: 46 }],
      ],
    })
  })

  it('records text restored by move undo for move conflict detection', () => {
    const initial = `## Cedar
a1
## Fjord
maple maple
## Vista
z9
`
    const editor = createHistoryEditor(initial)
    const peer = replicate(editor.doc)
    observerStops.push(
      observeMoveConflicts(editor.doc),
      observeMoveConflicts(peer),
    )
    const editorMove = editor.history.move(
      { from: initial.indexOf('## Fjord'), destination: initial.length },
      editor.view,
    )
    const peerBody = getBody(peer)
    const peerText = peerBody.toJSON()
    const peerMove = moveBlock(peer, {
      from: peerText.indexOf('## Fjord'),
      destination: 0,
    })
    applyMissingUpdate(peer, editor.doc)
    applyMissingUpdate(editor.doc, peer)

    const conflictsBeforeUndo = [editor.doc, peer].map((doc) =>
      getMoveConflicts(doc).map(({ from, to, text, target }) => ({
        from,
        to,
        text,
        target,
      })),
    )
    const undo = editor.history.undo(editor.view).match(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error: error.message }),
    )
    applyMissingUpdate(editor.doc, peer)
    applyMissingUpdate(peer, editor.doc)
    const conflictsAfterUndo = [editor.doc, peer].map((doc) =>
      getMoveConflicts(doc).map(({ from, to, text, target }) => ({
        from,
        to,
        text,
        target,
      })),
    )
    const readOutput = () => ({
      editorMoveSucceeded: editorMove.isOk(),
      peerMoveSucceeded: peerMove.isOk(),
      conflictsBeforeUndo,
      undo,
      editorBody: editor.body.toJSON(),
      peerBody: getBody(peer).toJSON(),
      conflictsAfterUndo,
    })
    expect(readOutput()).toEqual({
      editorMoveSucceeded: true,
      peerMoveSucceeded: true,
      conflictsBeforeUndo: [[], []],
      undo: { ok: true, value: true },
      editorBody: `## Fjord
maple maple

## Cedar
a1
## Fjord
maple maple
## Vista
z9
`,
      peerBody: `## Fjord
maple maple

## Cedar
a1
## Fjord
maple maple
## Vista
z9
`,
      conflictsAfterUndo: [
        [
          {
            from: 34,
            to: 55,
            text: `## Fjord
maple maple
`,
            target: 21,
          },
        ],
        [
          {
            from: 34,
            to: 55,
            text: `## Fjord
maple maple
`,
            target: 21,
          },
        ],
      ],
    })
  })

  it('maps saved selections through a remote insertion before undo and redo', () => {
    const initial = `prefix target suffix
`
    const editor = createHistoryEditor(initial)
    const peer = replicate(editor.doc)
    const targetFrom = initial.indexOf('target')
    editor.view.dispatch({
      selection: EditorSelection.range(
        targetFrom,
        targetFrom + 'target'.length,
      ),
    })
    const selectionBeforeEdit = readSelection(editor.view.state.selection)
    const localInsert = initial.length - 1
    edit(editor, localInsert, localInsert, ' local', 'input.type', 10_000)
    const afterLocalEdit = editor.body.toJSON()

    getBody(peer).insert(0, 'remote ')
    applyMissingUpdate(peer, editor.doc)
    const afterRemoteInsert = editor.body.toJSON()
    const selectionAfterRemote = readSelection(editor.view.state.selection)
    const undo = step(editor, 'undo')
    const afterUndo = editor.body.toJSON()
    const selectionAfterUndo = readSelection(editor.view.state.selection)
    const redo = step(editor, 'redo')
    const afterRedo = editor.body.toJSON()
    const selectionAfterRedo = readSelection(editor.view.state.selection)

    const readOutput = () => ({
      selectionBeforeEdit,
      afterLocalEdit,
      afterRemoteInsert,
      selectionAfterRemote,
      undo,
      afterUndo,
      selectionAfterUndo,
      redo,
      afterRedo,
      selectionAfterRedo,
    })
    expect(readOutput()).toEqual({
      selectionBeforeEdit: { ranges: [{ anchor: 7, head: 13 }] },
      afterLocalEdit: `prefix target suffix local
`,
      afterRemoteInsert: `remote prefix target suffix local
`,
      selectionAfterRemote: { ranges: [{ anchor: 14, head: 20 }] },
      undo: true,
      afterUndo: `remote prefix target suffix
`,
      selectionAfterUndo: { ranges: [{ anchor: 14, head: 20 }] },
      redo: true,
      afterRedo: `remote prefix target suffix local
`,
      selectionAfterRedo: { ranges: [{ anchor: 14, head: 20 }] },
    })
  })

  it('discards history when a remote edit changes a moved heading marker', () => {
    const initial = `# Parent

parent text

# Child

child text

# Other

other text
`
    const editor = createHistoryEditor(initial)
    const peer = replicate(editor.doc)
    const typedAt = initial.indexOf('parent text') + 'parent text'.length
    edit(editor, typedAt, typedAt, ' local', 'input.type', 10_000)
    const afterLocalEdit = editor.body.toJSON()
    const parentFrom = afterLocalEdit.indexOf('# Parent')
    const childFrom = afterLocalEdit.indexOf('# Child')
    const move = editor.history.move(
      { from: childFrom, destination: childFrom, childOf: parentFrom },
      editor.view,
    )
    const afterMove = editor.body.toJSON()
    const markerPosition = afterMove.indexOf('## Child')
    applyMissingUpdate(editor.doc, peer)
    getBody(peer).delete(markerPosition, 1)
    applyMissingUpdate(peer, editor.doc)
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
      afterLocalEdit,
      moveSucceeded: move.isOk(),
      afterMove,
      beforeUndo,
      failedUndo,
      afterFailedUndo,
      olderUndo,
      redo,
      editor: editor.view.state.doc.toString(),
    })
    expect(readOutput()).toEqual({
      afterLocalEdit: `# Parent

parent text local

# Child

child text

# Other

other text
`,
      moveSucceeded: true,
      afterMove: `# Parent

parent text local

## Child

child text

# Other

other text
`,
      beforeUndo: `# Parent

parent text local

# Child

child text

# Other

other text
`,
      failedUndo: 'A remote change overlaps a moved heading marker',
      afterFailedUndo: `# Parent

parent text local

# Child

child text

# Other

other text
`,
      olderUndo: false,
      redo: false,
      editor: `# Parent

parent text local

# Child

child text

# Other

other text
`,
    })
  })
})
