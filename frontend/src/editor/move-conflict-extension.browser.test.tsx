import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'

import { setBody } from '#article/body'
import { moveBlock } from '#article/move-block'
import {
  getMoveConflicts,
  observeMoveConflicts,
  recordMoveConflictRestoration,
  resolveMoveConflict,
} from '#article/move-conflicts'
import { stateVector } from '#article/move-conflicts.test-support.test'
import { moveConflictExtension } from '#editor/move-conflict-extension'

const initialBody = '## Ember\nu1\n## Brindle\nrho rho\n## Quartz\nv1\n'
const cleanups: (() => void)[] = []

function createConflictEditor({
  deferRemoteEdit = false,
  receiveMoveOnOffline = true,
} = {}) {
  const source = new Y.Doc()
  source.clientID = 71
  setBody(source, initialBody)
  const offline = new Y.Doc()
  offline.clientID = 72
  Y.applyUpdate(offline, Y.encodeStateAsUpdate(source))
  const stopSource = observeMoveConflicts(source)
  const stopOffline = observeMoveConflicts(offline)

  const offlineText = offline.getText('body')
  offlineText.insert(offlineText.toJSON().indexOf('rho') + 3, 'xy')
  const markdown = source.getText('body').toJSON()
  moveBlock(source, {
    from: markdown.indexOf('## Brindle\n'),
    destination: markdown.length,
  })._unsafeUnwrap()
  if (receiveMoveOnOffline)
    Y.applyUpdate(
      offline,
      Y.encodeStateAsUpdate(source, Y.encodeStateVector(offline)),
      'remote',
    )
  const applyRemoteEditToSource = () => {
    Y.applyUpdate(
      source,
      Y.encodeStateAsUpdate(offline, Y.encodeStateVector(source)),
      'remote',
    )
  }
  if (!deferRemoteEdit) applyRemoteEditToSource()

  const host = document.createElement('div')
  document.body.append(host)
  const body = source.getText('body')
  const undoManager = new Y.UndoManager(body)
  let view: EditorView | undefined
  act(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: body.toJSON(),
        extensions: [
          yCollab(body, null, { undoManager }),
          moveConflictExtension(source),
        ],
      }),
    })
  })
  if (view === undefined)
    throw new Error('Expected the editor view to be mounted')

  cleanups.push(() => {
    act(() => view?.destroy())
    undoManager.destroy()
    stopSource()
    stopOffline()
    source.destroy()
    offline.destroy()
    host.remove()
  })

  const readOutput = () => ({
    notice: host.querySelector('[role="status"]')?.textContent ?? null,
    highlightedText:
      host.querySelector('.cm-move-conflict-range')?.textContent ?? null,
  })

  return { applyRemoteEditToSource, host, offline, readOutput, source, view }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.unstubAllGlobals()
})

