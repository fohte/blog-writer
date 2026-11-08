import '#index.css'

import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'

import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'

const tableSource = '| Feature | Offline |\n| --- | --- |\n| Tables | Yes |'
const imageSource =
  "![Sample](data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1'%20height='1'%3E%3C/svg%3E)"
const mermaidSource = '```mermaid\ngraph LR\n  Draft --> Preview\n```'
const controls: HTMLElement[] = []

afterEach(() => {
  for (const control of controls) control.remove()
  controls.length = 0
})

describe('Markdown block widget layout', () => {
  it('keeps block handles aligned with lines after rendered widgets', async () => {
    const source = [
      'p1',
      '',
      imageSource,
      '',
      'p2',
      '',
      mermaidSource,
      '',
      'p3',
      '',
      imageSource,
      '',
      'p4',
      '',
      tableSource,
      '',
      'end',
    ].join('\n')
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      showMoveHandles: true,
    })
    if (!content) throw new Error('The editor did not mount')
    const mountedView = EditorView.findFromDOM(content)
    if (!mountedView) throw new Error('The editor view did not mount')
    const view = mountedView
    await vi.waitUntil(() => content.querySelector('figure svg') !== null)

    const lineNames = ['p2', 'p3', 'p4', 'end']
    const readOffsets = () =>
      lineNames.map((name) => {
        const line = [
          ...content.querySelectorAll<HTMLElement>('.cm-line'),
        ].find((candidate) => candidate.textContent === name)
        const handle = [
          ...view.dom.querySelectorAll<HTMLButtonElement>(
            '.cm-block-drag-handle',
          ),
        ].find(
          (candidate) =>
            candidate.dataset['blockFrom'] === String(source.indexOf(name)),
        )
        if (!line || !handle)
          throw new Error(`The ${name} line handle is missing`)
        const lineRect = line.getBoundingClientRect()
        const handleRect = handle.getBoundingClientRect()
        const lineCenter = lineRect.top + lineRect.height / 2
        const handleCenter = handleRect.top + handleRect.height / 2
        return { line: name, offset: Math.round(handleCenter - lineCenter) }
      })
    await vi.waitUntil(() => readOffsets().every(({ offset }) => offset === 0))
    const offsets = readOffsets()

    const readOutput = () => ({ body: body.toJSON(), offsets })
    expect(readOutput()).toEqual({
      body: source,
      offsets: [
        { line: 'p2', offset: 0 },
        { line: 'p3', offset: 0 },
        { line: 'p4', offset: 0 },
        { line: 'end', offset: 0 },
      ],
    })
  })

  it('keeps the next handle aligned after Mermaid reports a syntax error', async () => {
    const source = [
      'before',
      '',
      '```mermaid',
      'graph LR',
      '  Draft -->',
      '```',
      '',
      'after',
    ].join('\n')
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      showMoveHandles: true,
    })
    if (!content) throw new Error('The editor did not mount')
    const mountedView = EditorView.findFromDOM(content)
    if (!mountedView) throw new Error('The editor view did not mount')
    const view = mountedView
    const readOffset = () => {
      const line = [...content.querySelectorAll<HTMLElement>('.cm-line')].find(
        (candidate) => candidate.textContent === 'after',
      )
      const handle = [
        ...view.dom.querySelectorAll<HTMLButtonElement>(
          '.cm-block-drag-handle',
        ),
      ].find(
        (candidate) =>
          candidate.dataset['blockFrom'] === String(source.indexOf('after')),
      )
      if (!line || !handle) return undefined
      const lineRect = line.getBoundingClientRect()
      const handleRect = handle.getBoundingClientRect()
      return Math.round(
        handleRect.top +
          handleRect.height / 2 -
          (lineRect.top + lineRect.height / 2),
      )
    }
    await vi.waitUntil(
      () =>
        content.querySelector('figure [role="alert"]') !== null &&
        readOffset() === 0,
    )

    const readOutput = () => ({
      body: body.toJSON(),
      errorShown: content.querySelector('figure [role="alert"]') !== null,
      offset: readOffset(),
    })
    expect(readOutput()).toEqual({
      body: source,
      errorShown: true,
      offset: 0,
    })
  })

  it('tabs through the body before one roving block handle stop', async () => {
    const source = 'First paragraph.\n\nSecond paragraph.'
    const before = document.createElement('button')
    before.textContent = 'Before editor'
    document.body.append(before)
    controls.push(before)
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      showMoveHandles: true,
    })
    const after = document.createElement('button')
    after.textContent = 'After editor'
    document.body.append(after)
    controls.push(after)
    if (!content) throw new Error('The editor did not mount')
    const mountedView = EditorView.findFromDOM(content)
    if (!mountedView) throw new Error('The editor view did not mount')
    const view = mountedView
    const readFocus = () => {
      const active = document.activeElement
      if (active === before) return 'before'
      if (active === content) return 'body'
      if (active === after) return 'after'
      const handle =
        active instanceof Element
          ? active.closest<HTMLButtonElement>('.cm-block-drag-handle')
          : null
      return handle
        ? `handle:${handle.dataset['blockFrom'] ?? 'unknown'}`
        : 'other'
    }

    before.focus()
    const focusSequence = [readFocus()]
    await userEvent.keyboard('{Tab}')
    focusSequence.push(readFocus())
    await userEvent.keyboard('{Tab}')
    focusSequence.push(readFocus())
    await userEvent.keyboard('{ArrowDown}')
    await vi.waitUntil(() => readFocus() === 'handle:18')
    focusSequence.push(readFocus())
    await userEvent.keyboard('{ArrowUp}')
    await vi.waitUntil(() => readFocus() === 'handle:0')
    focusSequence.push(readFocus())
    await userEvent.keyboard('{Tab}')
    focusSequence.push(readFocus())

    const readOutput = () => ({
      body: body.toJSON(),
      focusSequence,
      tabbableHandles: [
        ...view.dom.querySelectorAll<HTMLButtonElement>(
          '.cm-block-drag-handle',
        ),
      ]
        .filter((handle) => handle.tabIndex === 0)
        .map((handle) => handle.dataset['blockFrom']),
    })
    expect(readOutput()).toEqual({
      body: source,
      focusSequence: [
        'before',
        'body',
        'handle:0',
        'handle:18',
        'handle:0',
        'after',
      ],
      tabbableHandles: [String(source.indexOf('First'))],
    })
  })

  it('keeps Tab and arrow focus on the current block in a long scrolling body', async () => {
    const paragraphs = Array.from(
      { length: 300 },
      (_, index) => `Paragraph ${String(index + 1)}.`,
    )
    const source = paragraphs.join('\n\n')
    const currentParagraph = 40
    const currentFrom = source.indexOf(`Paragraph ${String(currentParagraph)}.`)
    const currentPosition = currentFrom + 1
    const scrollContainer = document.createElement('main')
    scrollContainer.style.height = '24rem'
    scrollContainer.style.overflowY = 'auto'
    const bodyPanel = document.createElement('div')
    bodyPanel.style.padding = '40px 32px 96px'
    scrollContainer.append(bodyPanel)
    document.body.append(scrollContainer)
    controls.push(scrollContainer)
    const { body, content } = mountMarkdownEditor(source, [], undefined, {
      className: 'min-h-96 -ms-7',
      initialSelection: { anchor: currentPosition },
      parent: bodyPanel,
      showMoveHandles: true,
    })
    if (!content) throw new Error('The editor did not mount')
    const mountedView = EditorView.findFromDOM(content)
    if (!mountedView) throw new Error('The editor view did not mount')
    const view = mountedView
    view.dispatch({
      selection: EditorSelection.cursor(currentPosition),
      effects: EditorView.scrollIntoView(currentPosition, { y: 'center' }),
    })
    await vi.waitUntil(
      () =>
        scrollContainer.scrollTop > 0 &&
        view.dom.querySelector<HTMLButtonElement>(
          `.cm-block-drag-handle[data-block-from="${String(currentFrom)}"]`,
        )?.tabIndex === 0,
    )
    const scrollTopBeforeTab = scrollContainer.scrollTop
    const currentLine = [
      ...content.querySelectorAll<HTMLElement>('.cm-line'),
    ].find(
      (line) => line.textContent === `Paragraph ${String(currentParagraph)}.`,
    )
    if (!currentLine) throw new Error('The caret paragraph is not visible')
    await userEvent.click(currentLine)
    await vi.waitUntil(
      () =>
        document.activeElement === content &&
        view.state.doc.lineAt(view.state.selection.main.head).text ===
          `Paragraph ${String(currentParagraph)}.`,
    )
    await userEvent.keyboard('{Tab}')
    const scrollTopAfterTab = scrollContainer.scrollTop
    const tabBlockFrom =
      document.activeElement instanceof HTMLButtonElement
        ? document.activeElement.dataset['blockFrom']
        : null

    const finalParagraph = currentParagraph + 24
    for (
      let paragraph = currentParagraph + 1;
      tabBlockFrom === String(currentFrom) && paragraph <= finalParagraph;
      paragraph++
    ) {
      const expectedFrom = source.indexOf(`Paragraph ${String(paragraph)}.`)
      await userEvent.keyboard('{ArrowDown}')
      await vi.waitUntil(
        () =>
          document.activeElement instanceof HTMLButtonElement &&
          document.activeElement.dataset['blockFrom'] === String(expectedFrom),
      )
    }

    const readOutput = () => ({
      body: body.toJSON(),
      caretParagraph: view.state.doc.lineAt(view.state.selection.main.head)
        .text,
      focusedBlockFromAfterTab: tabBlockFrom,
      focusedBlockFrom:
        document.activeElement instanceof HTMLButtonElement
          ? document.activeElement.dataset['blockFrom']
          : null,
      scrollAdvanced: scrollContainer.scrollTop > scrollTopAfterTab,
      tabStayedNearCaret: scrollTopAfterTab >= scrollTopBeforeTab - 100,
    })
    expect(readOutput()).toEqual({
      body: source,
      caretParagraph: `Paragraph ${String(currentParagraph)}.`,
      focusedBlockFromAfterTab: String(currentFrom),
      focusedBlockFrom: String(
        source.indexOf(`Paragraph ${String(finalParagraph)}.`),
      ),
      scrollAdvanced: true,
      tabStayedNearCaret: true,
    })
  })
})
