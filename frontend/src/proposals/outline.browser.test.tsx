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

type RequestBlock = {
  deletion_from?: number
  from: number
  kind: string
  to: number
}

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
      typeof block['to'] !== 'number' ||
      typeof block['kind'] !== 'string' ||
      (block['deletion_from'] !== undefined &&
        typeof block['deletion_from'] !== 'number')
    ) {
      throw new Error('The outline request has an invalid block')
    }
    return {
      ...(typeof block['deletion_from'] === 'number'
        ? { deletion_from: block['deletion_from'] }
        : {}),
      from: block['from'],
      kind: block['kind'],
      to: block['to'],
    }
  })
}

function paragraphFrom(body: string): number {
  const paragraph = readRequestBlocks(body).find(
    ({ kind }) => kind === 'paragraph',
  )
  if (!paragraph) throw new Error('The outline request has no paragraph')
  return paragraph.from
}

function headingDeletionRange(body: string): { from: number; to: number } {
  const blocks = readRequestBlocks(body)
  const headingIndex = blocks.map(({ kind }) => kind).lastIndexOf('heading')
  const heading = blocks[headingIndex]
  const request: unknown = JSON.parse(body)
  if (
    !heading ||
    !isRecord(request) ||
    typeof request['body_length'] !== 'number'
  ) {
    throw new Error('The outline request has no deletable heading')
  }
  return {
    from: heading.deletion_from ?? heading.from,
    to: blocks[headingIndex + 1]?.from ?? request['body_length'],
  }
}

