import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { ok } from 'neverthrow'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'

import { getBody, setBody } from '#article/body'
import { setPremise } from '#article/premise'
import {
  BodyRequestAccessory,
  bodyRequestExtensions,
  createSuggestionLayer,
} from '#editor/index'
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

function createRequestEditor(
  additionalExtensions: Extension[] = [],
  article = content,
) {
  const doc = new Y.Doc()
  setBody(doc, article)
  setPremise(doc, 'audience', 'fictional audience')
  setPremise(doc, 'purpose', 'fictional purpose')
  setPremise(doc, 'claim', 'fictional claim')
  const body = getBody(doc)
  const history = createMoveHistory(doc)
  const editorHost = document.createElement('div')
  const accessoryHost = document.createElement('div')
  const selectionFrom = article.indexOf('Rewrite')
  const selectionTo = article.indexOf('sentence.') + 'sentence.'.length
  document.body.append(editorHost, accessoryHost)
  const view = new EditorView({
    parent: editorHost,
    state: EditorState.create({
      doc: body.toJSON(),
      selection:
        selectionFrom < 0 || selectionTo < 0
          ? { anchor: 0 }
          : { anchor: selectionFrom, head: selectionTo },
      extensions: [
        yCollab(body, null, { undoManager: false }),
        bodyRequestExtensions({ doc, history }),
        ...additionalExtensions,
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
  let accessoryMounted = true
  const unmountAccessory = () => {
    if (!accessoryMounted) return
    accessoryMounted = false
    act(() => {
      root.unmount()
    })
  }
  cleanups.push(() => {
    unmountAccessory()
    view.destroy()
    history.destroy()
    doc.destroy()
    editorHost.remove()
    accessoryHost.remove()
  })
  return { body, view, unmountAccessory }
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

function pressNonModK(view: EditorView) {
  view.focus()
  const modifier = navigator.platform.includes('Mac') ? 'ctrlKey' : 'metaKey'
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    key: 'k',
    [modifier]: true,
  })
  view.contentDOM.dispatchEvent(event)
}

async function submitRequest(
  view: EditorView,
  instruction: string,
  requestStarted: () => boolean,
) {
  await act(async () => {
    pressModK(view)
    await Promise.resolve()
  })
  const input = document.querySelector<HTMLInputElement>('#body-request')
  if (!input) throw new Error('The request input did not open')
  await act(async () => {
    await userEvent.fill(input, instruction)
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => {
      if (!requestStarted()) throw new Error('The request did not start')
    })
  })
}

async function pressEscape(view: EditorView) {
  await act(async () => {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    )
    await Promise.resolve()
  })
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
  it('opens only for the platform Mod-K shortcut', async () => {
    const { view } = createRequestEditor()

    await act(async () => {
      pressNonModK(view)
      await Promise.resolve()
    })

    expect(document.querySelector('#body-request')).toEqual(null)
  })

  it('shows an error without changing the article when the request fails', async () => {
    const { body, view } = createRequestEditor()
    let requestCount = 0
    vi.stubGlobal('fetch', () =>
      Promise.resolve().then(() => {
        requestCount += 1
        return new Response(null, { status: 503 })
      }),
    )

    await submitRequest(view, 'make it concise', () => requestCount === 1)
    await act(async () => {
      await vi.waitFor(() => {
        if (
          document.querySelector('[role="alert"]')?.textContent !==
          'LLM API returned status 503'
        ) {
          throw new Error('The failed request has not been announced')
        }
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

  it('shows a successful response as a proposal while the article stays unchanged', async () => {
    const { body, view } = createRequestEditor()
    const { fetcher, resolveResponse, signals } = createPendingFetch()
    vi.stubGlobal('fetch', fetcher)

    await submitRequest(view, 'make it concise', () => signals.length === 1)
    await act(async () => {
      await resolveResponse(0, 'A shorter sentence.')
    })

    const readOutput = () => {
      const proposal = view.dom.querySelector(
        '.cm-suggestion-widget [aria-label="提案差分"]',
      )
      return {
        body: body.toJSON(),
        proposal: proposal
          ? {
              text:
                proposal.querySelector('.suggestion-diff-text')?.textContent ??
                null,
              removed: [...proposal.querySelectorAll('del')].map(
                (element) => element.textContent,
              ),
              added: [...proposal.querySelectorAll('ins')].map(
                (element) => element.textContent,
              ),
              actions: [...proposal.querySelectorAll('button')].map(
                (button) => button.textContent,
              ),
            }
          : null,
      }
    }
    expect(readOutput()).toEqual({
      body: content,
      proposal: {
        text: 'Rewrite thisA shorter sentence.',
        removed: ['Rewrite this'],
        added: ['A shorter'],
        actions: ['✓ 採用', '× 却下'],
      },
    })
  })

  it('keeps a blank-line insertion separated from surrounding paragraphs', async () => {
    const article = '# Article\n\n## Section\n\nfollowing paragraph'
    const { body, view } = createRequestEditor([], article)
    const { fetcher, resolveResponse, signals } = createPendingFetch()
    vi.stubGlobal('fetch', fetcher)
    const position = article.indexOf('\n\n', article.indexOf('## Section')) + 1
    act(() => {
      view.dispatch({ selection: { anchor: position } })
    })

    await submitRequest(
      view,
      'insert a sentence here',
      () => signals.length === 1,
    )
    await act(async () => {
      await resolveResponse(0, 'NEW')
    })
    const acceptButton = view.dom.querySelector<HTMLButtonElement>('button')
    if (!acceptButton)
      throw new Error('The insertion proposal has no accept action')
    await act(async () => {
      await userEvent.click(acceptButton)
    })

    const readOutput = () => ({
      body: body.toJSON(),
      proposalWidgets: view.dom.querySelectorAll('[aria-label="提案差分"]')
        .length,
      requestAborted: signals.map((signal) => signal.aborted),
    })
    expect(readOutput()).toEqual({
      body: '# Article\n\n## Section\n\nNEW\n\nfollowing paragraph',
      proposalWidgets: 0,
      requestAborted: [false],
    })
  })

  it('replaces an existing proposal when a new request targets the same range', async () => {
    const { body, view } = createRequestEditor()
    const { fetcher, resolveResponse, signals } = createPendingFetch()
    vi.stubGlobal('fetch', fetcher)

    await submitRequest(view, 'make it concise', () => signals.length === 1)
    await act(async () => {
      await resolveResponse(0, 'A shorter sentence.')
    })
    await submitRequest(
      view,
      'make it even shorter',
      () => signals.length === 2,
    )

    const readOutput = () => ({
      body: body.toJSON(),
      error: document.querySelector('[role="alert"]')?.textContent ?? null,
      inFlight:
        view.dom.querySelector('.suggestion-diff-generating')?.textContent ??
        null,
      proposals: view.dom.querySelectorAll('[aria-label="提案差分"]').length,
      requestAborted: signals.map((signal) => signal.aborted),
    })
    expect(readOutput()).toEqual({
      body: content,
      error: null,
      inFlight: '作成中',
      proposals: 0,
      requestAborted: [false, false],
    })
  })

  it('replaces a non-overlapping proposal instead of stacking it', async () => {
    const { body, view } = createRequestEditor()
    const { fetcher, resolveResponse, signals } = createPendingFetch()
    vi.stubGlobal('fetch', fetcher)

    await submitRequest(
      view,
      'rewrite the paragraph',
      () => signals.length === 1,
    )
    await act(async () => {
      await resolveResponse(0, 'A rewritten paragraph.')
    })
    const from = content.indexOf('## Section')
    view.dispatch({
      selection: { anchor: from, head: from + '## Section'.length },
    })
    await submitRequest(view, 'rewrite the heading', () => signals.length === 2)
    await act(async () => {
      await resolveResponse(1, '## New section')
    })

    const readOutput = () => ({
      body: body.toJSON(),
      proposals: view.dom.querySelectorAll('[aria-label="提案差分"]').length,
      requestAborted: signals.map((signal) => signal.aborted),
    })
    expect(readOutput()).toEqual({
      body: content,
      proposals: 1,
      requestAborted: [false, false],
    })
  })

  it('aborts the previous request and ignores its late response', async () => {
    const { body, view } = createRequestEditor()
    const { fetcher, resolveResponse, signals } = createPendingFetch()
    vi.stubGlobal('fetch', fetcher)

    await submitRequest(view, 'make it concise', () => signals.length === 1)
    await submitRequest(
      view,
      'write another version',
      () => signals.length === 2,
    )
    await act(async () => {
      await resolveResponse(0, 'The stale response must be ignored.')
    })

    const readOutput = () => ({
      body: body.toJSON(),
      inFlight:
        view.dom.querySelector('.suggestion-diff-generating')?.textContent ??
        null,
      requestAborted: signals.map((signal) => signal.aborted),
    })
    expect(readOutput()).toEqual({
      body: content,
      inFlight: '作成中',
      requestAborted: [true, false],
    })
  })

  it('aborts the active request with Escape and keeps the article unchanged', async () => {
    const otherLayer = createSuggestionLayer()
    const { body, view } = createRequestEditor([otherLayer.extension])
    const { fetcher, signals } = createPendingFetch()
    vi.stubGlobal('fetch', fetcher)
    expect(
      otherLayer.setSuggestions([
        {
          id: 'separate-proposal',
          from: 0,
          to: '# Article'.length,
          replacement: '# Revised',
        },
      ]),
    ).toEqual(ok(undefined))
    act(() => {
      view.dispatch({
        selection: { anchor: content.indexOf('Rewrite this sentence.') },
      })
    })

    await submitRequest(view, 'make it concise', () => signals.length === 1)
    const loadingMessage =
      view.dom.querySelector('.suggestion-diff-generating')?.textContent ?? null
    const proposalWidgetsBeforeEscape = view.dom.querySelectorAll(
      '.cm-suggestion-widget',
    ).length
    await pressEscape(view)

    const readOutput = () => ({
      body: body.toJSON(),
      loadingMessage,
      inFlight:
        view.dom.querySelector('.suggestion-diff-generating')?.textContent ??
        null,
      proposalWidgetsBeforeEscape,
      proposalWidgetsAfterEscape: view.dom.querySelectorAll(
        '.cm-suggestion-widget',
      ).length,
      separateProposal:
        view.dom.querySelector('.cm-suggestion-widget') !== null,
      requestAborted: signals.map((signal) => signal.aborted),
    })
    expect(readOutput()).toEqual({
      body: content,
      loadingMessage: '作成中',
      inFlight: null,
      proposalWidgetsBeforeEscape: 2,
      proposalWidgetsAfterEscape: 1,
      separateProposal: true,
      requestAborted: [true],
    })
  })

  it('aborts an active request when the accessory unmounts', async () => {
    const { body, view, unmountAccessory } = createRequestEditor()
    const { fetcher, signals } = createPendingFetch()
    vi.stubGlobal('fetch', fetcher)

    await submitRequest(view, 'make it concise', () => signals.length === 1)
    unmountAccessory()

    const readOutput = () => ({
      body: body.toJSON(),
      inFlight:
        view.dom.querySelector('.suggestion-diff-generating')?.textContent ??
        null,
      requestAborted: signals.map((signal) => signal.aborted),
    })
    expect(readOutput()).toEqual({
      body: content,
      inFlight: null,
      requestAborted: [true],
    })
  })
})
