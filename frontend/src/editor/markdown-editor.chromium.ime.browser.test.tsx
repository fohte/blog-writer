import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cdp } from 'vitest/browser'
import * as Y from 'yjs'

import { getBody } from '#article/body'
import { MarkdownEditor } from '#editor/index'

let host: HTMLDivElement | undefined
let root: Root | undefined
let doc = new Y.Doc()

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  doc.destroy()
  doc = new Y.Doc()
  getBody(doc).insert(0, '**word')

  act(() => {
    root?.render(<MarkdownEditor text={getBody(doc)} />)
  })
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  doc.destroy()
  root = undefined
  host?.remove()
  host = undefined
  doc = new Y.Doc()
  vi.unstubAllGlobals()
})

describe('MarkdownEditor IME in Chromium', () => {
  it('keeps source markup visible during Japanese composition and commits it once', async () => {
    const content = host?.querySelector<HTMLElement>('.cm-content')
    content?.focus()
    content?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    )

    await cdp().send('Input.imeSetComposition', {
      text: '**日本語',
      selectionStart: 5,
      selectionEnd: 5,
    })
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve()
      })
    })

    const composingOutput = {
      body: getBody(doc).toJSON(),
      visible: content?.textContent,
    }
    await cdp().send('Input.insertText', { text: '**日本語' })
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve()
      })
    })

    const readOutput = () => ({
      duringComposition: composingOutput,
      committedBody: getBody(doc).toJSON(),
      committedVisible: content?.textContent,
    })

    expect(readOutput()).toEqual({
      duringComposition: { body: '**word**日本語', visible: '**word**日本語' },
      committedBody: '**word**日本語',
      committedVisible: 'word日本語',
    })
  })
})
