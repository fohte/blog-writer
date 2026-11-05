import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'

import { getBody, setBody } from '#article/index'
import { MarkdownEditor } from '#components/markdown-editor'
import { ArticleOutline } from '#outline/article-outline'
import { createOutlineEditorExtension } from '#outline/editor-extension'
import { createMoveHistory } from '#outline/move-history'

const cleanups: (() => void)[] = []

function dispatchDrag(
  source: HTMLElement,
  target: HTMLElement,
  position = target.getBoundingClientRect(),
) {
  const dataTransfer = new DataTransfer()
  const eventOptions = {
    bubbles: true,
    cancelable: true,
    clientX: position.left + position.width / 2,
    clientY: position.top + position.height / 2,
    dataTransfer,
  }
  source.dispatchEvent(new DragEvent('dragstart', eventOptions))
  target.dispatchEvent(new DragEvent('dragenter', eventOptions))
  target.dispatchEvent(new DragEvent('dragover', eventOptions))
  target.dispatchEvent(new DragEvent('drop', eventOptions))
  source.dispatchEvent(new DragEvent('dragend', eventOptions))
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  for (const cleanup of cleanups) cleanup()
  cleanups.length = 0
  vi.unstubAllGlobals()
})

describe('outline interactions', () => {
  it('moves the editor selection to the heading chosen in the outline', async () => {
    const markdownText =
      '# Overview\n\nFirst section.\n\n# Details\n\nSecond section.\n'
    const doc = new Y.Doc()
    setBody(doc, markdownText)
    const history = createMoveHistory(doc)
    const editorHost = document.createElement('div')
    const outlineHost = document.createElement('div')
    document.body.append(editorHost, outlineHost)
    const view = new EditorView({
      parent: editorHost,
      state: EditorState.create({ doc: markdownText }),
    })
    const root: Root = createRoot(outlineHost)
    cleanups.push(() => {
      act(() => {
        root.unmount()
      })
      view.destroy()
      history.destroy()
      doc.destroy()
      editorHost.remove()
      outlineHost.remove()
    })

    act(() => {
      root.render(createElement(ArticleOutline, { doc, history, view }))
    })

    const options = outlineHost.querySelectorAll('[role="option"]')
    const details = options[1]
    if (details === undefined) throw new Error('The second heading is missing')
    await act(async () => {
      await userEvent.click(details)
    })

    const readSelection = () => ({ selection: view.state.selection.main.head })
    expect(readSelection()).toEqual({
      selection: markdownText.indexOf('# Details'),
    })
  })

  it('moves a heading section with Alt plus an arrow key and renders body handles', () => {
    const markdownText =
      '# Overview\n\nFirst section.\n\n# Details\n\nSecond section.\n'
    const doc = new Y.Doc()
    setBody(doc, markdownText)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: markdownText,
        extensions: [
          markdown({ extensions: GFM }),
          yCollab(body, null, { undoManager: history.undoManager }),
          createOutlineEditorExtension(history),
        ],
      }),
    })
    cleanups.push(() => {
      view.destroy()
      history.destroy()
      doc.destroy()
    })
    view.focus()
    const content = view.contentDOM
    content.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        altKey: true,
        bubbles: true,
      }),
    )

    const readOutput = () => ({
      body: body.toJSON(),
      editor: view.state.doc.toString(),
      handleCount: view.dom.querySelectorAll('.cm-block-drag-handle').length,
    })
    expect(readOutput()).toEqual({
      body: '# Details\n\nSecond section.\n\n# Overview\n\nFirst section.\n',
      editor: '# Details\n\nSecond section.\n\n# Overview\n\nFirst section.\n',
      handleCount: 4,
    })
  })

  it('moves a heading under another heading when its outline row receives a drop', () => {
    const markdownText =
      '# Overview\n\nFirst section.\n\n# Details\n\nSecond section.\n'
    const doc = new Y.Doc()
    setBody(doc, markdownText)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const moveSpy = vi.spyOn(history, 'move')
    const editorHost = document.createElement('div')
    const outlineHost = document.createElement('div')
    document.body.append(editorHost, outlineHost)
    const view = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: markdownText,
        extensions: [
          markdown({ extensions: GFM }),
          yCollab(body, null, { undoManager: history.undoManager }),
        ],
      }),
    })
    const root: Root = createRoot(outlineHost)
    cleanups.push(() => {
      act(() => {
        root.unmount()
      })
      view.destroy()
      history.destroy()
      doc.destroy()
      editorHost.remove()
      outlineHost.remove()
    })

    act(() => {
      root.render(createElement(ArticleOutline, { doc, history, view }))
    })

    const handles = outlineHost.querySelectorAll<HTMLElement>(
      'button[aria-label^="Move "]',
    )
    const detailsHandle = handles[1]
    const overviewRow = outlineHost.querySelector<HTMLElement>(
      '[aria-label="Overview"]',
    )
    if (detailsHandle === undefined || overviewRow === null)
      throw new Error('The outline drag source or target is missing')
    const overviewContainer = overviewRow.parentElement
    if (overviewContainer === null)
      throw new Error('The outline drop target has no container')
    overviewContainer.style.height = '80px'
    const overviewBounds = overviewContainer.getBoundingClientRect()
    act(() => {
      dispatchDrag(detailsHandle, overviewContainer, overviewBounds)
    })

    const readOutput = () => ({
      body: body.toJSON(),
      editor: view.state.doc.toString(),
      moveCalls: moveSpy.mock.calls.map(([input]) => input),
      error: outlineHost.querySelector('[role="alert"]')?.textContent ?? null,
      headings: [...outlineHost.querySelectorAll('[role="option"]')].map(
        (option) => option.getAttribute('aria-label'),
      ),
    })
    expect(readOutput()).toEqual({
      body: '# Overview\n\nFirst section.\n\n## Details\n\nSecond section.\n',
      editor: '# Overview\n\nFirst section.\n\n## Details\n\nSecond section.\n',
      moveCalls: [
        {
          from: markdownText.indexOf('# Details'),
          destination: markdownText.indexOf('# Details'),
          childOf: 0,
        },
      ],
      error: null,
      headings: ['Overview', 'Details'],
    })
  })

  it('moves a Markdown block when its body handle is dropped after another block', () => {
    const markdownText = 'First paragraph.\n\nSecond paragraph.\n'
    const doc = new Y.Doc()
    setBody(doc, markdownText)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const editorHost = document.createElement('div')
    editorHost.style.marginLeft = '40px'
    document.body.append(editorHost)
    const view = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: markdownText,
        extensions: [
          markdown({ extensions: GFM }),
          yCollab(body, null, { undoManager: history.undoManager }),
          createOutlineEditorExtension(history),
        ],
      }),
    })
    cleanups.push(() => {
      view.destroy()
      history.destroy()
      doc.destroy()
      editorHost.remove()
    })

    const handles = view.dom.querySelectorAll<HTMLElement>(
      '.cm-block-drag-handle',
    )
    const firstHandle = handles[0]
    if (firstHandle === undefined)
      throw new Error('The body drag source or target is missing')
    const targetPosition = view.coordsAtPos(
      markdownText.indexOf('Second paragraph.'),
    )
    if (targetPosition === null)
      throw new Error('The body drop target has no editor coordinates')
    const dropPosition = new DOMRect(
      targetPosition.left + 1,
      targetPosition.bottom - 2,
      1,
      1,
    )
    act(() => {
      dispatchDrag(firstHandle, view.dom, dropPosition)
    })

    const readOutput = () => ({
      body: body.toJSON(),
      editor: view.state.doc.toString(),
    })
    expect(readOutput()).toEqual({
      body: 'Second paragraph.\n\nFirst paragraph.\n',
      editor: 'Second paragraph.\n\nFirst paragraph.\n',
    })
  })

  it('uses the shared history when Cmd or Ctrl plus Z is pressed', () => {
    const initial = 'An editable sentence.'
    const doc = new Y.Doc()
    setBody(doc, initial)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const host = document.createElement('div')
    document.body.append(host)
    const root: Root = createRoot(host)
    const viewRef: { current: EditorView | null } = { current: null }
    cleanups.push(() => {
      act(() => {
        root.unmount()
      })
      history.destroy()
      doc.destroy()
      host.remove()
    })

    act(() => {
      root.render(
        createElement(MarkdownEditor, {
          extensions: [createOutlineEditorExtension(history)],
          history,
          onViewChange: (view: EditorView | null) => {
            viewRef.current = view
          },
          text: body,
        }),
      )
    })

    const content = host.querySelector<HTMLElement>('.cm-content')
    const view = viewRef.current
    if (content === null || view === null)
      throw new Error('The markdown editor did not mount')
    act(() => {
      view.dispatch({ changes: { from: body.length, insert: ' Draft.' } })
      view.focus()
      content.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          bubbles: true,
          [navigator.platform.includes('Mac') ? 'metaKey' : 'ctrlKey']: true,
        }),
      )
    })

    const readOutput = () => ({
      body: body.toJSON(),
      editor: view.state.doc.toString(),
    })
    expect(readOutput()).toEqual({ body: initial, editor: initial })
  })
})