function firstHeadingRange(body: string): { from: number; to: number } {
  const heading = readRequestBlocks(body).find(({ kind }) => kind === 'heading')
  if (!heading) throw new Error('The outline request has no heading')
  return { from: heading.from, to: heading.to }
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

function readRetryOutput(
  requestBodies: string[],
  outlineHost: HTMLElement,
  view: EditorView,
) {
  return {
    requestCount: requestBodies.length,
    retriedSameBody: requestBodies[0] === requestBodies[1],
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

function readHeadingDeletionOutput(input: {
  history: ReturnType<typeof createMoveHistory>
  ranges: { from: number; to: number }[]
  view: EditorView
}) {
  const bodyAfterDelete = input.view.state.doc.toString()
  let undo = 'pending'
  act(() => {
    undo = input.history.undo(input.view).match(
      (value) => (value ? 'undone' : 'empty'),
      () => 'failed',
    )
  })

  return {
    bodyAfterDelete,
    undo,
    bodyAfterUndo: input.view.state.doc.toString(),
    ranges: input.ranges,
  }
}

function createFixture(
  fetcher: typeof fetch,
  markdown = '# Intro\n\nParagraph.\n',
) {
  const doc = new Y.Doc()
  setBody(doc, markdown)
  setPremise(doc, 'audience', 'New readers')
  setPremise(doc, 'purpose', 'Explain the subject')
  setPremise(doc, 'claim', 'The outline guides the article')
  const body = getBody(doc)
  const history = createMoveHistory(doc)
  const editorHost = document.createElement('div')
  const outlineHost = document.createElement('div')
  document.body.append(editorHost, outlineHost)
  const root: Root = createRoot(outlineHost)
  const extension = createOutlineProposalExtension(
    { doc, history },
    {
      debounceMs: 30_000,
      fetcher,
      getSettings: () => ok({ route: 'server', bridgeUrl: '' }),
    },
  )
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

  it('accepts a heading rename in one undo step', async () => {
    const requests: { url: string; body: string }[] = []
    const fetcher: typeof fetch = (input, init) => {
      requests.push({
        url: requestUrl(input),
        body: requestBodyFromInit(init),
      })
      return Promise.resolve(
        responseWithSuggestions([
          { from: 0, to: '# Intro'.length, replacement: '# Updated' },
        ]),
      )
    }
    const { doc, markdown, outlineHost, view, history } = createFixture(fetcher)
    act(() => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: '!' } })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })
    const acceptButton = [...outlineHost.querySelectorAll('button')].find(
      (button) => button.textContent.includes('採用'),
    )
    if (!acceptButton) throw new Error('The heading rename is missing')
    await act(async () => {
      await userEvent.click(acceptButton)
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
        requestsWithoutBodyChange: 0,
        requestsBeforeIdle: 0,
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
            body_length: markdown.length + 1,
            blocks: [
              {
                id: 'article-block-1',
                kind: 'heading',
                markdown: '# Intro',
                from: 0,
                to: 7,
              },
              {
                id: 'article-block-2',
                kind: 'paragraph',
                markdown: 'Paragraph.\n!',
                from: 9,
                to: 21,
              },
            ],
          }),
        },
      ],
      beforeUndo: '# Updated\n\nParagraph.\n!',
      undo: 'undone',
      afterUndo: '# Intro\n\nParagraph.\n!',
      yBody: '# Intro\n\nParagraph.\n!',
    })
  })

  it.each(['addition', 'rename', 'deletion'] as const)(
    'does not offer a rejected %s proposal again while the page stays open',
    async (operation) => {
      let requestCount = 0
      let requestBody = ''
      const fetcher: typeof fetch = (_input, init) => {
        requestCount += 1
        requestBody = requestBodyFromInit(init)
        const { from, to } = firstHeadingRange(requestBody)
        const paragraph = paragraphFrom(requestBody)
        const suggestion =
          operation === 'addition'
            ? { from: paragraph, to: paragraph, replacement: '## Added\n' }
            : operation === 'rename'
              ? { from, to, replacement: '# Updated' }
              : {
                  ...headingDeletionRange(requestBody),
                  replacement: '',
                }
        return Promise.resolve(responseWithSuggestions([suggestion]))
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
      const paragraph = paragraphFrom(requestBody)
      await act(async () => {
        await userEvent.click(rejectButton)
        view.dispatch({ changes: { from: paragraph, insert: 'Updated ' } })
        await vi.advanceTimersByTimeAsync(30_000)
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      })

      expect(readProposalOutput(outlineHost, view, requestCount)).toEqual({
        requestCount: 2,
        body: '# Intro\n\nUpdated Paragraph.\n!',
        proposalButtons: [],
        alert: null,
      })
    },
  )

  it('retries a failed request after the body returns to the same text', async () => {
    const requestBodies: string[] = []
    const fetcher: typeof fetch = (_input, init) => {
      requestBodies.push(requestBodyFromInit(init))
      return Promise.resolve(
        requestBodies.length === 1
          ? new Response('unavailable', { status: 429 })
          : responseWithSuggestions([]),
      )
    }
    const { outlineHost, view } = createFixture(fetcher)
    await act(async () => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: '!' } })
      await vi.advanceTimersByTimeAsync(30_000)
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })
    await act(async () => {
      view.dispatch({ changes: { from: 0, insert: 'A' } })
      view.dispatch({ changes: { from: 0, to: 1, insert: '' } })
      await vi.advanceTimersByTimeAsync(30_000)
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })

    expect(readRetryOutput(requestBodies, outlineHost, view)).toEqual({
      requestCount: 2,
      retriedSameBody: true,
      body: '# Intro\n\nParagraph.\n!',
      proposalButtons: [],
      alert: null,
    })
  })

  it.each([
    {
      position: 'middle',
      markdown: 'A\n\n## H\n\nB',
      heading: '## H',
      expectedBody: 'A\n\nB',
      expectedFrom: 3,
      expectedTo: 10,
    },
    {
      position: 'first',
      markdown: '# Intro\n\nP',
      heading: '# Intro',
      expectedBody: 'P',
      expectedFrom: 0,
      expectedTo: 10,
    },
    {
      position: 'tail',
      markdown: 'A\n\n## Tail\n',
      heading: '## Tail',
      expectedBody: 'A\n',
      expectedFrom: 2,
      expectedTo: 12,
    },
  ])(
    'deletes the adjacent blank line for a $position heading and restores it in one undo step',
    async ({ markdown, heading, expectedBody, expectedFrom, expectedTo }) => {
      const ranges: { from: number; to: number }[] = []
      let requestBody = ''
      const fetcher: typeof fetch = (_input, init) => {
        requestBody = requestBodyFromInit(init)
        const range = headingDeletionRange(requestBody)
        ranges.push(range)
        return Promise.resolve(
          responseWithSuggestions([{ ...range, replacement: '' }]),
        )
      }
      const { history, outlineHost, view } = createFixture(fetcher, markdown)
      const headingFrom = markdown.indexOf(heading)
      act(() => {
        view.dispatch({
          changes: { from: headingFrom + heading.length, insert: '!' },
        })
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      })
      const acceptButton = [...outlineHost.querySelectorAll('button')].find(
        (button) => button.textContent.includes('採用'),
      )
      if (!acceptButton) throw new Error('The heading deletion is missing')
      await act(async () => {
        await userEvent.click(acceptButton)
      })
      expect(readHeadingDeletionOutput({ history, ranges, view })).toEqual({
        bodyAfterDelete: expectedBody,
        undo: 'undone',
        bodyAfterUndo: markdown.replace(heading, `${heading}!`),
        ranges: [{ from: expectedFrom, to: expectedTo }],
      })
    },
  )

  it('deletes the final heading line and restores it in one undo step', async () => {
    const markdown = '# Intro\n\nParagraph.\n## Tail\n'
    const requests: { url: string; body: string }[] = []
    const fetcher: typeof fetch = (input, init) => {
      const body = requestBodyFromInit(init)
      requests.push({ url: requestUrl(input), body })
      return Promise.resolve(
        responseWithSuggestions([
          { ...headingDeletionRange(body), replacement: '' },
        ]),
      )
    }
    const { doc, outlineHost, view, history } = createFixture(fetcher, markdown)
    act(() => {
      view.dispatch({ changes: { from: 9, insert: '!' } })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })
    const acceptButton = [...outlineHost.querySelectorAll('button')].find(
      (button) => button.textContent.includes('採用'),
    )
    if (!acceptButton) throw new Error('The heading deletion is missing')
    await act(async () => {
      await userEvent.click(acceptButton)
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
        requestsWithoutBodyChange: 0,
        requestsBeforeIdle: 0,
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
            body_length: markdown.length + 1,
            blocks: [
              {
                id: 'article-block-1',
                kind: 'heading',
                markdown: '# Intro',
                from: 0,
                to: 7,
              },
              {
                id: 'article-block-2',
                kind: 'paragraph',
                markdown: '!Paragraph.',
                from: 9,
                to: 20,
              },
              {
                id: 'article-block-3',
                kind: 'heading',
                markdown: '## Tail',
                from: 21,
                to: 28,
              },
            ],
          }),
        },
      ],
      beforeUndo: '# Intro\n\n!Paragraph.\n',
      undo: 'undone',
      afterUndo: '# Intro\n\n!Paragraph.\n## Tail\n',
      yBody: '# Intro\n\n!Paragraph.\n## Tail\n',
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
