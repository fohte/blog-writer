import '#index.css'

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
    const handles = [
      ...view.dom.querySelectorAll<HTMLButtonElement>('.cm-block-drag-handle'),
    ]
    const readFocus = () => {
      const active = document.activeElement
      if (active === before) return 'before'
      if (active === content) return 'body'
      if (active === after) return 'after'
      const handle =
        active instanceof Element
          ? active.closest<HTMLButtonElement>('.cm-block-drag-handle')
          : null
      return handle ? `handle:${String(handles.indexOf(handle))}` : 'other'
    }

    before.focus()
    const focusSequence = [readFocus()]
    await userEvent.keyboard('{Tab}')
    focusSequence.push(readFocus())
    await userEvent.keyboard('{Tab}')
    focusSequence.push(readFocus())
    await userEvent.keyboard('{ArrowDown}')
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
      focusSequence: ['before', 'body', 'handle:0', 'handle:1', 'after'],
      tabbableHandles: [String(source.indexOf('Second'))],
    })
  })
})
