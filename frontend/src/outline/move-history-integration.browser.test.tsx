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
    const initial = '## Cedar\na1\n## Fjord\nmaple maple\n## Vista\nz9\n'
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
      bodyAfterUndo: '## Cedar\na1\nple## Vista\nz9\n\n## Fjord\nmaple ma\n',
      editorAfterUndo: '## Cedar\na1\nple## Vista\nz9\n\n## Fjord\nmaple ma\n',
      conflictsAfterUndo: [
        [{ from: 12, to: 15, text: 'ple', target: 46 }],
        [{ from: 12, to: 15, text: 'ple', target: 46 }],
      ],
    })
  })

  it('maps saved selections through a remote insertion before undo and redo', () => {
    const initial = 'prefix target suffix\n'
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
      afterLocalEdit: 'prefix target suffix local\n',
      afterRemoteInsert: 'remote prefix target suffix local\n',
      selectionAfterRemote: { ranges: [{ anchor: 14, head: 20 }] },
      undo: true,
      afterUndo: 'remote prefix target suffix\n',
      selectionAfterUndo: { ranges: [{ anchor: 14, head: 20 }] },
      redo: true,
      afterRedo: 'remote prefix target suffix local\n',
      selectionAfterRedo: { ranges: [{ anchor: 14, head: 20 }] },
    })
  })

  it('discards history when a remote edit changes a moved heading marker', () => {
    const initial =
      '# Parent\n\nparent text\n\n# Child\n\nchild text\n\n# Other\n\nother text\n'
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
      afterLocalEdit:
        '# Parent\n\nparent text local\n\n# Child\n\nchild text\n\n# Other\n\nother text\n',
      moveSucceeded: true,
      afterMove:
        '# Parent\n\nparent text local\n\n## Child\n\nchild text\n\n# Other\n\nother text\n',
      beforeUndo:
        '# Parent\n\nparent text local\n\n# Child\n\nchild text\n\n# Other\n\nother text\n',
      failedUndo: 'A remote change overlaps a moved heading marker',
      afterFailedUndo:
        '# Parent\n\nparent text local\n\n# Child\n\nchild text\n\n# Other\n\nother text\n',
      olderUndo: false,
      redo: false,
      editor:
        '# Parent\n\nparent text local\n\n# Child\n\nchild text\n\n# Other\n\nother text\n',
    })
  })
})
