import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { ok, okAsync } from 'neverthrow'
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

function llmErrorResponse(code: string): Response {
  const data = { code, message: 'fictional provider failure' }
  return new Response(`data: ${JSON.stringify({ event: 'error', data })}\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  })
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
  return { body, doc, view, unmountAccessory }
}

function pressMod(view: EditorView, key: string) {
  view.focus()
  const modifier = navigator.platform.includes('Mac') ? 'metaKey' : 'ctrlKey'
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    key,
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
    pressMod(view, 'j')
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

function findAcceptButton(view: EditorView): HTMLButtonElement | undefined {
  return Array.from(
    view.dom.querySelectorAll<HTMLButtonElement>(
      '[aria-label="提案の操作"] button',
    ),
  ).find((candidate) => candidate.textContent.startsWith('採用'))
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
      error: '作成できませんでした · 本文エディターを準備できませんでした。',
      selected: false,
    })
  })

  it.each(['j', 'k'])('opens for the platform Mod-%s shortcut', async (key) => {
    const { view } = createRequestEditor()

    await act(async () => {
      pressMod(view, key)
      await Promise.resolve()
    })

    expect(document.querySelector('#body-request')?.tagName).toEqual('INPUT')
  })

  it('stays closed for the modifier of the other platform', async () => {
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

  it.each([
    {
      failure: 'the usage limit is reached',
      respond: () => llmErrorResponse('usage_limit'),
      reason: '利用枠に達しました',
    },
    {
      failure: 'the provider output is malformed',
      respond: () => llmErrorResponse('invalid_response'),
      reason: '応答の形式が正しくありませんでした',
    },
    {
      failure: 'the provider times out',
      respond: () => llmErrorResponse('timeout'),
      reason: '10 分たっても応答がありませんでした',
    },
    {
      failure: 'the provider is unreachable',
      respond: () => llmErrorResponse('connection'),
      reason: '接続できません',
    },
    {
      failure: 'the API responds with an error status',
      respond: () => new Response(null, { status: 503 }),
      reason: '接続できません',
    },
    {
      failure: 'the API cannot be reached',
      respond: () => {
        throw new TypeError('Failed to fetch')
      },
      reason: '接続できません',
    },
  ])(
    'explains the failure without changing the article when $failure',
    async ({ respond, reason }) => {
      const { body, view } = createRequestEditor()
      let requestCount = 0
      vi.stubGlobal('fetch', () =>
        Promise.resolve().then(() => {
          requestCount += 1
          return respond()
        }),
      )
      const expectedError = `作成できませんでした · ${reason}`

      await submitRequest(view, 'make it concise', () => requestCount === 1)
      await act(async () => {
        await vi.waitFor(() => {
          if (
            document.querySelector('[role="alert"]')?.textContent !==
            expectedError
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
        error: expectedError,
        inFlight: null,
      })
    },
  )

  it('explains when the proposal layer is not mounted', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query !== '(max-width: 767px)',
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
      error: '作成できませんでした · 本文エディターを準備できませんでした。',
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
      error: '作成できませんでした · この範囲には別の提案が表示されています',
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
      error: '作成できませんでした · この範囲には別の提案が表示されています',
      fetchCalls: 0,
      inFlight: '作成中',
    })
  })

  it('shows a successful response as a proposal while the article stays unchanged', async () => {
    const { body, view } = createRequestEditor()
    const { fetcher, resolveResponse, signals } = createPendingFetch()
    vi.stubGlobal('fetch', fetcher)

    await submitRequest(view, 'make it concise', () => signals.length === 1)
    await vi.waitFor(() => {
      if (document.querySelector('#body-request'))
        throw new Error('The request input did not close')
    })
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
            }
          : null,
        actions: [
          ...view.dom.querySelectorAll('[aria-label="提案の操作"] button'),
        ].map((button) => button.textContent),
      }
    }
    expect(readOutput()).toEqual({
      body: content,
      duringGeneration: { inputOpen: false, inFlight: '作成中' },
      proposal: {
        text: 'Rewrite thisA shorter sentence.',
        removed: ['Rewrite this'],
        added: ['A shorter'],
      },
      actions: ['却下 Esc', '採用 Tab'],
    })
  })

  it.each([
    {
      name: 'a selection',
      article: content,
      anchor: undefined,
      expected: { placeholder: '選択した範囲への依頼', target: '選択範囲' },
    },
    {
      name: 'the paragraph at the cursor',
      article: content,
      anchor: content.indexOf('this'),
      expected: { placeholder: 'この段落への依頼', target: '段落' },
    },
    {
      name: 'an insertion on a blank line',
      article: `${content}\n\n`,
      anchor: `${content}\n\n`.length,
      expected: { placeholder: 'ここに書く文への依頼', target: '挿入' },
    },
  ])(
    'names $name as the request target',
    async ({ article, anchor, expected }) => {
      const { view } = createRequestEditor([], article)
      if (anchor !== undefined) view.dispatch({ selection: { anchor } })

      const input = await openRequestInput(view)

      const readOutput = () => ({
        placeholder: input.placeholder,
        target: input.nextElementSibling?.textContent ?? null,
      })
      expect(readOutput()).toEqual(expected)
    },
  )

  it.each([
    {
      name: 'a selection under a heading in an article with a premise',
      article: content,
      anchor: undefined,
      hasPremise: true,
      expected: [
        '簡潔にする',
        '前後とのつながりを直す',
        '前提に沿って直す',
        'Under a heading',
        'Always',
      ],
    },
    {
      name: 'a blank line without a heading or a premise',
      article: 'A sentence.\n\n',
      anchor: 'A sentence.\n\n'.length,
      hasPremise: false,
      expected: ['例を 1 つ足す', 'On an insertion', 'Always'],
    },
  ])(
    'offers the candidates that fit $name',
    async ({ article, anchor, hasPremise, expected }) => {
      const { doc, view } = createRequestEditor([], article, true, [
        {
          id: 'under-heading',
          label: 'Under a heading',
          isAvailable: (situation) => situation.hasHeading,
          onSelect: () => undefined,
        },
        {
          id: 'on-insertion',
          label: 'On an insertion',
          isAvailable: (situation) => situation.target === 'insertion',
          onSelect: () => undefined,
        },
        { id: 'always', label: 'Always', onSelect: () => undefined },
      ])
      if (!hasPremise) {
        for (const field of ['audience', 'purpose', 'claim'] as const) {
          setPremise(doc, field, null)
        }
      }
      if (anchor !== undefined) view.dispatch({ selection: { anchor } })

      await openRequestInput(view)

      const readLabels = () =>
        Array.from(
          document.querySelectorAll('[aria-label="定型の依頼"] button'),
        ).map((button) => button.textContent)
      expect(readLabels()).toEqual(expected)
    },
  )

  it.each([
    {
      name: 'clicking it',
      choose: async () => {
        const button = Array.from(document.querySelectorAll('button')).find(
          (candidate) => candidate.textContent === '簡潔にする',
        )
        if (!button) throw new Error('The edit candidate was not rendered')
        await userEvent.click(button)
      },
      expected: { instructions: ['簡潔にする'], label: '> 簡潔にする' },
    },
    {
      name: 'the arrow keys and Enter',
      choose: async () => {
        await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
      },
      expected: {
        instructions: ['前後とのつながりを直す'],
        label: '> 前後とのつながりを直す',
      },
    },
  ])(
    'sends an edit candidate chosen by $name as the instruction',
    async ({ choose, expected }) => {
      const { view } = createRequestEditor()
      const instructions: unknown[] = []
      const fetcher: typeof fetch = (_input, init) => {
        const request: unknown = JSON.parse(
          typeof init?.body === 'string' ? init.body : 'null',
        )
        if (typeof request === 'object' && request !== null)
          instructions.push(Reflect.get(request, 'instruction'))
        return new Promise<Response>(() => undefined)
      }
      vi.stubGlobal('fetch', fetcher)
      const input = await openRequestInput(view)

      await act(async () => {
        input.focus()
        await choose()
        await vi.waitFor(() => {
          if (instructions.length === 0)
            throw new Error('The candidate request did not start')
        })
      })

      const readOutput = () => ({
        instructions,
        label:
          view.dom.querySelector('.suggestion-generating-label')?.textContent ??
          null,
      })
      expect(readOutput()).toEqual(expected)
    },
  )

  it('returns to the request input with the typed text after a failure', async () => {
    const { view } = createRequestEditor()
    let requestCount = 0
    vi.stubGlobal('fetch', () => {
      requestCount += 1
      return Promise.resolve(new Response(null, { status: 503 }))
    })
    await submitRequest(view, 'make it concise', () => requestCount === 1)
    const retryButton = await vi.waitFor(() => {
      const button = Array.from(document.querySelectorAll('button')).find(
        (candidate) => candidate.textContent === '依頼し直す',
      )
      if (!button) throw new Error('The failure was not shown')
      return button
    })

    await act(async () => {
      await userEvent.click(retryButton)
    })

    const readOutput = () => ({
      alert: document.querySelector('[role="alert"]')?.textContent ?? null,
      instruction:
        document.querySelector<HTMLInputElement>('#body-request')?.value ??
        null,
    })
    expect(readOutput()).toEqual({
      alert: null,
      instruction: 'make it concise',
    })
  })

  it('keeps an accepted proposal and explains when its evidence cannot be saved', async () => {
    const { body, view } = createRequestEditor([], content, true, [
      {
        id: 'write-from-sources',
        label: '資料をもとに書く',
        createProposal: () =>
          okAsync({
            replacement: 'Sourced sentence.',
            metadata: {
              sentences: [
                {
                  from: 0,
                  to: 1000,
                  claim: 'Sourced sentence.',
                  sourceId: null,
                  quote: '',
                  verdict: 'insufficient',
                },
              ],
            },
            replacementMarks: [],
          }),
      },
    ])
    await openRequestInput(view)
    const presetButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button'),
    ).find((candidate) => candidate.textContent === '資料をもとに書く')
    if (!presetButton) throw new Error('The preset request was not rendered')
    await act(async () => {
      await userEvent.click(presetButton)
    })
    const acceptButton = await vi.waitFor(() => {
      const button = findAcceptButton(view)
      if (!button) throw new Error('The proposal has no accept action')
      return button
    })

    await act(async () => {
      await userEvent.click(acceptButton)
    })

    const readOutput = () => ({
      alert: document.querySelector('[role="alert"]')?.textContent ?? null,
      body: body.toJSON(),
    })
    expect(readOutput()).toEqual({
      alert: '根拠を保存できませんでした · 提案は本文に採用されています。',
      body: '# Article\n\n## Section\nSourced sentence.',
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
    const acceptButton = findAcceptButton(view)
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

  it('preserves blank lines when text is inserted before a pending request', async () => {
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
    view.dispatch({ changes: { from: 0, insert: 'Earlier paragraph xx\n\n' } })
    await act(async () => {
      await resolveResponse(0, 'NEW')
    })
    const acceptButton = findAcceptButton(view)
    if (!acceptButton)
      throw new Error('The insertion proposal has no accept action')
    await act(async () => {
      await userEvent.click(acceptButton)
    })

    const readOutput = () => ({
      body: body.toJSON(),
      requestAborted: signals.map((signal) => signal.aborted),
    })
    expect(readOutput()).toEqual({
      body: 'Earlier paragraph xx\n\n# Article\n\n## Section\n\nNEW\n\nfollowing paragraph',
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
    // The unfocused proposal shows only its margin marker beside the generating bar.
    const proposalWidgetsBeforeEscape = view.dom.querySelectorAll(
      '.cm-suggestion-widget, .cm-suggestion-marker',
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

  it('leaves the request button to the editor toolbar on a touch phone', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    createRequestEditor()

    const readTrigger = () => ({
      touchRequestButton:
        document.querySelector('[aria-label="本文を依頼"]') !== null,
    })
    expect(readTrigger()).toEqual({ touchRequestButton: false })
  })

  it('clears the previous request when the touch request button reopens', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query !== '(max-width: 767px)',
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
