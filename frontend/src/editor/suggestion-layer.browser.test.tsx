import { indentUnit } from '@codemirror/language'
import { EditorState, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'

import { getBody, setBody } from '#article/body'
import { MarkdownEditor } from '#editor/index'
import { createSuggestionLayer } from '#editor/suggestion-layer'
import { undoManagerFacet } from '#editor/undo-manager-facet'

const initialText = 'opening sentence\nselected sentence\nclosing sentence'
const cleanups: (() => void)[] = []

function createEditor(
  content = initialText,
  onResolve?: (decision: string) => void,
) {
  const doc = new Y.Doc()
  setBody(doc, content)
  const body = getBody(doc)
  const undoManager = new Y.UndoManager(body, { captureTimeout: 0 })
  const host = document.createElement('div')
  document.body.append(host)
  const layer = createSuggestionLayer({
    onCancelInFlight: () => onResolve?.('cancel'),
    onResolve: (_suggestion, decision) => onResolve?.(decision),
  })
  let view: EditorView | undefined

  act(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: body.toJSON(),
        extensions: [
          indentUnit.of('  '),
          yCollab(body, null, { undoManager }),
          undoManagerFacet.of(undoManager),
          layer.extension,
        ],
      }),
    })
  })

  if (!view) throw new Error('The suggestion editor did not mount')
  cleanups.push(() => {
    act(() => view?.destroy())
    undoManager.destroy()
    doc.destroy()
    host.remove()
  })

  const setSuggestion = (suggestion: {
    id: string
    from: number
    to: number
    replacement: string
  }) => {
    let result: ReturnType<typeof layer.setSuggestions> | undefined
    act(() => {
      result = layer.setSuggestions([suggestion])
    })
    if (!result) throw new Error('Could not set suggestion')
    if (result.isErr())
      throw new Error(`Could not set suggestion: ${result.error.type}`)
  }

  return { body, doc, host, layer, setSuggestion, undoManager, view }
}

function dispatchKey(view: EditorView, key: string): void {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, key }),
  )
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.unstubAllGlobals()
})

