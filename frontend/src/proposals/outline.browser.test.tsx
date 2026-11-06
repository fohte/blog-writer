import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { ok } from 'neverthrow'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'

import { getBody, setBody, setPremise } from '#article/index'
import {
  createOutlineProposalExtension,
  OutlineProposalAccessory,
} from '#editor/index'
import { createMoveHistory } from '#outline/index'

const cleanups: (() => void)[] = []

type RequestBlock = { from: number; kind: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readRequestBlocks(body: string): RequestBlock[] {
  const request: unknown = JSON.parse(body)
  if (!isRecord(request) || !Array.isArray(request['blocks'])) {
    throw new Error('The outline request has no block list')
  }
  return request['blocks'].map((block): RequestBlock => {
    if (
      !isRecord(block) ||
      typeof block['from'] !== 'number' ||
      typeof block['kind'] !== 'string'
    ) {
      throw new Error('The outline request has an invalid block')
    }
    return { from: block['from'], kind: block['kind'] }
  })
}

function paragraphFrom(body: string): number {
  const paragraph = readRequestBlocks(body).find(
    ({ kind }) => kind === 'paragraph',
  )
  if (!paragraph) throw new Error('The outline request has no paragraph')
  return paragraph.from
}

function requestBodyFromInit(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') {
    throw new Error('The outline request body is not a string')
  }
  return init.body
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function responseWithSuggestions(
  suggestions: { from: number; to: number; replacement: string }[],
): Response {
  return new Response(
    `data: ${JSON.stringify({ event: 'result', data: { suggestions } })}\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

function proposalButtons(outlineHost: HTMLElement): string[] {
  return [...outlineHost.querySelectorAll('button')]
    .map((button) => button.textContent.trim())
    .filter((text) => text === '✓ 採用' || text === '× 却下')
}

function alertText(outlineHost: HTMLElement): string | null {
  const alert = outlineHost.querySelector('[role="alert"]')
  return alert === null ? null : alert.textContent
}

function readProposalOutput(
  outlineHost: HTMLElement,
  view: EditorView,
  requestCount?: number,
  alertsAfterFailure?: string | null,
) {
  return {
    ...(requestCount === undefined ? {} : { requestCount }),
    ...(alertsAfterFailure === undefined ? {} : { alertsAfterFailure }),
    body: view.state.doc.toString(),
    proposalButtons: proposalButtons(outlineHost),
    alert: alertText(outlineHost),
  }
}

function readAcceptanceOutput(input: {
  requestsWithoutBodyChange: number
  requestsBeforeIdle: number
  requests: { url: string; body: string }[]
  beforeUndo: string
  undo: string
  view: EditorView
  doc: Y.Doc
}) {
  return {
    requestsWithoutBodyChange: input.requestsWithoutBodyChange,
    requestsBeforeIdle: input.requestsBeforeIdle,
    requests: input.requests,
    beforeUndo: input.beforeUndo,
    undo: input.undo,
    afterUndo: input.view.state.doc.toString(),
    yBody: getBody(input.doc).toJSON(),
  }
}

function createFixture(fetcher: typeof fetch) {
  const markdown = '# Intro\n\nParagraph.\n'
  const doc = new Y.Doc()
  setBody(doc, markdown)
  setPremise(doc, 'audience', 'New readers')
  setPremise(doc, 'purpose', 'Explain the subject')
  setPremise(doc, 'claim', 'The outline guides the article')
  const body = getBody(doc)
  const history = createMoveHistory(doc)
  const extension = createOutlineProposalExtension(
    { doc, history },
    {
      debounceMs: 30_000,
      fetcher,
      getSettings: () => ok({ route: 'server', bridgeUrl: '' }),
    },
  )
  const editorHost = document.createElement('div')
  const outlineHost = document.createElement('div')
  document.body.append(editorHost, outlineHost)
  const view = new EditorView({
    parent: editorHost,
    state: EditorState.create({
      doc: markdown,
      extensions: [
        history.extension,
        yCollab(body, null, { undoManager: false }),
        extension,
      ],
    }),
  })
  const root: Root = createRoot(outlineHost)
  act(() => {
    root.render(
      createElement(OutlineProposalAccessory, {
        doc,
        history,
        view,
        replaceBody: () => {},
      }),
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
    outlineHost.remove()
  })
  return { doc, history, markdown, outlineHost, view }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
})

afterEach(() => {
  for (const cleanup of cleanups) cleanup()
  cleanups.length = 0
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('outline proposal integration', () => {
  it('waits for 30 seconds of idle time and accepts in one undo step', async () => {
    const requests: { url: string; body: string }[] = []
    const fetcher: typeof fetch = (input, init) => {
      const body = requestBodyFromInit(init)
      const from = paragraphFrom(body)
      requests.push({ url: requestUrl(input), body })
      return Promise.resolve(
        responseWithSuggestions([
          { from, to: from, replacement: '## Added\n' },
        ]),
      )
    }
    const { doc, history, markdown, outlineHost, view } = createFixture(fetcher)
    const changedHeading = '# Introduction'

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    const requestsWithoutBodyChange = requests.length
    act(() => {
      view.dispatch({
        changes: { from: 0, to: '# Intro'.length, insert: changedHeading },
      })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_999)
    })
    const requestsBeforeIdle = requests.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })

    const adoptButton = [...outlineHost.querySelectorAll('button')].find(
      (button) => button.textContent.includes('採用'),
    )
    if (!adoptButton) throw new Error('The outline suggestion is missing')
    await act(async () => {
      await userEvent.click(adoptButton)
    })
    const beforeUndo = view.state.doc.toString()
    let undo = 'pending'
    act(() => {
      undo = history.undo(view).match(
        (value) => (value ? 'undone' : 'empty'),
        () => 'failed',
      )
    })

    expect(
      readAcceptanceOutput({
        requestsWithoutBodyChange,
        requestsBeforeIdle,
        requests,
        beforeUndo,
        undo,
        view,
        doc,
      }),
    ).toEqual({
      requestsWithoutBodyChange: 0,
      requestsBeforeIdle: 0,
      requests: [
        {
          url: '/api/proposals/outline',
          body: JSON.stringify({
            premise: {
              audience: 'New readers',
              purpose: 'Explain the subject',
              thesis: 'The outline guides the article',
            },
            body_length:
              changedHeading.length + markdown.length - '# Intro'.length,
            blocks: [
              {
                id: 'article-block-1',
                kind: 'heading',
                markdown: changedHeading,
                from: 0,
                to: changedHeading.length,
              },
              {
                id: 'article-block-2',
                kind: 'paragraph',
                markdown: 'Paragraph.',
                from: changedHeading.length + 2,
                to: changedHeading.length + 12,
              },
            ],
          }),
        },
      ],
      beforeUndo: `${changedHeading}\n\n## Added\nParagraph.\n`,
      undo: 'undone',
      afterUndo: `${changedHeading}\n\nParagraph.\n`,
      yBody: `${changedHeading}\n\nParagraph.\n`,
    })
  })

  it('does not offer a rejected proposal again while the page stays open', async () => {
    let requestCount = 0
    const fetcher: typeof fetch = (_input, init) => {
      requestCount += 1
      const from = paragraphFrom(requestBodyFromInit(init))
      return Promise.resolve(
        responseWithSuggestions([
          { from, to: from, replacement: '## Added\n' },
        ]),
      )
    }
    const { outlineHost, view } = createFixture(fetcher)
    await act(async () => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: '!' } })
      await vi.advanceTimersByTimeAsync(30_000)
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })
    const rejectButton = [...outlineHost.querySelectorAll('button')].find(
      (button) => button.textContent.includes('却下'),
    )
    if (!rejectButton) throw new Error('The outline suggestion is missing')
    await act(async () => {
      await userEvent.click(rejectButton)
      view.dispatch({ changes: { from: 7, to: 7, insert: ' X' } })
      await vi.advanceTimersByTimeAsync(30_000)
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })

    expect(readProposalOutput(outlineHost, view, requestCount)).toEqual({
      requestCount: 2,
      body: '# Intro X\n\nParagraph.\n!',
      proposalButtons: [],
      alert: null,
    })
  })

  it('moves a pending addition when text before its paragraph changes', async () => {
    let resolveFetch: ((response: Response) => void) | undefined
    let requestBody = ''
    const fetcher: typeof fetch = (_input, init) => {
      requestBody = requestBodyFromInit(init)
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve
      })
    }
    const { outlineHost, view } = createFixture(fetcher)
    act(() => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: '!' } })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    const from = paragraphFrom(requestBody)
    const resolve = resolveFetch
    if (!resolve) throw new Error('The outline request did not start')

    act(() => {
      view.dispatch({ changes: { from: 0, insert: 'Preface\n\n' } })
    })
    await act(async () => {
      resolve(
        responseWithSuggestions([
          { from, to: from, replacement: '## Added\n' },
        ]),
      )
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })
    const acceptButton = [...outlineHost.querySelectorAll('button')].find(
      (button) => button.textContent.includes('採用'),
    )
    if (!acceptButton)
      throw new Error('The mapped outline suggestion is missing')
    await act(async () => {
      await userEvent.click(acceptButton)
    })

    expect(readProposalOutput(outlineHost, view)).toEqual({
      body: 'Preface\n\n# Intro\n\n## Added\nParagraph.\n!',
      proposalButtons: [],
      alert: null,
    })
  })

  it('discards a pending addition when its paragraph changes', async () => {
    let resolveFetch: ((response: Response) => void) | undefined
    let requestBody = ''
    const fetcher: typeof fetch = (_input, init) => {
      requestBody = requestBodyFromInit(init)
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve
      })
    }
    const { outlineHost, view } = createFixture(fetcher)
    act(() => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: '!' } })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    const from = paragraphFrom(requestBody)
    const resolve = resolveFetch
    if (!resolve) {
      throw new Error('The outline request did not start')
    }

    act(() => {
      view.dispatch({ changes: { from: from + 3, insert: ' revised' } })
    })
    const response = responseWithSuggestions([
      { from, to: from, replacement: '## Added\n' },
    ])
    await act(async () => {
      resolve(response)
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })

    expect(readProposalOutput(outlineHost, view)).toEqual({
      body: '# Intro\n\nPar revisedagraph.\n!',
      proposalButtons: [],
      alert: null,
    })
  })

  it('keeps failures quiet and retries after the next idle edit', async () => {
    let requestCount = 0
    const fetcher: typeof fetch = () => {
      requestCount += 1
      if (requestCount === 1) {
        return Promise.resolve(new Response('unavailable', { status: 429 }))
      }
      return Promise.resolve(responseWithSuggestions([]))
    }
    const { outlineHost, view } = createFixture(fetcher)

    await act(async () => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: '!' } })
      await vi.advanceTimersByTimeAsync(30_000)
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })
    const alertsAfterFailure =
      outlineHost.querySelector('[role="alert"]')?.textContent ?? null
    await act(async () => {
      view.dispatch({ changes: { from: 0, to: 0, insert: 'A ' } })
      await vi.advanceTimersByTimeAsync(30_000)
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })

    expect(
      readProposalOutput(outlineHost, view, requestCount, alertsAfterFailure),
    ).toEqual({
      requestCount: 2,
      alertsAfterFailure: null,
      body: 'A # Intro\n\nParagraph.\n!',
      proposalButtons: [],
      alert: null,
    })
  })
})
