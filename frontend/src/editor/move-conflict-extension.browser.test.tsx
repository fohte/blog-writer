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
  resolveMoveConflict,
} from '#article/move-conflicts'
import { moveConflictExtension } from '#editor/move-conflict-extension'

const initialBody = '## Ember\nu1\n## Brindle\nrho rho\n## Quartz\nv1\n'
const cleanups: (() => void)[] = []

function createConflictEditor({ deferRemoteEdit = false } = {}) {
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
    const { applyRemoteEditToSource, readOutput } = createConflictEditor({
      deferRemoteEdit: true,
    })
    const outputs = [readOutput()]

    await act(async () => {
      applyRemoteEditToSource()
      await Promise.resolve()
    })
    outputs.push(readOutput())

    expect(outputs).toEqual([
      { notice: null, highlightedText: null },
      {
        notice:
          'This text was written in a section that has moved.xyMove it with the sectionKeep it here',
        highlightedText: 'xy',
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
        'This text was written in a section that has moved.xyMove it with the sectionKeep it here',
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
