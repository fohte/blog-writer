import type { EditorView } from '@codemirror/view'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { getBody, setBody } from '#article/index'
import { MarkdownEditor } from '#components/markdown-editor'
import { ArticleOutline, createMoveHistory } from '#outline/index'

const initialBody = '# A\nu\n## B\nv\n## C\nw\n# D\n'

let host: HTMLDivElement
let root: Root
let doc: Y.Doc
let history: ReturnType<typeof createMoveHistory>
let headingSelected: ReturnType<typeof vi.fn<() => void>>

const click = async (selector: string) => {
  const element = host.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`Missing element: ${selector}`)
  await act(async () => {
    element.click()
    await Promise.resolve()
  })
}

const tapRow = (text: string) => click(`[role="option"][aria-label="${text}"]`)
const tapAction = (label: string) => click(`button[aria-label="${label}"]`)

const snapshot = () => ({
  body: getBody(doc).toJSON(),
  selected:
    host
      .querySelector('[role="option"][aria-selected="true"]')
      ?.getAttribute('aria-label') ?? null,
  disabled: [
    ...host.querySelectorAll<HTMLButtonElement>(
      '[role="toolbar"][aria-label="見出しの操作"] button:disabled',
    ),
  ].map((button) => button.getAttribute('aria-label')),
  navigated: headingSelected.mock.calls.length,
})

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  doc = new Y.Doc()
  setBody(doc, initialBody)
  history = createMoveHistory(doc)
  headingSelected = vi.fn<() => void>()
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
              mobile: true,
              onHeadingSelected: headingSelected,
              view: mounted.view,
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

describe('outline heading actions on a phone', () => {
  it('selects another heading on the first tap and opens it on the second', async () => {
    await tapRow('C')
    const selected = snapshot()
    await tapRow('C')
    const readResult = () => ({ selected, opened: snapshot().navigated })

    expect(readResult()).toEqual({
      selected: {
        body: initialBody,
        selected: 'C',
        disabled: ['配下ごと下へ'],
        navigated: 0,
      },
      opened: 1,
    })
  })

  it('disables the actions a first top-level heading cannot take', () => {
    expect(snapshot()).toEqual({
      body: initialBody,
      selected: 'A',
      disabled: ['階層を上げる', '階層を下げる', '配下ごと上へ'],
      navigated: 0,
    })
  })

  it.each([
    ['階層を上げる', 'B', '# A\nu\n## C\nw\n\n# B\nv\n\n# D\n'],
    ['階層を下げる', 'C', '# A\nu\n## B\nv\n\n### C\nw\n\n# D\n'],
    ['配下ごと上へ', 'C', '# A\nu\n\n## C\nw\n\n## B\nv\n# D\n'],
    ['配下ごと下へ', 'B', '# A\nu\n## C\nw\n\n## B\nv\n\n# D\n'],
    ['見出しを消す', 'C', '# A\nu\n## B\nv\nw\n# D\n'],
  ])('%s on %s reverts with one undo', async (label, row, expected) => {
    await tapRow(row)
    await tapAction(label)
    const changed = snapshot().body
    await tapAction('取り消す')
    const readResult = () => ({ changed, undone: snapshot().body })

    expect(readResult()).toEqual({ changed: expected, undone: initialBody })
  })
})
