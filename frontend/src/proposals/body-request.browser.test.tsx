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
  type BodyRequestPreset,
  type BodyRequestPresetSelection,
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
  includeBodyRequestLayer = true,
  presets: readonly BodyRequestPreset[] = [],
  accessoryView?: EditorView | null,
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
        ...(includeBodyRequestLayer
          ? [bodyRequestExtensions({ doc, history })]
          : []),
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
        presets={presets}
        view={accessoryView === undefined ? view : accessoryView}
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

async function openRequestInput(view: EditorView): Promise<HTMLInputElement> {
  await act(async () => {
    pressModK(view)
    await Promise.resolve()
  })
  const input = document.querySelector<HTMLInputElement>('#body-request')
  if (!input) throw new Error('The request input did not open')
  return input
}

async function submitRequest(
  view: EditorView,
  instruction: string,
  requestStarted: () => boolean,
) {
  const input = await openRequestInput(view)
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
  it('passes the selected context, view and instruction to a preset request', async () => {
    let selected: BodyRequestPresetSelection | undefined
    const { view } = createRequestEditor([], content, true, [
      {
        id: 'research-section',
        label: 'この見出しについて調べる',
        onSelect: (selection) => {
          selected = selection
        },
      },
    ])
    const input = await openRequestInput(view)
    await act(async () => {
      await userEvent.fill(input, 'use the current request')
    })
    const presetButton = await vi.waitFor(() => {
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>('button'),
      ).find(
        (candidate) => candidate.textContent === 'この見出しについて調べる',
      )
      if (!button) throw new Error('The preset request was not rendered')
      return button
    })
    await act(async () => {
      await userEvent.click(presetButton)
    })

    const readOutput = () => ({
      chooserOpen:
        document
          .querySelector<HTMLElement>('[data-slot="popover-content"]')
          ?.hasAttribute('data-open') ?? false,
      context: selected?.context,
      instruction: selected?.instruction,
      selectedView: selected?.view === view,
    })
    expect(readOutput()).toEqual({
      chooserOpen: false,
      context: {
        headings: ['# Article', '## Section'],
        range: { from: 22, to: 44 },
        section:
          '## Section\n⟪依頼範囲の開始⟫Rewrite this sentence.⟪依頼範囲の終了⟫',
        target: 'Rewrite this sentence.',
      },
      instruction: 'use the current request',
      selectedView: true,
    })
  })

  it('shows the editor error and does not run a preset without a view', async () => {
    let selected = false
    const { view } = createRequestEditor(
      [],
      content,
      true,
      [
        {
          id: 'research-section',
          label: 'この見出しについて調べる',
          onSelect: () => {
            selected = true
          },
        },
      ],
      null,
    )
    await openRequestInput(view)
    const presetButton = await vi.waitFor(() => {
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>('button'),
      ).find(
        (candidate) => candidate.textContent === 'この見出しについて調べる',
      )
      if (!button) throw new Error('The preset request was not rendered')
      return button
    })
    await act(async () => {
      await userEvent.click(presetButton)
    })

    const readOutput = () => ({
      chooserOpen:
        document
          .querySelector<HTMLElement>('[data-slot="popover-content"]')
          ?.hasAttribute('data-open') ?? false,
      error: document.querySelector('[role="alert"]')?.textContent ?? null,
      selected,
    })
    expect(readOutput()).toEqual({
      chooserOpen: true,
      error: '本文エディターを準備できませんでした。',
      selected: false,
    })
  })

  it('opens only for the platform Mod-K shortcut', async () => {
    const { view } = createRequestEditor()

    await act(async () => {
      pressNonModK(view)
      await Promise.resolve()
    })

    expect(document.querySelector('#body-request')).toEqual(null)
  })

  it('anchors the request input to the cursor line', async () => {
    const { view } = createRequestEditor()
    view.dom.style.height = '320px'
    const { node } = view.domAtPos(view.state.selection.main.head)
    const cursorElement = node instanceof Element ? node : node.parentElement
    const cursorLine = cursorElement?.closest('.cm-line')
    if (!(cursorLine instanceof HTMLElement))
      throw new Error('The cursor line was not rendered')

    await openRequestInput(view)
    const popover = document.querySelector<HTMLElement>(
      '[data-slot="popover-content"]',
    )
    if (!popover) throw new Error('The request popover did not open')

    const readOutput = () => ({
      popoverBelowCursorLine:
        popover.getBoundingClientRect().top >=
        cursorLine.getBoundingClientRect().bottom,
      popoverBeforeEditorBottom:
        popover.getBoundingClientRect().top <
        view.dom.getBoundingClientRect().bottom - 100,
    })
    expect(readOutput()).toEqual({
      popoverBelowCursorLine: true,
      popoverBeforeEditorBottom: true,
    })
  })

  it('anchors the request input to a visible proposal widget', async () => {
    const { view } = createRequestEditor()
    view.dom.style.height = '320px'
    const { fetcher, resolveResponse, signals } = createPendingFetch()
    vi.stubGlobal('fetch', fetcher)

    await submitRequest(
      view,
      'rewrite this paragraph',
      () => signals.length === 1,
    )
    await act(async () => {
      await resolveResponse(0, 'A rewritten paragraph.')
    })
    const widget = view.dom.querySelector<HTMLElement>(
      '.cm-suggestion-widget[data-suggestion-from]',
    )
    if (!widget) throw new Error('The proposal widget was not rendered')
    await act(async () => {
      await userEvent.click(widget)
    })
    const proposalRange = {
      from: Number(widget.dataset['suggestionFrom']),
      to: Number(widget.dataset['suggestionTo']),
    }
    await openRequestInput(view)
    const popover = document.querySelector<HTMLElement>(
      '[data-slot="popover-content"]',
    )
    if (!popover) throw new Error('The request popover did not open')

    const readOutput = () => ({
      selection: {
        from: view.state.selection.main.from,
        to: view.state.selection.main.to,
      },
      popoverBelowWidget:
        popover.getBoundingClientRect().top >=
        widget.getBoundingClientRect().bottom,
      popoverBeforeEditorBottom:
        popover.getBoundingClientRect().top <
        view.dom.getBoundingClientRect().bottom - 100,
    })
    expect(readOutput()).toEqual({
      selection: { from: proposalRange.from, to: proposalRange.from },
      popoverBelowWidget: true,
      popoverBeforeEditorBottom: true,
    })
  })

  it('reuses a proposal widget when text before its range changes', () => {
    const otherLayer = createSuggestionLayer()
    const { body, view } = createRequestEditor([otherLayer.extension])
    const from = content.indexOf('Rewrite this sentence.')
    const to = from + 'Rewrite this sentence.'.length
    expect(
      otherLayer.setSuggestions([
        {
          id: 'stable-proposal',
          from,
          to,
          replacement: 'A more concise sentence.',
        },
      ]),
    ).toEqual(ok(undefined))
    const widgetBeforeEdit = view.dom.querySelector<HTMLElement>(
      '.cm-suggestion-widget[data-suggestion-from]',
    )
    if (!widgetBeforeEdit)
      throw new Error('The proposal widget was not rendered')

    const insertedText = 'Earlier paragraph.\n\n'
    act(() => {
      view.dispatch({ changes: { from: 0, to: 0, insert: insertedText } })
    })

    const widgetAfterEdit = view.dom.querySelector<HTMLElement>(
      '.cm-suggestion-widget[data-suggestion-from]',
    )
    if (!widgetAfterEdit) throw new Error('The proposal widget was removed')
    const readOutput = () => ({
      body: body.toJSON(),
      sameWidget: widgetAfterEdit === widgetBeforeEdit,
      position: {
        from: Number(widgetAfterEdit.dataset['suggestionFrom']),
        to: Number(widgetAfterEdit.dataset['suggestionTo']),
      },
    })
    expect(readOutput()).toEqual({
      body: `${insertedText}${content}`,
      sameWidget: true,
      position: {
        from: from + insertedText.length,
        to: to + insertedText.length,
      },
    })
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

  it('explains when the proposal layer is not mounted', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    const { body, view } = createRequestEditor([], content, false)
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 503 })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const requestButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="本文を依頼"]',
    )
    if (!requestButton) throw new Error('The touch request button did not open')
    await act(async () => {
      await userEvent.click(requestButton)
    })
    const input = document.querySelector<HTMLInputElement>('#body-request')
    if (!input) throw new Error('The request input did not open')
    await act(async () => {
      await userEvent.fill(input, 'rewrite this sentence')
      await userEvent.keyboard('{Enter}')
      await vi.waitFor(() => {
        if (!document.querySelector('[role="alert"]'))
          throw new Error('The layer setup failure was not announced')
      })
    })

    const readOutput = () => ({
      body: body.toJSON(),
      error: document.querySelector('[role="alert"]')?.textContent ?? null,
      fetchCalls: fetchMock.mock.calls.length,
      inFlight:
        view.dom.querySelector('.suggestion-diff-generating')?.textContent ??
        null,
    })
    expect(readOutput()).toEqual({
      body: content,
      error: '本文エディターを準備できませんでした。',
      fetchCalls: 0,
      inFlight: null,
    })
  })

  it('rejects a request that overlaps a visible proposal from another layer', async () => {
    const otherLayer = createSuggestionLayer()
    const { body, view } = createRequestEditor([otherLayer.extension])
    const from = content.indexOf('Rewrite this sentence.')
    const to = from + 'Rewrite this sentence.'.length
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 503 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    expect(
      otherLayer.setSuggestions([
        {
          id: 'other-layer-proposal',
          from,
          to,
          replacement: 'A proposal from another feature.',
        },
      ]),
    ).toEqual(ok(undefined))

    const input = await openRequestInput(view)
    await act(async () => {
      await userEvent.fill(input, 'rewrite this paragraph')
      await userEvent.keyboard('{Enter}')
      await vi.waitFor(() => {
        if (!document.querySelector('[role="alert"]'))
          throw new Error('The overlapping range was not announced')
      })
    })

    const readOutput = () => ({
      body: body.toJSON(),
      error: document.querySelector('[role="alert"]')?.textContent ?? null,
      fetchCalls: fetchMock.mock.calls.length,
      proposal: Array.from(
        view.dom.querySelectorAll(
          '.cm-suggestion-widget [aria-label="提案差分"]',
        ),
        (proposal) => ({
          removed: Array.from(
            proposal.querySelectorAll('.suggestion-diff-removed'),
            (node) => node.textContent,
          ).join(''),
          added: Array.from(
            proposal.querySelectorAll('.suggestion-diff-added'),
            (node) => node.textContent,
          ).join(''),
        }),
      ),
    })
    expect(readOutput()).toEqual({
      body: content,
      error: 'この範囲には別の提案が表示されています',
      fetchCalls: 0,
      proposal: [
        {
          removed: 'Rewrite this sentence',
          added: 'A proposal from another feature',
        },
      ],
    })
  })

  it('rejects a request that overlaps an in-flight range from another layer', async () => {
    const otherLayer = createSuggestionLayer()
    const { body, view } = createRequestEditor([otherLayer.extension])
    const from = content.indexOf('Rewrite this sentence.')
    const to = from + 'Rewrite this sentence.'.length
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 503 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    expect(otherLayer.setInFlight({ from, to })).toEqual(ok(undefined))

    const input = await openRequestInput(view)
    await act(async () => {
      await userEvent.fill(input, 'rewrite this paragraph')
      await userEvent.keyboard('{Enter}')
      await vi.waitFor(() => {
        if (!document.querySelector('[role="alert"]'))
          throw new Error('The overlapping range was not announced')
      })
    })

    const readOutput = () => ({
      body: body.toJSON(),
      error: document.querySelector('[role="alert"]')?.textContent ?? null,
      fetchCalls: fetchMock.mock.calls.length,
      inFlight:
        view.dom.querySelector('.suggestion-diff-generating')?.textContent ??
        null,
    })
    expect(readOutput()).toEqual({
      body: content,
      error: 'この範囲には別の提案が表示されています',
      fetchCalls: 0,
      inFlight: '作成中',
    })
  })

  it('shows a successful response as a proposal while the article stays unchanged', async () => {
    const { body, view } = createRequestEditor()
    const { fetcher, resolveResponse, signals } = createPendingFetch()
    vi.stubGlobal('fetch', fetcher)

    await submitRequest(view, 'make it concise', () => signals.length === 1)
    const duringGeneration = {
      inputOpen: document.querySelector('#body-request') !== null,
      inFlight:
        view.dom.querySelector('.suggestion-diff-generating')?.textContent ??
        null,
    }
    await act(async () => {
      await resolveResponse(0, 'A shorter sentence.')
    })

    const readOutput = () => {
      const proposal = view.dom.querySelector(
        '.cm-suggestion-widget [aria-label="提案差分"]',
      )
      return {
        body: body.toJSON(),
        duringGeneration,
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
      duringGeneration: { inputOpen: false, inFlight: '作成中' },
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

  it('keeps a newer request input open when the previous request resolves', async () => {
    const { body, view } = createRequestEditor()
    const { fetcher, resolveResponse, signals } = createPendingFetch()
    vi.stubGlobal('fetch', fetcher)

    await submitRequest(
      view,
      'rewrite the paragraph',
      () => signals.length === 1,
    )
    const secondInput = await openRequestInput(view)
    await act(async () => {
      await userEvent.fill(secondInput, 'request another version')
      await resolveResponse(0, 'A proposed version.')
    })

    const readOutput = () => ({
      body: body.toJSON(),
      error: document.querySelector('[role="alert"]')?.textContent ?? null,
      inFlight:
        view.dom.querySelector('.suggestion-diff-generating')?.textContent ??
        null,
      input:
        document.querySelector<HTMLInputElement>('#body-request')?.value ??
        null,
      proposals: view.dom.querySelectorAll('[aria-label="提案差分"]').length,
      requestAborted: signals.map((signal) => signal.aborted),
    })
    expect(readOutput()).toEqual({
      body: content,
      error: null,
      inFlight: null,
      input: 'request another version',
      proposals: 1,
      requestAborted: [false],
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
    const proposalFrom = content.indexOf('## Section')
    const proposalTo = proposalFrom + '## Section'.length
    expect(
      otherLayer.setSuggestions([
        {
          id: 'separate-proposal',
          from: proposalFrom,
          to: proposalTo,
          replacement: '## Other heading',
        },
      ]),
    ).toEqual(ok(undefined))
    await submitRequest(view, 'make it concise', () => signals.length === 1)
    const proposalWidgetsBeforeEscape = view.dom.querySelectorAll(
      '.cm-suggestion-widget',
    ).length
    const loadingMessageBeforeEscape = view.dom.querySelector(
      '.suggestion-diff-generating',
    )?.textContent
    act(() => {
      view.dispatch({
        selection: { anchor: proposalFrom + 1 },
      })
    })
    await pressEscape(view)

    const readOutput = () => ({
      body: body.toJSON(),
      loadingMessageBeforeEscape,
      inFlight:
        view.dom.querySelector('.suggestion-diff-generating')?.textContent ??
        null,
      proposalWidgetsBeforeEscape,
      proposalWidgetsAfterEscape: view.dom.querySelectorAll(
        '.cm-suggestion-widget',
      ).length,
      remainingProposals: Array.from(
        view.dom.querySelectorAll(
          '.cm-suggestion-widget [aria-label="提案差分"]',
        ),
        (proposal) => ({
          removed: Array.from(
            proposal.querySelectorAll('.suggestion-diff-removed'),
            (node) => node.textContent,
          ).join(''),
          added: Array.from(
            proposal.querySelectorAll('.suggestion-diff-added'),
            (node) => node.textContent,
          ).join(''),
        }),
      ),
      requestAborted: signals.map((signal) => signal.aborted),
    })
    expect(readOutput()).toEqual({
      body: content,
      loadingMessageBeforeEscape: '作成中',
      inFlight: null,
      proposalWidgetsBeforeEscape: 2,
      proposalWidgetsAfterEscape: 1,
      remainingProposals: [{ removed: 'Section', added: 'Other heading' }],
      requestAborted: [true],
    })
  })

  it('aborts a request with Escape while a newer request input is open', async () => {
    const { body, view } = createRequestEditor()
    const { fetcher, signals } = createPendingFetch()
    vi.stubGlobal('fetch', fetcher)

    await submitRequest(view, 'make it concise', () => signals.length === 1)
    const input = await openRequestInput(view)
    await act(async () => {
      await userEvent.fill(input, 'request another version')
    })
    const popover = document.querySelector<HTMLElement>(
      '[data-slot="popover-content"]',
    )
    if (!popover) throw new Error('The newer request input did not open')
    const inputWasOpen = popover.hasAttribute('data-open')
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
      )
      await Promise.resolve()
    })

    const readOutput = () => ({
      body: body.toJSON(),
      inputOpen:
        document
          .querySelector<HTMLElement>('[data-slot="popover-content"]')
          ?.hasAttribute('data-open') ?? false,
      inputWasOpen,
      inFlight:
        view.dom.querySelector('.suggestion-diff-generating')?.textContent ??
        null,
      requestAborted: signals.map((signal) => signal.aborted),
    })
    expect(readOutput()).toEqual({
      body: content,
      inputOpen: false,
      inputWasOpen: true,
      inFlight: null,
      requestAborted: [true],
    })
  })

  it('keeps the newer input open when the active request target is edited', async () => {
    const { body, view } = createRequestEditor()
    const { fetcher, signals } = createPendingFetch()
    vi.stubGlobal('fetch', fetcher)

    await submitRequest(view, 'make it concise', () => signals.length === 1)
    const input = await openRequestInput(view)
    await act(async () => {
      await userEvent.fill(input, 'request another version')
    })
    const targetStart = content.indexOf('Rewrite this sentence.')
    act(() => {
      view.dispatch({
        changes: { from: targetStart + 2, to: targetStart + 3, insert: 'x' },
      })
    })

    const readOutput = () => ({
      body: body.toJSON(),
      error: document.querySelector('[role="alert"]')?.textContent ?? null,
      input:
        document.querySelector<HTMLInputElement>('#body-request')?.value ??
        null,
      inFlight:
        view.dom.querySelector('.suggestion-diff-generating')?.textContent ??
        null,
      requestAborted: signals.map((signal) => signal.aborted),
    })
    expect(readOutput()).toEqual({
      body: content.replace('Rewrite', 'Rexrite'),
      error: null,
      input: 'request another version',
      inFlight: null,
      requestAborted: [true],
    })
  })

  it('clears the previous request when the touch request button reopens', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    const { body, view } = createRequestEditor()
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 503 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const requestButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="本文を依頼"]',
    )
    if (!requestButton)
      throw new Error('The touch request button was not shown')
    await act(async () => {
      await userEvent.click(requestButton)
    })
    const input = document.querySelector<HTMLInputElement>('#body-request')
    if (!input) throw new Error('The request input did not open')
    await act(async () => {
      await userEvent.fill(input, 'make it concise')
      await userEvent.keyboard('{Enter}')
      await vi.waitFor(() => {
        if (!document.querySelector('[role="alert"]'))
          throw new Error('The request failure was not announced')
      })
    })
    await act(async () => {
      await userEvent.keyboard('{Escape}')
    })
    await act(async () => {
      await userEvent.click(requestButton)
    })

    const readOutput = () => ({
      body: body.toJSON(),
      editorMounted: view.dom.isConnected,
      error: document.querySelector('[role="alert"]')?.textContent ?? null,
      fetchCalls: fetchMock.mock.calls.length,
      input:
        document.querySelector<HTMLInputElement>('#body-request')?.value ??
        null,
      inputOpen:
        document
          .querySelector<HTMLElement>('[data-slot="popover-content"]')
          ?.hasAttribute('data-open') ?? false,
    })
    expect(readOutput()).toEqual({
      body: content,
      editorMounted: true,
      error: null,
      fetchCalls: 1,
      input: '',
      inputOpen: true,
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
