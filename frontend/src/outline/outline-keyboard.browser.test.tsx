import type { EditorView } from '@codemirror/view'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import * as Y from 'yjs'

import { getBody, setBody } from '#article/index'
import { MarkdownEditor } from '#components/markdown-editor'
import { ArticleOutline, createMoveHistory } from '#outline/index'

const initialBody = '# A\nu\n## B\nv\n## C\nw\n# D\n'

let host: HTMLDivElement
let root: Root
let doc: Y.Doc
let view: EditorView
let history: ReturnType<typeof createMoveHistory>

const input = () =>
  host.querySelector<HTMLInputElement>('input[aria-label="見出しを編集"]')

const press = async (init: KeyboardEventInit) => {
  await act(async () => {
    ;(input() ?? window).dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    )
    await Promise.resolve()
  })
}

const enterOutline = () => press({ key: '1', metaKey: true })

const type = async (value: string) => {
  const element = input()
  if (!element) throw new Error('The heading input is not shown')
  await act(async () => {
    await userEvent.fill(element, value)
  })
}

const snapshot = () => ({
  body: getBody(doc).toJSON(),
  selected: input()?.value ?? null,
  focused: document.activeElement === input(),
})

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  doc = new Y.Doc()
  setBody(doc, initialBody)
  history = createMoveHistory(doc)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const mounted: { view?: EditorView | null } = {}
  const render = () => {
    root.render(
      createElement('div', null, [
        createElement(MarkdownEditor, {
          history,
          key: 'editor',
          onViewChange: (next: EditorView | null) => {
            mounted.view = next
          },
          text: getBody(doc),
        }),
        mounted.view
          ? createElement(ArticleOutline, {
              doc,
              history,
              key: 'outline',
              view: mounted.view,
            })
          : null,
      ]),
    )
  }
  act(render)
  act(render)
  if (!mounted.view) throw new Error('The markdown editor did not mount')
  view = mounted.view
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  history.destroy()
  doc.destroy()
  host.remove()
  vi.unstubAllGlobals()
})

describe('outline keyboard editing', () => {
  it('enters the outline with mod+1 on the heading at the cursor', async () => {
    await enterOutline()

    expect(snapshot()).toEqual({
      body: initialBody,
      selected: 'A',
      focused: true,
    })
  })

  it('selects headings with the arrow keys and stops at both ends', async () => {
    await enterOutline()
    const seen: Array<string | null> = []
    for (const key of [
      'ArrowUp',
      'ArrowDown',
      'ArrowDown',
      'ArrowDown',
      'ArrowDown',
    ]) {
      await press({ key })
      seen.push(snapshot().selected)
    }

    expect(seen).toEqual(['A', 'B', 'C', 'D', 'D'])
  })

  it('renames the heading when leaving it, as a single undo step', async () => {
    await enterOutline()
    await type('Renamed')
    await press({ key: 'ArrowDown' })
    const renamed = snapshot()
    await press({ key: 'z', metaKey: true })

    const readResult = () => ({ renamed, undone: snapshot().body })

    expect(readResult()).toEqual({
      renamed: {
        body: '# Renamed\nu\n## B\nv\n## C\nw\n# D\n',
        selected: 'B',
        focused: true,
      },
      undone: initialBody,
    })
  })

  it('does not reapply a renamed draft after undoing it', async () => {
    await enterOutline()
    await type('Renamed')
    await press({ key: 'ArrowDown' })
    await press({ key: 'ArrowUp' })
    await press({ key: 'z', metaKey: true })
    await press({ key: 'ArrowDown' })

    expect(snapshot().body).toBe(initialBody)
  })

  it('adds a heading below and selects it, as a single undo step', async () => {
    await enterOutline()
    await press({ key: 'ArrowDown' })
    await press({ key: 'ArrowDown' })
    await press({ key: 'Enter' })
    const added = snapshot()
    await press({ key: 'z', metaKey: true })

    const readResult = () => ({ added, undone: snapshot().body })

    expect(readResult()).toEqual({
      added: {
        body: '# A\nu\n## B\nv\n## C\nw\n## \n# D\n',
        selected: '',
        focused: true,
      },
      undone: initialBody,
    })
  })

  it('deletes a heading and keeps its paragraph, as a single undo step', async () => {
    await enterOutline()
    await press({ key: 'ArrowDown' })
    await press({ key: 'Backspace', metaKey: true })
    const deleted = snapshot()
    await press({ key: 'z', metaKey: true })

    const readResult = () => ({ deleted, undone: snapshot().body })

    expect(readResult()).toEqual({
      deleted: {
        body: '# A\nu\nv\n## C\nw\n# D\n',
        selected: 'A',
        focused: true,
      },
      undone: initialBody,
    })
  })

  it.each([
    [
      'indents under the previous sibling',
      { key: 'Tab' },
      2,
      '# A\nu\n## B\nv\n\n### C\nw\n\n# D\n',
    ],
    [
      'outdents after the parent section',
      { key: 'Tab', shiftKey: true },
      1,
      '# A\nu\n## C\nw\n\n# B\nv\n\n# D\n',
    ],
    [
      'moves the section up with its children',
      { key: 'ArrowUp', altKey: true },
      2,
      '# A\nu\n\n## C\nw\n\n## B\nv\n# D\n',
    ],
  ] as const)(
    '%s and keeps it selected, undoable once',
    async (_case, init, row, expected) => {
      await enterOutline()
      for (let step = 0; step < row; step += 1)
        await press({ key: 'ArrowDown' })
      const selected = snapshot().selected
      await press(init)
      const moved = snapshot()
      await press({ key: 'z', metaKey: true })

      const readResult = () => ({ moved, undone: snapshot().body })

      expect(readResult()).toEqual({
        moved: { body: expected, selected, focused: true },
        undone: initialBody,
      })
    },
  )

  it('returns to the body with Escape after applying the draft', async () => {
    await enterOutline()
    await type('Renamed')
    await press({ key: 'Escape' })

    expect(snapshot()).toEqual({
      body: '# Renamed\nu\n## B\nv\n## C\nw\n# D\n',
      selected: null,
      focused: false,
    })
    expect(view.hasFocus).toBe(true)
  })

  it('leaves the outline and applies the draft when focus moves away', async () => {
    await enterOutline()
    await type('Renamed')
    act(() => {
      input()?.blur()
    })

    expect(snapshot()).toEqual({
      body: '# Renamed\nu\n## B\nv\n## C\nw\n# D\n',
      selected: null,
      focused: false,
    })
  })
})
