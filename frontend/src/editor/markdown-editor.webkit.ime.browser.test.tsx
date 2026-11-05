import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
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
  getBody(doc).insert(0, '[reference](https://example.test) ')

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

describe('MarkdownEditor IME in WebKit', () => {
  it('commits Japanese composition after Markdown punctuation without changing its order', async () => {
    const content = host?.querySelector<HTMLElement>('.cm-content')
    content?.focus()
    content?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    )
    content?.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    )
    content?.dispatchEvent(
      new CompositionEvent('compositionupdate', {
        bubbles: true,
        data: 'にほんご',
      }),
    )
    content?.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: '日本語',
        inputType: 'insertCompositionText',
      }),
    )

    if (content) await userEvent.type(content, '日本語')
    content?.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: '日本語' }),
    )

    const readOutput = () => ({
      body: getBody(doc).toJSON(),
      visible: content?.textContent,
    })

    expect(readOutput()).toEqual({
      body: '[reference](https://example.test) 日本語',
      visible: 'referencehttps://example.test 日本語',
    })
  })
})