describe('suggestion layer', () => {
  it('maps a suggestion after an outside edit and removes it after an edit inside the range', () => {
    const { host, setSuggestion, view } = createEditor()
    const from = initialText.indexOf('selected')
    setSuggestion({
      id: 'suggestion-a',
      from,
      to: from + 'selected sentence'.length,
      replacement: 'revised sentence',
    })

    act(() => {
      view.dispatch({ changes: { from: 0, insert: 'new ' } })
    })
    const tracked = host.querySelector('.cm-suggestion-widget')?.textContent
    act(() => {
      view.dispatch({
        changes: { from: from + 4 + 2, insert: 'x' },
      })
    })

    const readOutput = () => ({
      afterOutsideEdit: tracked,
      afterInsideEdit:
        host.querySelector('.cm-suggestion-widget')?.textContent ?? null,
    })
    expect(readOutput()).toEqual({
      afterOutsideEdit: 'selectedrevised sentence',
      afterInsideEdit: null,
    })
  })

  it('drops a suggestion when a remote Yjs edit changes its range', () => {
    const { doc, host, setSuggestion } = createEditor()
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    const from = initialText.indexOf('selected')
    setSuggestion({
      id: 'suggestion-a',
      from,
      to: from + 'selected sentence'.length,
      replacement: 'revised sentence',
    })

    const peerBody = getBody(peer)
    peerBody.insert(from + 3, 'x')
    act(() => {
      Y.applyUpdate(
        doc,
        Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)),
        'remote',
      )
    })

    expect(
      host.querySelector('.cm-suggestion-widget')?.textContent ?? null,
    ).toEqual(null)
    peer.destroy()
  })

  it('drops a suggestion when its block is moved by delete and insert', () => {
    const content = 'before\nmove this block\nafter'
    const { body, doc, host, setSuggestion } = createEditor(content)
    const from = content.indexOf('move')
    setSuggestion({
      id: 'suggestion-a',
      from,
      to: from + 'move this block'.length,
      replacement: 'move the block',
    })

    act(() => {
      doc.transact(() => {
        const moved = body
          .toJSON()
          .slice(from, from + 'move this block\n'.length)
        body.delete(from, moved.length)
        body.insert(body.length, moved)
      })
    })

    expect(
      host.querySelector('.cm-suggestion-widget')?.textContent ?? null,
    ).toEqual(null)
  })

  it('keeps a suggestion when a different block moves before its range', () => {
    const content = 'before\nselected sentence\nmoving block\nafter'
    const { body, doc, host, setSuggestion } = createEditor(content)
    const from = content.indexOf('selected')
    const movedFrom = content.indexOf('moving block')
    const movedText = 'moving block\n'
    setSuggestion({
      id: 'suggestion-a',
      from,
      to: from + 'selected sentence'.length,
      replacement: 'revised sentence',
    })

    act(() => {
      doc.transact(() => {
        body.delete(movedFrom, movedText.length)
        body.insert(0, movedText)
      })
    })
    const afterMove = host.querySelector('.cm-suggestion-widget') !== null
    act(() => {
      body.insert(movedText.length + from + 2, 'x')
    })

    const readOutput = () => ({
      afterMove,
      afterEdit: host.querySelector('.cm-suggestion-widget') !== null,
    })
    expect(readOutput()).toEqual({ afterMove: true, afterEdit: false })
  })

  it('accepts a focused suggestion as one Yjs undo step', () => {
    const { body, setSuggestion, undoManager, view } = createEditor()
    const from = initialText.indexOf('selected')
    setSuggestion({
      id: 'suggestion-a',
      from,
      to: from + 'selected sentence'.length,
      replacement: 'revised sentence',
    })
    act(() => {
      view.dispatch({ selection: { anchor: from } })
      dispatchKey(view, 'Tab')
    })
    const afterAccept = body.toJSON()
    undoManager.undo()

    const readOutput = () => ({ afterAccept, afterUndo: body.toJSON() })
    expect(readOutput()).toEqual({
      afterAccept: initialText.replace('selected sentence', 'revised sentence'),
      afterUndo: initialText,
    })
  })

  it('keeps prior typing when one undo reverses an accepted suggestion in MarkdownEditor', () => {
    const doc = new Y.Doc()
    setBody(doc, initialText)
    const body = getBody(doc)
    const host = document.createElement('div')
    document.body.append(host)
    const layer = createSuggestionLayer()
    const root = createRoot(host)
    act(() => {
      root.render(<MarkdownEditor extensions={[layer.extension]} text={body} />)
    })
    cleanups.push(() => {
      act(() => {
        root.unmount()
      })
      doc.destroy()
      host.remove()
    })
    const content = host.querySelector<HTMLElement>('.cm-content')
    const view = content ? EditorView.findFromDOM(content) : null
    if (!view) throw new Error('The Markdown editor did not mount')
    const from = initialText.indexOf('selected')

    let suggestionResult: ReturnType<typeof layer.setSuggestions> | undefined
    act(() => {
      suggestionResult = layer.setSuggestions([
        {
          id: 'suggestion-a',
          from,
          to: from + 'selected sentence'.length,
          replacement: 'revised sentence',
        },
      ])
    })
    if (!suggestionResult) throw new Error('Could not set suggestion')
    if (suggestionResult.isErr()) throw new Error('Could not set suggestion')

    act(() => {
      view.dispatch({
        changes: { from: 0, insert: 'new ' },
        annotations: Transaction.userEvent.of('input.type'),
      })
    })
    const afterTyping = body.toJSON()
    act(() => {
      layer.accept('suggestion-a')
    })
    const afterAccept = body.toJSON()
    const undoManager = view.state.facet(undoManagerFacet)
    let didUndo = false
    act(() => {
      didUndo = Boolean(undoManager?.undo())
    })

    const readOutput = () => ({
      afterAccept,
      afterTyping,
      afterUndo: body.toJSON(),
      didUndo,
    })
    expect(readOutput()).toEqual({
      afterAccept: `new ${initialText.replace('selected sentence', 'revised sentence')}`,
      afterTyping: `new ${initialText}`,
      afterUndo: `new ${initialText}`,
      didUndo: true,
    })
  })

  it('moves to the next suggestion before using Tab for the editor default', () => {
    const { host, layer, view } = createEditor()
    const first = initialText.indexOf('selected')
    const second = initialText.indexOf('closing')
    const result = layer.setSuggestions([
      {
        id: 'suggestion-a',
        from: first,
        to: first + 'opening sentence'.length,
        replacement: 'first replacement',
      },
      {
        id: 'suggestion-b',
        from: second,
        to: initialText.length,
        replacement: 'last replacement',
      },
    ])
    if (result.isErr()) throw new Error('Could not set suggestions')

    act(() => {
      view.dispatch({ selection: { anchor: 0 } })
      dispatchKey(view, 'Tab')
    })

    const readOutput = () => ({
      cursor: view.state.selection.main.head,
      focusedCount: host.querySelectorAll('[data-focused="true"]').length,
    })
    expect(readOutput()).toEqual({ cursor: first, focusedCount: 1 })
  })

  it('accepts a focused suggestion from its button', () => {
    const { body, host, setSuggestion, view } = createEditor()
    const from = initialText.indexOf('selected')
    setSuggestion({
      id: 'suggestion-a',
      from,
      to: from + 'selected sentence'.length,
      replacement: 'revised sentence',
    })
    act(() => {
      view.dispatch({ selection: { anchor: from } })
    })
    act(() => {
      host.querySelector<HTMLButtonElement>('button')?.click()
    })

    expect(body.toJSON()).toEqual(
      initialText.replace('selected sentence', 'revised sentence'),
    )
  })

  it('rejects a focused suggestion from its button', () => {
    const { body, host, setSuggestion, view } = createEditor()
    const from = initialText.indexOf('selected')
    setSuggestion({
      id: 'suggestion-a',
      from,
      to: from + 'selected sentence'.length,
      replacement: 'revised sentence',
    })
    act(() => {
      view.dispatch({ selection: { anchor: from } })
    })
    act(() => {
      host.querySelectorAll<HTMLButtonElement>('button')[1]?.click()
    })

    const readOutput = () => ({
      body: body.toJSON(),
      visible: host.querySelector('.cm-suggestion-widget') !== null,
    })
    expect(readOutput()).toEqual({ body: initialText, visible: false })
  })

  it('prioritizes list indentation before moving to the next suggestion', () => {
    const content = '- list item\n\nlast line'
    const { body, layer, view } = createEditor(content)
    const suggestions = layer.setSuggestions([
      {
        id: 'suggestion-a',
        from: content.indexOf('last'),
        to: content.length,
        replacement: 'final line',
      },
    ])
    if (suggestions.isErr()) throw new Error('Could not set suggestions')
    act(() => {
      view.dispatch({ selection: { anchor: 4 } })
      dispatchKey(view, 'Tab')
    })

    expect(body.toJSON()).toEqual('  - list item\n\nlast line')
  })

  it('cancels in-flight work before rejecting a focused suggestion', () => {
    const events: string[] = []
    const { body, host, layer, view } = createEditor(initialText, (event) => {
      events.push(event)
    })
    const from = initialText.indexOf('selected')
    const result = layer.setSuggestions([
      {
        id: 'suggestion-a',
        from,
        to: from + 'selected sentence'.length,
        replacement: 'revised sentence',
      },
    ])
    if (result.isErr()) throw new Error('Could not set suggestions')
    let inFlightResult: ReturnType<typeof layer.setInFlight> | undefined
    act(() => {
      inFlightResult = layer.setInFlight({
        from: initialText.length,
        to: initialText.length,
      })
    })
    if (!inFlightResult) throw new Error('Could not set in-flight state')
    if (inFlightResult.isErr()) throw new Error('Could not set in-flight state')

    act(() => {
      view.dispatch({ selection: { anchor: from } })
      dispatchKey(view, 'Escape')
    })
    const afterCancel = host.querySelector('.suggestion-diff-text')?.textContent
    act(() => {
      dispatchKey(view, 'Escape')
    })

    const readOutput = () => ({
      afterCancel,
      afterReject:
        host.querySelector('.cm-suggestion-widget')?.textContent ?? null,
      body: body.toJSON(),
      events,
    })
    expect(readOutput()).toEqual({
      afterCancel: 'selectedrevised sentence',
      afterReject: null,
      body: initialText,
      events: ['cancel', 'reject'],
    })
  })
})
