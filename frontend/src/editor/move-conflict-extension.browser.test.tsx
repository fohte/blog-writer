import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { setBody } from '#article/body'
import { getMoveConflicts } from '#article/index'
import { moveBlock } from '#article/move-block'
import { observeMoveConflicts } from '#article/move-conflicts'
import { moveConflictExtension } from '#editor/move-conflict-extension'

const initialBody = '## Cedar\na1\n## Fjord\nmaple maple\n## Vista\nz9\n'
const cleanups: (() => void)[] = []

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.unstubAllGlobals()
})

describe('moveConflictExtension', () => {
  it('renders the conflict notice from a state field decoration', () => {
    const source = new Y.Doc()
    source.clientID = 71
    setBody(source, initialBody)
    const offline = new Y.Doc()
    offline.clientID = 72
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(source))
    const stopSource = observeMoveConflicts(source)
    const stopOffline = observeMoveConflicts(offline)

    const offlineText = offline.getText('body')
    offlineText.insert(offlineText.toJSON().indexOf('maple') + 5, 'xy')
    const markdown = source.getText('body').toJSON()
    moveBlock(source, {
      from: markdown.indexOf('## Fjord\n'),
      destination: markdown.length,
    })._unsafeUnwrap()
    Y.applyUpdate(
      offline,
      Y.encodeStateAsUpdate(source, Y.encodeStateVector(offline)),
      'remote',
    )
    Y.applyUpdate(
      source,
      Y.encodeStateAsUpdate(offline, Y.encodeStateVector(source)),
      'remote',
    )

    const host = document.createElement('div')
    document.body.append(host)
    let view: EditorView | undefined
    act(() => {
      view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: source.getText('body').toJSON(),
          extensions: [moveConflictExtension(source)],
        }),
      })
    })
    cleanups.push(() => {
      act(() => view?.destroy())
      stopSource()
      stopOffline()
      source.destroy()
      offline.destroy()
      host.remove()
    })

    const readOutput = () => ({
      notice: host.querySelector('[role="status"]')?.textContent,
      highlightedText: host.querySelector('.cm-move-conflict-range')
        ?.textContent,
      alert: host.querySelector('[role="alert"]')?.textContent ?? null,
    })
    const initialOutput = readOutput()
    const conflict = getMoveConflicts(source)[0]
    if (conflict) {
      source.getText('body').delete(conflict.from, conflict.to - conflict.from)
    }
    const moveButton = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Move it with the section',
    )
    act(() => moveButton?.click())

    const output = () => ({ initialOutput, afterStaleAction: readOutput() })
    expect(output()).toEqual({
      initialOutput: {
        notice:
          'This text was written in a section that has moved.xyMove it with the sectionKeep it here',
        highlightedText: 'xy',
        alert: null,
      },
      afterStaleAction: {
        notice:
          'This text was written in a section that has moved.xyThis text changed before the choice could be applied. Review the updated text.Move it with the sectionKeep it here',
        highlightedText: 'xy',
        alert:
          'This text changed before the choice could be applied. Review the updated text.',
      },
    })
  })
})
