import '#index.css'

import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'

import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'
import { blockStarts } from '#outline/block-ranges'

const tableSource = '| Feature | Offline |\n| --- | --- |\n| Tables | Yes |'
const imageSource =
  "![Sample](data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1'%20height='1'%3E%3C/svg%3E)"
const mermaidSource = '```mermaid\ngraph LR\n  Draft --> Preview\n```'
const controls: (HTMLElement | (() => void))[] = []

function blockHandlePositionDOM(button: HTMLButtonElement): HTMLElement | null {
  return (
    button.closest<HTMLElement>('.cm-markdown-block-widget') ??
    button.closest<HTMLElement>('.cm-block-drag-handle-wrapper')
  )
}

function blockHandleAt(
  view: EditorView,
  from: number,
): HTMLButtonElement | undefined {
  const starts = blockStarts(view.state)
  const index = starts.indexOf(from)
  return index < 0
    ? undefined
    : [
        ...view.dom.querySelectorAll<HTMLButtonElement>(
          '.cm-block-drag-handle',
        ),
      ][index]
}

function blockHandleFromDOM(
  view: EditorView,
  button: HTMLButtonElement,
): number | undefined {
  const positionDOM = blockHandlePositionDOM(button)
  if (positionDOM === null) return undefined
  const position = view.posAtDOM(positionDOM, -1)
  const starts = blockStarts(view.state)
  return (
    starts.find((from) => from === position) ??
    starts.filter((from) => from < position).at(-1)
  )
}

afterEach(() => {
  for (const control of controls) {
    if (typeof control === 'function') control()
    else control.remove()
  }
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
        ].find((candidate) => candidate.textContent.endsWith(name))
        const handle = blockHandleAt(view, source.indexOf(name))
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
        (candidate) => candidate.textContent.endsWith('after'),
      )
      const handle = blockHandleAt(view, source.indexOf('after'))
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

  it('keeps the main inline handle order in the native Tab sequence', async () => {
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
      const position = handle ? blockHandleFromDOM(view, handle) : undefined
      return position === undefined ? 'other' : 'handle:' + String(position)
    }

    before.focus()
    const focusSequence = [readFocus()]
    await userEvent.keyboard('{Tab}')
    focusSequence.push(readFocus())
    await userEvent.keyboard('{Tab}')
    focusSequence.push(readFocus())
    await userEvent.keyboard('{Tab}')
    focusSequence.push(readFocus())
    await userEvent.keyboard('{Tab}')
    focusSequence.push(readFocus())

    const readOutput = () => ({
      body: body.toJSON(),
      focusSequence,
      handleCount: view.dom.querySelectorAll('.cm-block-drag-handle').length,
    })
    expect(readOutput()).toEqual({
      body: source,
      focusSequence: ['before', 'body', 'handle:0', 'handle:18', 'after'],
      handleCount: 2,
    })
  })

  it('keeps focus in the editor controls when Tab is pressed in a long scrolling body', async () => {
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
    await vi.waitUntil(() => scrollContainer.scrollTop > 0)
    view.focus()
    await userEvent.keyboard('{Tab}')

    const readOutput = () => ({
      body: body.toJSON(),
      caretParagraph: view.state.doc.lineAt(view.state.selection.main.head)
        .text,
      activeElement: document.activeElement?.className ?? null,
      focusedBody: document.activeElement === document.body,
      initialScrollTop: scrollContainer.scrollTop > 0,
    })
    expect(readOutput()).toEqual({
      body: source,
      caretParagraph: `Paragraph ${String(currentParagraph)}.`,
      activeElement: 'cm-block-drag-handle',
      focusedBody: false,
      initialScrollTop: true,
    })
  })
})