describe('moveConflictExtension', () => {
  it('shows a remote conflict after the editor has mounted', async () => {
    const { applyRemoteEditToSource, readOutput, source } =
      createConflictEditor({
        deferRemoteEdit: true,
        receiveMoveOnOffline: false,
      })
    const outputs = [readOutput()]
    const acknowledgementCounts = [source.getMap('move-acks').size]

    await act(async () => {
      applyRemoteEditToSource()
      await Promise.resolve()
    })
    outputs.push(readOutput())
    acknowledgementCounts.push(source.getMap('move-acks').size)

    const readOutputWithAcknowledgements = () => ({
      acknowledgementCounts,
      outputs,
    })
    expect(readOutputWithAcknowledgements()).toEqual({
      acknowledgementCounts: [0, 0],
      outputs: [
        { notice: null, highlightedText: null },
        {
          notice:
            'xyこの文が書かれた箇所は、「## Brindle」へ移動されています。移動先へ移すその場に残す',
          highlightedText: 'xy',
        },
      ],
    })
  })

  it('refreshes the notice after a remote restoration record arrives alone', async () => {
    const receiver = new Y.Doc()
    receiver.clientID = 83
    setBody(
      receiver,
      `one # Brindle
# Quartz
`,
    )
    const mover = new Y.Doc()
    mover.clientID = 84
    Y.applyUpdate(mover, Y.encodeStateAsUpdate(receiver))
    const stopReceiver = observeMoveConflicts(receiver)
    const stopMover = observeMoveConflicts(mover)
    const body = receiver.getText('body')
    const undoManager = new Y.UndoManager(body, { captureTimeout: 0 })
    body.delete(0, 'one '.length)
    Y.applyUpdate(
      mover,
      Y.encodeStateAsUpdate(receiver, Y.encodeStateVector(mover)),
      'remote',
    )
    const moverBody = mover.getText('body').toJSON()
    moveBlock(mover, {
      from: moverBody.indexOf('# Brindle'),
      destination: moverBody.length,
    })._unsafeUnwrap()
    Y.applyUpdate(
      receiver,
      Y.encodeStateAsUpdate(mover, Y.encodeStateVector(receiver)),
      'remote',
    )

    const beforeState = stateVector(receiver)
    undoManager.undo()
    const afterState = stateVector(receiver)
    const editorDoc = new Y.Doc()
    Y.applyUpdate(editorDoc, Y.encodeStateAsUpdate(receiver))
    const editorBody = editorDoc.getText('body')
    const host = document.createElement('div')
    document.body.append(host)
    const editorUndoManager = new Y.UndoManager(editorBody)
    let view: EditorView | undefined
    act(() => {
      view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: editorBody.toJSON(),
          extensions: [
            yCollab(editorBody, null, { undoManager: editorUndoManager }),
            moveConflictExtension(editorDoc),
          ],
        }),
      })
    })
    if (view === undefined)
      throw new Error('Expected the editor view to be mounted')

    cleanups.push(() => {
      act(() => view?.destroy())
      editorUndoManager.destroy()
      undoManager.destroy()
      stopReceiver()
      stopMover()
      receiver.destroy()
      mover.destroy()
      editorDoc.destroy()
      host.remove()
    })

    const readRestorationOutput = () => ({
      body: editorBody.toJSON(),
      acknowledgements: editorDoc.getMap('move-acks').size,
      notice: host.querySelector('[role="status"]')?.textContent ?? null,
      highlightedText:
        host.querySelector('.cm-move-conflict-range')?.textContent ?? null,
      restorations: editorDoc.getMap('move-conflict-restorations').size,
    })
    const outputs = [readRestorationOutput()]
    recordMoveConflictRestoration(receiver, beforeState, afterState)
    const restorationOnlyUpdate = Y.encodeStateAsUpdate(
      receiver,
      Y.encodeStateVector(editorDoc),
    )

    await act(async () => {
      Y.applyUpdate(editorDoc, restorationOnlyUpdate, 'remote-restoration')
      await Promise.resolve()
    })
    outputs.push(readRestorationOutput())

    expect(outputs).toEqual([
      {
        body: `one # Quartz

# Brindle
`,
        acknowledgements: 2,
        notice: null,
        highlightedText: null,
        restorations: 0,
      },
      {
        body: `one # Quartz

# Brindle
`,
        acknowledgements: 2,
        notice:
          'one この文は、移動前のセクションに書き足されたものです。移動先へ移すその場に残す',
        highlightedText: 'one ',
        restorations: 1,
      },
    ])
  })

  it('keeps the conflict highlight attached after typing before it', async () => {
    const { readOutput, view } = createConflictEditor()

    await act(async () => {
      view.dispatch({ changes: { from: 0, insert: 'TTTT' } })
      await Promise.resolve()
    })

    expect(readOutput()).toEqual({
      notice:
        'xyこの文が書かれた箇所は、「## Brindle」へ移動されています。移動先へ移すその場に残す',
      highlightedText: 'xy',
    })
  })

  it('removes the conflict decoration after replacing the entire document', async () => {
    const { readOutput, view } = createConflictEditor()

    await act(async () => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: 'x' },
      })
      await Promise.resolve()
    })

    const readEditorOutput = () => ({
      body: view.state.doc.toString(),
      ...readOutput(),
    })

    expect(readEditorOutput()).toEqual({
      body: 'x',
      notice: null,
      highlightedText: null,
    })
  })

  it('recomputes decorations after another replica keeps the conflict', async () => {
    const { offline, readOutput, source, view } = createConflictEditor()
    const conflict = getMoveConflicts(offline)[0]
    if (!conflict) throw new Error('Expected a move conflict')
    const body = source.getText('body')
    resolveMoveConflict(offline, conflict.id, 'keep')._unsafeUnwrap()

    await act(async () => {
      Y.applyUpdate(
        source,
        Y.encodeStateAsUpdate(offline, Y.encodeStateVector(source)),
        'remote-keep',
      )
      await Promise.resolve()
    })

    const readEditorOutput = () => ({
      body: body.toJSON(),
      ...readOutput(),
      document: view.state.doc.toString(),
    })
    expect(readEditorOutput()).toEqual({
      body: '## Ember\nu1\nxy## Quartz\nv1\n\n## Brindle\nrho rho\n',
      notice: null,
      highlightedText: null,
      document: '## Ember\nu1\nxy## Quartz\nv1\n\n## Brindle\nrho rho\n',
    })
  })
})
