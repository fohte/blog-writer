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
let onOpenBody: ReturnType<typeof vi.fn<() => void>>

const input = () =>
  host.querySelector<HTMLInputElement>('input[aria-label="見出しを編集"]')

const press = async (init: KeyboardEventInit) => {
  await act(async () => {
    input()?.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    )
    await Promise.resolve()
  })
}

const type = async (value: string) => {
  const element = input()
  if (!element) throw new Error('The heading input is not shown')
  await act(async () => {
    await userEvent.fill(element, value)
  })
}

const clickRow = async (text: string) => {
  const row = host.querySelector<HTMLElement>(
    `[role="option"][aria-label="${text}"]`,
  )
  if (!row) throw new Error(`Missing row: ${text}`)
  await act(async () => {
    row.click()
    await Promise.resolve()
  })
}

const snapshot = () => ({
  body: getBody(doc).toJSON(),
  editing: input()?.value ?? null,
  focused: document.activeElement === input(),
  opened: onOpenBody.mock.calls.length,
})

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  doc = new Y.Doc()
  setBody(doc, initialBody)
  history = createMoveHistory(doc)
  onOpenBody = vi.fn<() => void>()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const writing = { onOpenBody }
  const mounted: { view?: EditorView | null } = {}
  const render = () => {
    root.render(
      createElement('div', null, [
        createElement(MarkdownEditor, {
          history,
          key: 'editor',
          onViewChange: (next: EditorView | null) => {
            mounted.view = next
            if (next) view = next
          },
          text: getBody(doc),
        }),
        mounted.view
          ? createElement(ArticleOutline, {
              doc,
              history,
              key: 'outline',
              view: mounted.view,
              writing,
            })
          : null,
      ]),
    )
  }
  act(render)
  act(render)
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

describe('outline mode', () => {
  it('starts editing the selected heading', () => {
    expect(snapshot()).toEqual({
      body: initialBody,
      editing: 'A',
      focused: true,
      opened: 0,
    })
  })

  it('keeps the draft in the input and commits it when focus leaves', async () => {
    await type('Z')
    const typed = snapshot()
    await act(async () => {
      input()?.blur()
      await Promise.resolve()
    })
    const readResult = () => ({ typed, left: snapshot() })

    expect(readResult()).toEqual({
      typed: { body: initialBody, editing: 'Z', focused: true, opened: 0 },
      left: {
        body: '# Z\nu\n## B\nv\n## C\nw\n# D\n',
        editing: 'Z',
        focused: false,
        opened: 0,
      },
    })
  })

  it('commits the draft and edits the row that was clicked', async () => {
    await type('Z')
    await clickRow('C')

    expect(snapshot()).toEqual({
      body: '# Z\nu\n## B\nv\n## C\nw\n# D\n',
      editing: 'C',
      focused: true,
      opened: 0,
    })
  })

  it('deletes the heading with Backspace once the row is empty', async () => {
    await clickRow('C')
    await type('')
    await press({ key: 'Backspace' })

    expect(snapshot()).toEqual({
      body: '# A\nu\n## B\nv\nw\n# D\n',
      editing: 'B',
      focused: true,
      opened: 0,
    })
  })

  it('leaves Backspace to the input while the row has text', async () => {
    await press({ key: 'Backspace' })

    expect(snapshot()).toEqual({
      body: initialBody,
      editing: 'A',
      focused: true,
      opened: 0,
    })
  })

  it.each([
    ['Mod-Enter', { key: 'Enter', metaKey: true }],
    ['Mod-Shift-O', { key: 'O', metaKey: true, shiftKey: true }],
  ])(
    '%s commits the draft and opens the body below the heading',
    async (_, init) => {
      await clickRow('B')
      await type('Z')
      await press(init)
      const readResult = () => ({
        ...snapshot(),
        cursor: view.state.selection.main.head,
      })

      expect(readResult()).toEqual({
        body: '# A\nu\n## Z\nv\n## C\nw\n# D\n',
        editing: null,
        focused: false,
        opened: 1,
        cursor: 11,
      })
    },
  )
})
