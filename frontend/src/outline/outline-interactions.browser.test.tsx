import { markdown } from '@codemirror/lang-markdown'
import {
  EditorSelection,
  EditorState,
  Prec,
  Transaction,
} from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'

import { getBody, setBody } from '#article/index'
import { MarkdownEditor } from '#components/markdown-editor'
import {
  ArticleOutline,
  createMoveHistory,
  createOutlineEditorExtension,
} from '#outline/index'

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

    const readSelection = () => ({
      selection: view.state.selection.main.head,
      activeHeadings: [...outlineHost.querySelectorAll('[role="option"]')].map(
        (option) => option.getAttribute('aria-selected'),
      ),
    })
    expect(readSelection()).toEqual({
      selection: markdownText.indexOf('# Details'),
      activeHeadings: ['false', 'true'],
    })
  })

  it('shows move errors and clears them after the next outline action', async () => {
    const markdownText = '# Overview\n\nFirst section.\n'
    const doc = new Y.Doc()
    setBody(doc, markdownText)
    const history = createMoveHistory(doc)
    const outlineHost = document.createElement('div')
    document.body.append(outlineHost)
    const view = new EditorView({
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
      outlineHost.remove()
    })

    act(() => {
      root.render(createElement(ArticleOutline, { doc, history, view }))
    })
    let moveAccepted = true
    act(() => {
      moveAccepted = history
        .move({ from: 0, destination: 0, childOf: 0 }, view)
        .isOk()
    })
    const errorAfterMove =
      outlineHost.querySelector('[role="alert"]')?.textContent ?? null
    const heading = outlineHost.querySelector<HTMLElement>('[role="option"]')
    if (!heading) throw new Error('The outline heading is missing')
    await act(async () => {
      await userEvent.click(heading)
    })

    const readOutput = () => ({
      moveAccepted,
      errorAfterMove,
      errorAfterNextAction:
        outlineHost.querySelector('[role="alert"]')?.textContent ?? null,
    })
    expect(readOutput()).toEqual({
      moveAccepted: false,
      errorAfterMove: 'A section cannot become its own child',
      errorAfterNextAction: null,
    })
  })

  it('moves a heading section with Alt plus an arrow key through the MarkdownEditor keymap', async () => {
    const markdownText =
      '# Overview\n\nFirst section.\n\n# Details\n\nSecond section.\n'
    const doc = new Y.Doc()
    setBody(doc, markdownText)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const viewRef: { current: EditorView | null } = { current: null }
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
    const view = viewRef.current
    if (view === null) throw new Error('The markdown editor did not mount')
    cleanups.push(() => {
      act(() => {
        root.unmount()
      })
      history.destroy()
      doc.destroy()
      host.remove()
    })
    view.focus()
    await act(async () => {
      await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}')
    })

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

  it('moves a heading under another heading with a real pointer and undoes after the drag', async () => {
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
    const editorRoot = createRoot(editorHost)
    const viewRef: { current: EditorView | null } = { current: null }
    act(() => {
      editorRoot.render(
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
    const view = viewRef.current
    if (view === null) throw new Error('The markdown editor did not mount')
    const root: Root = createRoot(outlineHost)
    cleanups.push(() => {
      act(() => {
        root.unmount()
        editorRoot.unmount()
      })
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
    await act(async () => {
      await userEvent.dragAndDrop(detailsHandle, overviewContainer)
    })
    const afterMove = body.toJSON()
    const modifier = navigator.platform.includes('Mac') ? 'Meta' : 'Control'
    await act(async () => {
      await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
    })

    const readOutput = () => ({
      body: body.toJSON(),
      editor: view.state.doc.toString(),
      afterMove,
      moveCalls: moveSpy.mock.calls.map(([input]) => input),
      error: outlineHost.querySelector('[role="alert"]')?.textContent ?? null,
      headings: [...outlineHost.querySelectorAll('[role="option"]')].map(
        (option) => option.getAttribute('aria-label'),
      ),
    })
    expect(readOutput()).toEqual({
      body: markdownText,
      editor: markdownText,
      afterMove:
        '# Overview\n\nFirst section.\n\n## Details\n\nSecond section.\n',
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

  it('moves a Markdown block when drag events reach the target paragraph lower half', () => {
    const markdownText = 'First paragraph.\n\nSecond paragraph.\n'
    const doc = new Y.Doc()
    setBody(doc, markdownText)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const editorHost = document.createElement('div')
    document.body.append(editorHost)
    const view = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: markdownText,
        extensions: [
          markdown({ extensions: GFM }),
          yCollab(body, null, { undoManager: false }),
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
    const secondParagraph = [
      ...view.dom.querySelectorAll<HTMLElement>('.cm-line'),
    ].find((line) => line.textContent.endsWith('Second paragraph.'))
    if (!secondParagraph)
      throw new Error('The second paragraph is missing from the editor')
    const bounds = secondParagraph.getBoundingClientRect()
    const lowerHalf = new DOMRect(
      bounds.left,
      bounds.top + bounds.height / 2,
      bounds.width,
      bounds.height / 2,
    )
    act(() => {
      dispatchDrag(firstHandle, secondParagraph, lowerHalf)
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

  it('keeps body drag handles clear of text at mobile width', async () => {
    const markdownText =
      '# Overview\n\nA first paragraph.\n\n## Details\n\nA second paragraph.\n'
    await page.viewport(320, 800)
    const doc = new Y.Doc()
    setBody(doc, markdownText)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const host = document.createElement('div')
    host.style.width = '320px'
    host.style.height = '32rem'
    document.body.append(host)
    const root = createRoot(host)
    const viewRef: { current: EditorView | null } = { current: null }
    cleanups.push(() => {
      act(() => {
        root.unmount()
      })
      history.destroy()
      doc.destroy()
      host.remove()
    })

    try {
      act(() => {
        root.render(
          createElement(MarkdownEditor, {
            extensions: [createOutlineEditorExtension(history)],
            history,
            initialSelection: { anchor: 0 },
            onViewChange: (view: EditorView | null) => {
              viewRef.current = view
            },
            text: body,
          }),
        )
      })

      const view = viewRef.current
      if (view === null) throw new Error('The markdown editor did not mount')
      const lines = [...view.dom.querySelectorAll<HTMLElement>('.cm-line')]
      const headingLine = lines.find((line) =>
        line.classList.contains('cm-md-heading-1'),
      )
      const paragraphLine = lines.find((line) =>
        line.textContent.endsWith('A first paragraph.'),
      )
      const subheadingLine = lines.find((line) =>
        line.classList.contains('cm-md-heading-2'),
      )
      if (!headingLine || !paragraphLine || !subheadingLine)
        throw new Error('A heading or paragraph line is missing')

      const measureLine = (line: HTMLElement) => {
        const handle = line.querySelector<HTMLElement>('.cm-block-drag-handle')
        if (!handle) throw new Error('The line drag handle is missing')

        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
        let firstTextNode = walker.nextNode()
        while (firstTextNode) {
          const parent = firstTextNode.parentElement
          if (
            firstTextNode.textContent !== '' &&
            !parent?.closest('.cm-block-drag-handle, .cm-md-hidden-markup')
          ) {
            break
          }
          firstTextNode = walker.nextNode()
        }
        if (!firstTextNode) throw new Error('The line has no visible text')

        const range = document.createRange()
        range.setStart(firstTextNode, 0)
        range.setEnd(firstTextNode, 1)
        const glyph = range.getBoundingClientRect()
        const handleRect = handle.getBoundingClientRect()
        const lineRect = line.getBoundingClientRect()
        const hitTarget = document.elementFromPoint(
          glyph.left + glyph.width / 2,
          glyph.top + glyph.height / 2,
        )
        return {
          firstCharacter: firstTextNode.textContent?.[0] ?? '',
          handleClearsText: handleRect.right <= glyph.left,
          handleIsCentered:
            Math.abs(
              handleRect.top +
                handleRect.height / 2 -
                (lineRect.top + lineRect.height / 2),
            ) < 1,
          firstCharacterHitByHandle: Boolean(
            hitTarget?.closest('.cm-block-drag-handle'),
          ),
          glyph,
          lineRect,
        }
      }

      const heading = measureLine(headingLine)
      const paragraph = measureLine(paragraphLine)
      const subheading = measureLine(subheadingLine)
      const editorRect = view.dom.getBoundingClientRect()
      view.dispatch({
        selection: EditorSelection.cursor(markdownText.length),
      })
      const paragraphStart = markdownText.indexOf('A first paragraph.')
      await page.elementLocator(paragraphLine).click({
        position: {
          x:
            paragraph.glyph.left +
            paragraph.glyph.width * 0.8 -
            paragraph.lineRect.left,
          y:
            paragraph.glyph.top +
            paragraph.glyph.height / 2 -
            paragraph.lineRect.top,
        },
      })

      const readOutput = () => ({
        heading: {
          firstCharacter: heading.firstCharacter,
          handleClearsText: heading.handleClearsText,
          handleIsCentered: heading.handleIsCentered,
          firstCharacterHitByHandle: heading.firstCharacterHitByHandle,
        },
        paragraph: {
          firstCharacter: paragraph.firstCharacter,
          handleClearsText: paragraph.handleClearsText,
          handleIsCentered: paragraph.handleIsCentered,
          firstCharacterHitByHandle: paragraph.firstCharacterHitByHandle,
        },
        subheading: {
          firstCharacter: subheading.firstCharacter,
          handleClearsText: subheading.handleClearsText,
          handleIsCentered: subheading.handleIsCentered,
          firstCharacterHitByHandle: subheading.firstCharacterHitByHandle,
        },
        mobile: {
          firstCharacterInset: Math.round(
            paragraph.glyph.left - editorRect.left,
          ),
          horizontalOverflow:
            view.scrollDOM.scrollWidth > view.scrollDOM.clientWidth,
        },
        clickMovesCursorAfterFirstCharacter:
          view.state.selection.main.head === paragraphStart + 1,
      })
      expect(readOutput()).toEqual({
        heading: {
          firstCharacter: '#',
          handleClearsText: true,
          handleIsCentered: true,
          firstCharacterHitByHandle: false,
        },
        paragraph: {
          firstCharacter: 'A',
          handleClearsText: true,
          handleIsCentered: true,
          firstCharacterHitByHandle: false,
        },
        subheading: {
          firstCharacter: 'D',
          handleClearsText: true,
          handleIsCentered: true,
          firstCharacterHitByHandle: false,
        },
        mobile: {
          firstCharacterInset: 44,
          horizontalOverflow: false,
        },
        clickMovesCursorAfterFirstCharacter: true,
      })
    } finally {
      await page.viewport(1280, 800)
    }
  })

  it('keeps the cursor with a Markdown block moved by Alt plus Down', async () => {
    const markdownText = 'one\n\ntwo\n\nthree\n\nfour\n'
    const doc = new Y.Doc()
    setBody(doc, markdownText)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const viewRef: { current: EditorView | null } = { current: null }
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
    const view = viewRef.current
    if (view === null) throw new Error('The markdown editor did not mount')
    cleanups.push(() => {
      act(() => {
        root.unmount()
      })
      history.destroy()
      doc.destroy()
      host.remove()
    })

    view.dispatch({
      selection: EditorSelection.cursor(markdownText.indexOf('two') + 1),
    })
    view.focus()
    await act(async () => {
      await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}')
      await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}')
    })

    const readOutput = () => ({
      body: body.toJSON(),
      cursor: view.state.selection.main.head,
    })
    expect(readOutput()).toEqual({
      body: 'one\n\nthree\n\nfour\n\ntwo\n',
      cursor: 'one\n\nthree\n\nfour\n\ntwo\n'.indexOf('two') + 1,
    })
  })

  it('undoes two sentence splits around an Alt plus Down move', async () => {
    const initial = 'First sentence. Second sentence.\n\nThird paragraph.\n'
    const doc = new Y.Doc()
    setBody(doc, initial)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const viewRef: { current: EditorView | null } = { current: null }
    act(() => {
      root.render(
        createElement(MarkdownEditor, {
          extensions: [createOutlineEditorExtension(history)],
          history,
          initialSelection: { anchor: initial.indexOf('Second sentence') - 1 },
          onViewChange: (view: EditorView | null) => {
            viewRef.current = view
          },
          text: body,
        }),
      )
    })
    const view = viewRef.current
    if (view === null) throw new Error('The markdown editor did not mount')
    cleanups.push(() => {
      act(() => {
        root.unmount()
      })
      history.destroy()
      doc.destroy()
      host.remove()
    })

    view.focus()
    await act(async () => {
      await userEvent.keyboard('{Enter}')
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 550)
      })
      await userEvent.keyboard('{Enter}')
      await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}')
    })
    const afterMove = body.toJSON()
    const modifier = navigator.platform.includes('Mac') ? 'Meta' : 'Control'
    const undoResults: string[] = []
    await act(async () => {
      for (let count = 0; count < 3; count += 1) {
        await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
        undoResults.push(body.toJSON())
      }
    })

    const readOutput = () => ({
      afterMove,
      undoResults,
      body: body.toJSON(),
      editor: view.state.doc.toString(),
    })
    expect(readOutput()).toEqual({
      afterMove: 'First sentence.\n\nThird paragraph.\n\nSecond sentence.\n',
      undoResults: [
        'First sentence.\n\nSecond sentence.\n\nThird paragraph.\n',
        'First sentence.\nSecond sentence.\n\nThird paragraph.\n',
        initial,
      ],
      body: initial,
      editor: initial,
    })
  })

  it('undoes deletion and movement of adjacent paragraphs newest first', async () => {
    const initial = 'abc\n\nfirst para\n'
    const doc = new Y.Doc()
    setBody(doc, initial)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const viewRef: { current: EditorView | null } = { current: null }
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
    const view = viewRef.current
    if (view === null) throw new Error('The markdown editor did not mount')
    cleanups.push(() => {
      act(() => {
        root.unmount()
      })
      history.destroy()
      doc.destroy()
      host.remove()
    })

    view.dispatch({ selection: EditorSelection.range(0, 2) })
    view.focus()
    await act(async () => {
      await userEvent.keyboard('{Backspace}')
    })
    const afterPrefixDeletion = body.toJSON()
    view.dispatch({
      selection: EditorSelection.cursor(
        afterPrefixDeletion.indexOf('first para') + 1,
      ),
    })
    await act(async () => {
      await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}')
    })
    const afterMove = body.toJSON()
    const cIndex = afterMove.indexOf('c')
    view.dispatch({ selection: EditorSelection.range(cIndex, cIndex + 1) })
    await act(async () => {
      await userEvent.keyboard('{Backspace}')
    })
    const afterFinalDeletion = body.toJSON()
    const modifier = navigator.platform.includes('Mac') ? 'Meta' : 'Control'
    const undoResults: string[] = []
    await act(async () => {
      for (let count = 0; count < 3; count += 1) {
        await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
        undoResults.push(body.toJSON())
      }
    })

    const readOutput = () => ({
      afterPrefixDeletion,
      afterMove,
      afterFinalDeletion,
      undoResults,
      body: body.toJSON(),
      editor: view.state.doc.toString(),
    })
    expect(readOutput()).toEqual({
      afterPrefixDeletion: 'c\n\nfirst para\n',
      afterMove: 'first para\n\nc\n',
      afterFinalDeletion: 'first para\n\n\n',
      undoResults: ['first para\n\nc\n', 'c\n\nfirst para\n', initial],
      body: initial,
      editor: initial,
    })
  })

  it('consumes Alt plus Down when there is no following block', async () => {
    const markdownText = 'first\n\nlast\n'
    const doc = new Y.Doc()
    setBody(doc, markdownText)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const viewRef: { current: EditorView | null } = { current: null }
    let lowerPriorityHandlerRan = false
    act(() => {
      root.render(
        createElement(MarkdownEditor, {
          extensions: [
            createOutlineEditorExtension(history),
            Prec.high(
              keymap.of([
                {
                  key: 'Alt-ArrowDown',
                  run: () => {
                    lowerPriorityHandlerRan = true
                    return true
                  },
                },
              ]),
            ),
          ],
          history,
          onViewChange: (view: EditorView | null) => {
            viewRef.current = view
          },
          text: body,
        }),
      )
    })
    const view = viewRef.current
    if (view === null) throw new Error('The markdown editor did not mount')
    cleanups.push(() => {
      act(() => {
        root.unmount()
      })
      history.destroy()
      doc.destroy()
      host.remove()
    })

    const cursor = markdownText.indexOf('last') + 2
    view.dispatch({ selection: EditorSelection.cursor(cursor) })
    view.focus()
    await act(async () => {
      await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}')
    })

    const readOutput = () => ({
      body: body.toJSON(),
      cursor: view.state.selection.main.head,
      lowerPriorityHandlerRan,
    })
    expect(readOutput()).toEqual({
      body: markdownText,
      cursor,
      lowerPriorityHandlerRan: false,
    })
  })

  it('moves headings up, down, and under another heading from the move menu', async () => {
    const markdownText =
      '# Alpha\n\nFirst section.\n\n# Beta\n\nSecond section.\n\n# Gamma\n\nThird section.\n'
    const doc = new Y.Doc()
    setBody(doc, markdownText)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const editorHost = document.createElement('div')
    const outlineHost = document.createElement('div')
    document.body.append(editorHost, outlineHost)
    const view = new EditorView({
      parent: editorHost,
      state: EditorState.create({ doc: markdownText }),
    })
    const root = createRoot(outlineHost)
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
    const menuCursor = markdownText.indexOf('Third section.') + 3
    act(() => {
      view.dispatch({ selection: EditorSelection.cursor(menuCursor) })
    })
    const betaHandle = outlineHost.querySelector<HTMLButtonElement>(
      'button[aria-label="Move Beta"]',
    )
    if (!betaHandle) throw new Error('The Beta move button is missing')
    const handleHeight = betaHandle.getBoundingClientRect().height
    await act(async () => {
      await userEvent.click(betaHandle)
    })
    const clickOpensMenu = document.body.querySelector('[role="menu"]') !== null
    const cursorAfterMenuOpen = view.state.selection.main.head
    const moveUp = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === 'Move up')
    if (!moveUp) throw new Error('The move up menu item is missing')
    await act(async () => {
      await userEvent.click(moveUp)
    })
    const afterMoveUp = body.toJSON()
    const cursorAfterMoveUp = view.state.selection.main.head

    const betaHandleAfterMoveUp = outlineHost.querySelector<HTMLButtonElement>(
      'button[aria-label="Move Beta"]',
    )
    if (!betaHandleAfterMoveUp)
      throw new Error('The Beta move button is missing after moving up')
    await act(async () => {
      await userEvent.click(betaHandleAfterMoveUp)
    })
    const moveDown = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === 'Move down')
    if (!moveDown) throw new Error('The move down menu item is missing')
    await act(async () => {
      await userEvent.click(moveDown)
    })
    const afterMoveDown = body.toJSON()

    const betaHandleAfterMoveDown =
      outlineHost.querySelector<HTMLButtonElement>(
        'button[aria-label="Move Beta"]',
      )
    if (!betaHandleAfterMoveDown)
      throw new Error('The Beta move button is missing after moving down')
    await act(async () => {
      await userEvent.click(betaHandleAfterMoveDown)
    })
    const makeChild = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === 'Make child')
    if (!makeChild) throw new Error('The make child menu item is missing')
    await act(async () => {
      await userEvent.click(makeChild)
    })
    const afterMakeChild = body.toJSON()

    const gammaHandle = outlineHost.querySelector<HTMLButtonElement>(
      'button[aria-label="Move Gamma"]',
    )
    if (!gammaHandle)
      throw new Error('The Gamma move button is missing after the moves')
    gammaHandle.focus()
    await act(async () => {
      await userEvent.keyboard('{Enter}')
    })

    const readOutput = () => ({
      clickOpensMenu,
      handleHeight,
      cursorAfterMenuOpen,
      afterMoveUp,
      cursorAfterMoveUp,
      afterMoveDown,
      afterMakeChild,
      enterOpensMenu: document.body.querySelector('[role="menu"]') !== null,
      body: body.toJSON(),
    })
    expect(readOutput()).toEqual({
      clickOpensMenu: true,
      handleHeight: 44,
      cursorAfterMenuOpen: menuCursor,
      afterMoveUp:
        '# Beta\n\nSecond section.\n\n# Alpha\n\nFirst section.\n\n# Gamma\n\nThird section.\n',
      cursorAfterMoveUp: menuCursor,
      afterMoveDown: markdownText,
      afterMakeChild:
        '# Alpha\n\nFirst section.\n\n## Beta\n\nSecond section.\n\n# Gamma\n\nThird section.\n',
      enterOpensMenu: true,
      body: '# Alpha\n\nFirst section.\n\n## Beta\n\nSecond section.\n\n# Gamma\n\nThird section.\n',
    })
  })

  it('keeps the editor cursor and move error when an H6 menu action is rejected', async () => {
    const markdownText =
      '###### Alpha\n\nFirst section.\n\n###### Beta\n\nSecond section.\n'
    const doc = new Y.Doc()
    setBody(doc, markdownText)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const editorHost = document.createElement('div')
    const outlineHost = document.createElement('div')
    document.body.append(editorHost, outlineHost)
    const view = new EditorView({
      parent: editorHost,
      state: EditorState.create({ doc: markdownText }),
    })
    const root = createRoot(outlineHost)
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
    const cursor = markdownText.indexOf('First section.') + 4
    act(() => {
      view.dispatch({ selection: EditorSelection.cursor(cursor) })
    })
    const betaHandle = outlineHost.querySelector<HTMLButtonElement>(
      'button[aria-label="Move Beta"]',
    )
    if (!betaHandle) throw new Error('The Beta move button is missing')
    await act(async () => {
      await userEvent.click(betaHandle)
    })
    const menuOpened = document.body.querySelector('[role="menu"]') !== null
    const cursorAfterOpen = view.state.selection.main.head
    const makeChild = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === 'Make child')
    if (!makeChild) throw new Error('The make child menu item is missing')
    await act(async () => {
      await userEvent.click(makeChild)
    })
    const readOutput = () => ({
      menuOpened,
      cursorAfterOpen,
      cursorAfterRejectedMove: view.state.selection.main.head,
      body: body.toJSON(),
      error: outlineHost.querySelector('[role="alert"]')?.textContent,
    })
    expect(readOutput()).toEqual({
      menuOpened: true,
      cursorAfterOpen: cursor,
      cursorAfterRejectedMove: cursor,
      body: markdownText,
      error: 'Heading levels must be between 1 and 6',
    })
  })

  it('ignores an outline drop onto its own heading', () => {
    const markdownText =
      '# Alpha\n\nFirst section.\n\n# Beta\n\nSecond section.\n'
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
      state: EditorState.create({ doc: markdownText }),
    })
    const root = createRoot(outlineHost)
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
    const alphaHandle = outlineHost.querySelector<HTMLButtonElement>(
      'button[aria-label="Move Alpha"]',
    )
    const alphaOption = outlineHost.querySelector<HTMLElement>(
      '[aria-label="Alpha"]',
    )
    const alphaRow = alphaOption?.parentElement
    if (!alphaHandle || !alphaRow)
      throw new Error('The Alpha row or move handle is missing')
    act(() => {
      dispatchDrag(alphaHandle, alphaRow)
    })

    const readOutput = () => ({
      body: body.toJSON(),
      error: outlineHost.querySelector('[role="alert"]')?.textContent,
      moveCalls: moveSpy.mock.calls.map(([input]) => input),
    })
    expect(readOutput()).toEqual({
      body: markdownText,
      error: undefined,
      moveCalls: [],
    })
  })

  it.each([
    {
      placement: 'before',
      offset: 0,
      expectedBody:
        '# Wrapup\n\nThird section.\n\n# Overview\n\nFirst section.\n\n# Details\n\nSecond section.\n',
    },
    {
      placement: 'after',
      offset: 60,
      expectedBody:
        '# Overview\n\nFirst section.\n\n# Wrapup\n\nThird section.\n\n# Details\n\nSecond section.\n',
    },
  ])(
    'moves a heading to the $placement outline drop zone',
    ({ offset, expectedBody }) => {
      const markdownText =
        '# Overview\n\nFirst section.\n\n# Details\n\nSecond section.\n\n# Wrapup\n\nThird section.\n'
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
            yCollab(body, null, { undoManager: false }),
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
      const wrapupHandle = handles[2]
      const overviewRow = outlineHost.querySelector<HTMLElement>(
        '[aria-label="Overview"]',
      )
      if (wrapupHandle === undefined || overviewRow === null)
        throw new Error('The outline drag source or target is missing')
      const overviewContainer = overviewRow.parentElement
      if (overviewContainer === null)
        throw new Error('The outline drop target has no container')
      overviewContainer.style.height = '80px'
      const bounds = overviewContainer.getBoundingClientRect()
      const dropPosition = new DOMRect(
        bounds.left,
        bounds.top + offset,
        bounds.width,
        20,
      )
      act(() => {
        dispatchDrag(wrapupHandle, overviewContainer, dropPosition)
      })

      const readOutput = () => ({
        body: body.toJSON(),
        editor: view.state.doc.toString(),
        moveCalls: moveSpy.mock.calls.map(([input]) => input),
      })
      expect(readOutput()).toEqual({
        body: expectedBody,
        editor: expectedBody,
        moveCalls: [
          {
            from: markdownText.indexOf('# Wrapup'),
            destination: offset === 0 ? 0 : markdownText.indexOf('# Details'),
          },
        ],
      })
    },
  )

  it('undoes, redoes, then undoes an Alt plus Up section move', async () => {
    const initial = '# Alpha\n\nFirst.\n\n# Beta\n\nSecond.\n'
    const doc = new Y.Doc()
    setBody(doc, initial)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const userEvents: string[] = []
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
          extensions: [
            createOutlineEditorExtension(history),
            EditorView.updateListener.of((update) => {
              for (const transaction of update.transactions) {
                const userEvent = transaction.annotation(Transaction.userEvent)
                if (userEvent !== undefined && userEvent.length > 0)
                  userEvents.push(userEvent)
              }
            }),
          ],
          history,
          onViewChange: (view: EditorView | null) => {
            viewRef.current = view
          },
          text: body,
        }),
      )
    })

    const view = viewRef.current
    if (view === null) throw new Error('The markdown editor did not mount')
    const headingLineEnd = initial.indexOf('# Beta') + '# Beta'.length
    view.dispatch({
      selection: EditorSelection.cursor(headingLineEnd),
    })
    view.focus()
    await act(async () => {
      await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}')
    })
    const afterMove = body.toJSON()
    const moveSucceeded = afterMove !== initial
    const modifier = navigator.platform.includes('Mac') ? 'Meta' : 'Control'
    await act(async () => {
      await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
    })
    const afterUndo = body.toJSON()
    await act(async () => {
      await userEvent.keyboard(`{${modifier}>}{Shift>}Z{/Shift}{/${modifier}}`)
    })
    const afterShiftRedo = body.toJSON()
    await act(async () => {
      await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
    })
    const afterSecondUndo = body.toJSON()
    await act(async () => {
      await userEvent.keyboard(`{${modifier}>}y{/${modifier}}`)
    })

    const readOutput = () => ({
      moveSucceeded,
      afterMove,
      afterUndo,
      afterShiftRedo,
      afterSecondUndo,
      body: body.toJSON(),
      editor: view.state.doc.toString(),
      userEvents,
    })
    expect(readOutput()).toEqual({
      moveSucceeded: true,
      afterMove: '# Beta\n\nSecond.\n\n# Alpha\n\nFirst.\n',
      afterUndo: initial,
      afterShiftRedo: '# Beta\n\nSecond.\n\n# Alpha\n\nFirst.\n',
      afterSecondUndo: initial,
      body: '# Beta\n\nSecond.\n\n# Alpha\n\nFirst.\n',
      editor: '# Beta\n\nSecond.\n\n# Alpha\n\nFirst.\n',
      userEvents: ['move', 'undo', 'redo', 'undo', 'redo'],
    })
  })

  it('undoes, redoes, then undoes an Alt plus Up paragraph move', async () => {
    const initial =
      '# Alpha\n\nFirst paragraph.\n\n# Beta\n\nSecond paragraph.\n\nThird paragraph.\n'
    const doc = new Y.Doc()
    setBody(doc, initial)
    const body = getBody(doc)
    const history = createMoveHistory(doc)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
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

    const view = viewRef.current
    if (view === null) throw new Error('The markdown editor did not mount')
    view.dispatch({
      selection: EditorSelection.cursor(initial.indexOf('Third paragraph') + 2),
    })
    view.focus()
    await act(async () => {
      await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}')
    })
    const afterMove = body.toJSON()
    const modifier = navigator.platform.includes('Mac') ? 'Meta' : 'Control'
    await act(async () => {
      await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
    })
    const afterUndo = body.toJSON()
    await act(async () => {
      await userEvent.keyboard(`{${modifier}>}{Shift>}Z{/Shift}{/${modifier}}`)
    })
    const afterRedo = body.toJSON()
    await act(async () => {
      await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
    })

    const readOutput = () => ({
      afterMove,
      afterUndo,
      afterRedo,
      afterSecondUndo: body.toJSON(),
      editor: view.state.doc.toString(),
    })
    expect(readOutput()).toEqual({
      afterMove:
        '# Alpha\n\nFirst paragraph.\n\n# Beta\n\nThird paragraph.\n\nSecond paragraph.\n',
      afterUndo: initial,
      afterRedo:
        '# Alpha\n\nFirst paragraph.\n\n# Beta\n\nThird paragraph.\n\nSecond paragraph.\n',
      afterSecondUndo: initial,
      editor: initial,
    })
  })
})
