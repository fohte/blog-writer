import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'

import { getBody, setBody } from '#article/body'
import { setPremise } from '#article/premise'
import { BodyRequestAccessory, bodyRequestExtensions } from '#editor/index'
import { createMoveHistory } from '#outline/index'

const content = '# Article\n\n## Section\nRewrite this sentence.'
const cleanups: (() => void)[] = []

function createPendingFetch() {
  const signals: AbortSignal[] = []
  const resolveResponses: ((response: Response) => void)[] = []
  const fetcher: typeof fetch = (_input, init) =>
    new Promise((resolve) => {
      const signal = init?.signal
      if (!(signal instanceof AbortSignal)) {
        throw new Error('The request did not receive an abort signal')
      }
      signals.push(signal)
      resolveResponses.push(resolve)
    })
  const resolveResponse = async (index: number, replacement: string) => {
    const resolve = resolveResponses[index]
    if (!resolve) throw new Error('The request response was not captured')
    resolve(
      new Response(
        `data: ${JSON.stringify({ event: 'result', data: { replacement } })}\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    )
    await new Promise((finish) => setTimeout(finish, 0))
  }
  return { fetcher, resolveResponse, signals }
}

function createRequestEditor() {
  const doc = new Y.Doc()
  setBody(doc, content)
  setPremise(doc, 'audience', 'fictional audience')
  setPremise(doc, 'purpose', 'fictional purpose')
  setPremise(doc, 'claim', 'fictional claim')
  const body = getBody(doc)
  const history = createMoveHistory(doc)
  const editorHost = document.createElement('div')
  const accessoryHost = document.createElement('div')
  document.body.append(editorHost, accessoryHost)
  const view = new EditorView({
    parent: editorHost,
    state: EditorState.create({
      doc: body.toJSON(),
      selection: {
        anchor: content.indexOf('Rewrite'),
        head: content.indexOf('sentence.') + 'sentence.'.length,
      },
      extensions: [
        yCollab(body, null, { undoManager: false }),
        bodyRequestExtensions({ doc, history }),
      ],
    }),
  })
  const root = createRoot(accessoryHost)
  act(() => {
    root.render(
      <BodyRequestAccessory
        doc={doc}
        history={history}
        replaceBody={() => {}}
        view={view}
      />,
    )
  })
  cleanups.push(() => {
    act(() => {
      root.unmount()
    })
    view.destroy()
    history.destroy()
    doc.destroy()
    editorHost.remove()
    accessoryHost.remove()
  })
  return { body, view }
}

function pressModK(view: EditorView) {
  view.focus()
  const modifier = navigator.platform.includes('Mac') ? 'metaKey' : 'ctrlKey'
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    key: 'k',
    [modifier]: true,
  })
  view.contentDOM.dispatchEvent(event)
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  window.localStorage.clear()
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('body request', () => {
  it('shows an error without changing the article when the request fails', async () => {
    const { body, view } = createRequestEditor()
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(null, { status: 503 })),
    )

    await act(async () => {
      pressModK(view)
      await Promise.resolve()
    })
    const input = document.querySelector<HTMLInputElement>('#body-request')
    if (!input) throw new Error('The request input did not open')
    await act(async () => {
      await userEvent.fill(input, 'make it concise')
      await userEvent.keyboard('{Enter}')
      await vi.waitFor(() => {
        expect(document.querySelector('[role="alert"]')?.textContent).toEqual(
          'LLM API returned status 503',
        )
      })
    })

    const readOutput = () => ({
      body: body.toJSON(),
      error: document.querySelector('[role="alert"]')?.textContent ?? null,
      inFlight:
        view.dom.querySelector('.cm-suggestion-widget')?.textContent ?? null,
    })
    expect(readOutput()).toEqual({
      body: content,
      error: 'LLM API returned status 503',
      inFlight: null,
    })
  })

  it('opens from Mod-K, sends one request, and aborts it with Escape', async () => {
    const { body, view } = createRequestEditor()
    const { fetcher, resolveResponse, signals } = createPendingFetch()
    vi.stubGlobal('fetch', fetcher)

    await act(async () => {
      pressModK(view)
      await Promise.resolve()
    })
    const input = document.querySelector<HTMLInputElement>('#body-request')
    if (!input) throw new Error('The request input did not open')
    await act(async () => {
      await userEvent.fill(input, 'make it concise')
      await userEvent.keyboard('{Enter}')
      await vi.waitFor(() => {
        expect(signals.length).toEqual(1)
      })
    })
    const readLoadingState = () => ({
      body: body.toJSON(),
      loadingMessage:
        document.querySelector('[role="status"]')?.textContent ?? null,
    })
    expect(readLoadingState()).toEqual({
      body: content,
      loadingMessage: '作成中',
    })

    await act(async () => {
      pressModK(view)
      await Promise.resolve()
    })
    await act(async () => {
      const nextInput =
        document.querySelector<HTMLInputElement>('#body-request')
      if (!nextInput) throw new Error('The next request input did not open')
      await userEvent.fill(nextInput, 'write another version')
      await userEvent.keyboard('{Enter}')
      await vi.waitFor(() => {
        expect(signals.length).toEqual(2)
      })
    })

    await act(async () => {
      await resolveResponse(0, 'The stale response must be ignored.')
    })
    const readPendingRequest = () => ({
      body: body.toJSON(),
      suggestion:
        view.dom.querySelector('.cm-suggestion-widget')?.textContent ?? null,
      requestAborted: signals.map((signal) => signal.aborted),
    })
    expect(readPendingRequest()).toEqual({
      body: content,
      suggestion: '作成中',
      requestAborted: [true, false],
    })

    await act(async () => {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
      )
      await Promise.resolve()
    })
    await act(async () => {
      await resolveResponse(1, 'The cancelled response must be ignored.')
    })

    const readOutput = () => ({
      body: body.toJSON(),
      inFlight:
        view.dom.querySelector('.cm-suggestion-widget')?.textContent ?? null,
      requestAborted: signals.map((signal) => signal.aborted),
    })
    expect(readOutput()).toEqual({
      body: content,
      inFlight: null,
      requestAborted: [true, true],
    })
  })
})
