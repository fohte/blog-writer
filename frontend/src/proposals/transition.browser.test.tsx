import { EditorState, type Extension, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'

import { getBody, setBody } from '#article/body'
import { blockMoved } from '#article/index'
import { transitionProposalEditorExtensions } from '#editor/index'
import { createSuggestionLayer } from '#editor/suggestion-layer'
import { isRecord } from '#lib/guards'
import { saveLlmSettings } from '#lib/llm-settings'
import { createMoveHistory } from '#outline/index'

const beforeMove = [
  '# Section A',
  '',
  'Section A ends here.',
  '',
  '# Section B',
  '',
  'Section B begins here.',
  '',
  '# Section C',
  '',
  'Section C begins here.',
  '',
  '# Section D',
  '',
  'Section D begins here.',
  '',
].join('\n')

const afterMove = [
  '# Section A',
  '',
  'Section A ends here.',
  '',
  '# Section C',
  '',
  'Section C begins here.',
  '',
  '# Section B',
  '',
  'Section B begins here.',
  '',
  '# Section D',
  '',
  'Section D begins here.',
  '',
].join('\n')

const movedRange = {
  from: afterMove.indexOf('# Section C'),
  to: afterMove.indexOf('# Section B'),
  seam: afterMove.indexOf('# Section D'),
}

let activeView: EditorView | undefined
let activeDoc: Y.Doc | undefined
let activeHistory: ReturnType<typeof createMoveHistory> | undefined

function getRequestBody(options: RequestInit | undefined): unknown {
  const { body } = options ?? {}
  if (typeof body !== 'string') {
    throw new Error('Expected the proposal request body to be a JSON string')
  }
  const parsed: unknown = JSON.parse(body)
  return parsed
}

function getRequestSeamIds(options: RequestInit | undefined): string[] {
  const request = getRequestBody(options)
  if (!isRecord(request) || !Array.isArray(request['seams'])) {
    throw new Error('Expected proposal request seams')
  }
  return request['seams'].map((seam) => {
    if (!isRecord(seam) || typeof seam['id'] !== 'string') {
      throw new Error('Expected a seam identifier')
    }
    return seam['id']
  })
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function transitionResponse(suggestions: unknown[]): Response {
  return new Response(
    `data: ${JSON.stringify({
      event: 'result',
      data: { suggestions },
    })}\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

function createEditor(
  content = beforeMove,
  additionalExtensions: Extension[] = [],
): EditorView {
  const doc = new Y.Doc()
  setBody(doc, content)
  const body = getBody(doc)
  const history = createMoveHistory(doc)
  const host = document.createElement('div')
  document.body.append(host)
  let view: EditorView | undefined
  act(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: body.toJSON(),
        extensions: [
          history.extension,
          yCollab(body, null, { undoManager: false }),
          ...additionalExtensions,
          ...transitionProposalEditorExtensions({ doc, history }),
        ],
      }),
    })
  })
  if (!view) throw new Error('The transition editor did not mount')
  activeDoc = doc
  activeHistory = history
  activeView = view
  return view
}

function moveBlock(
  view: EditorView,
  source: string,
  destination: string,
): void {
  const markdown = view.state.doc.toString()
  const result = activeHistory?.move(
    {
      from: markdown.indexOf(source),
      destination: markdown.indexOf(destination),
    },
    view,
  )
  if (!result) throw new Error('Could not move the block')
  if (result.isErr()) throw result.error
}

function dispatchMoveMarker(
  view: EditorView,
  marker: { from: number; to: number; seam: number },
): void {
  act(() => {
    view.dispatch({
      annotations: [blockMoved.of(marker), Transaction.userEvent.of('move')],
    })
  })
}

afterEach(async () => {
  await act(async () => {
    activeView?.destroy()
    await Promise.resolve()
  })
  activeHistory?.destroy()
  activeDoc?.destroy()
  activeView?.dom.parentElement?.remove()
  activeView = undefined
  activeHistory = undefined
  activeDoc = undefined
  window.localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

describe('transition proposal extension', () => {
  it('routes local requests through the configured bridge URL', async () => {
    const settings = saveLlmSettings(() => window.localStorage, {
      route: 'local',
      bridgeUrl: 'https://proposal-bridge.invalid/root/',
    })
    if (settings.isErr()) throw settings.error

    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response('data: {"event":"result","data":{"suggestions":[]}}\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const view = createEditor()

    await act(async () => {
      view.dispatch({
        changes: { from: 0, to: beforeMove.length, insert: afterMove },
        annotations: [
          blockMoved.of(movedRange),
          Transaction.userEvent.of('move'),
        ],
      })
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(fetchMock.mock.calls.map(([url]) => getRequestUrl(url))).toEqual([
      'https://proposal-bridge.invalid/root/api/proposals/transition',
    ])
  })

  it('sends article context and the three editor-selected seam ranges after a local move', async () => {
    const firstSeam = {
      from: afterMove.indexOf('Section A ends here.'),
      to:
        afterMove.indexOf('Section C begins here.') +
        'Section C begins here.'.length,
    }
    const replacement =
      'Section A ends here.\n\n# Section C\n\nSection C starts here.'
    let resolveFetch: ((response: Response) => void) | undefined
    const fetchMock = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const view = createEditor()

    await act(async () => {
      view.dispatch({
        changes: { from: 0, to: beforeMove.length, insert: afterMove },
        annotations: [
          blockMoved.of(movedRange),
          Transaction.userEvent.of('move'),
        ],
      })
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })
    })
    await act(async () => {
      resolveFetch?.(
        new Response(
          `data: ${JSON.stringify({
            event: 'result',
            data: {
              suggestions: [
                {
                  seam_id: 'seam-0',
                  ...firstSeam,
                  replacement,
                },
              ],
            },
          })}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await vi.waitFor(() => {
      expect(
        view.dom.querySelectorAll(
          '.cm-suggestion-widget [aria-label="提案差分"]',
        ).length,
      ).toBe(1)
    })

    const seamRanges: [number, number][] = [
      [
        afterMove.indexOf('Section A ends here.'),
        afterMove.indexOf('Section C begins here.') +
          'Section C begins here.'.length,
      ],
      [
        afterMove.indexOf('Section C begins here.'),
        afterMove.indexOf('Section B begins here.') +
          'Section B begins here.'.length,
      ],
      [
        afterMove.indexOf('Section B begins here.'),
        afterMove.indexOf('Section D begins here.') +
          'Section D begins here.'.length,
      ],
    ]
    const seamSentences: [string, string][] = [
      ['Section A ends here.', 'Section C begins here.'],
      ['Section C begins here.', 'Section B begins here.'],
      ['Section B begins here.', 'Section D begins here.'],
    ]
    const seamRequests = seamRanges.map(([from, to], index) => {
      const [beforeSentence, afterSentence] = seamSentences[index] ?? ['', '']
      const afterSentenceFrom = afterMove.indexOf(afterSentence, from)
      const beforeSentenceTo = from + beforeSentence.length
      return {
        id: `seam-${String(index)}`,
        from,
        to,
        before_sentence: beforeSentence,
        middle: afterMove.slice(beforeSentenceTo, afterSentenceFrom),
        after_sentence: afterSentence,
        before_block_id: `block-${String(index * 2 + 1)}`,
        after_block_id: `block-${String(index * 2 + 3)}`,
      }
    })
    const readOutput = () => ({
      requests: fetchMock.mock.calls.map(([url, requestOptions]) => [
        getRequestUrl(url),
        requestOptions?.method,
        getRequestBody(requestOptions),
      ]),
      documentText: view.state.doc.toString(),
      suggestionWidgets: view.dom.querySelectorAll(
        '.cm-suggestion-widget [aria-label="提案差分"]',
      ).length,
      generatingWidgets: view.dom.querySelectorAll(
        '.cm-suggestion-widget [role="status"]',
      ).length,
    })
    expect(readOutput()).toEqual({
      requests: [
        [
          '/api/proposals/transition',
          'POST',
          {
            premise: { audience: '', purpose: '', thesis: '' },
            blocks: [
              { id: 'block-0', kind: 'heading', markdown: '# Section A' },
              {
                id: 'block-1',
                kind: 'paragraph',
                markdown: 'Section A ends here.',
              },
              { id: 'block-2', kind: 'heading', markdown: '# Section C' },
              {
                id: 'block-3',
                kind: 'paragraph',
                markdown: 'Section C begins here.',
              },
              { id: 'block-4', kind: 'heading', markdown: '# Section B' },
              {
                id: 'block-5',
                kind: 'paragraph',
                markdown: 'Section B begins here.',
              },
              { id: 'block-6', kind: 'heading', markdown: '# Section D' },
              {
                id: 'block-7',
                kind: 'paragraph',
                markdown: 'Section D begins here.',
              },
            ],
            seams: seamRequests,
          },
        ],
      ],
      documentText: afterMove,
      suggestionWidgets: 1,
      generatingWidgets: 0,
    })
  })

  it('keeps non-overlapping proposals after discarding a middle seam', async () => {
    const paragraphs = [
      'Alpha sentence.',
      'Beta sentence.',
      'Gamma sentence.',
      'Delta sentence.',
    ]
    const content = paragraphs.join('\n\n')
    const first = paragraphs[0]
    const second = paragraphs[1]
    const third = paragraphs[2]
    const fourth = paragraphs[3]
    if (
      first === undefined ||
      second === undefined ||
      third === undefined ||
      fourth === undefined
    )
      throw new Error('Could not create test paragraphs')
    const afterMove = [first, third, second, fourth].join('\n\n')
    const seamRanges = [
      {
        from: afterMove.indexOf(third),
        to: afterMove.indexOf(second) + second.length,
      },
      {
        from: afterMove.indexOf(second),
        to: afterMove.indexOf(fourth) + fourth.length,
      },
      {
        from: afterMove.indexOf(first),
        to: afterMove.indexOf(third) + third.length,
      },
    ]
    let resolveFetch: ((response: Response) => void) | undefined
    const fetchMock = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const view = createEditor(content)

    await act(async () => {
      moveBlock(view, second, fourth)
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })
    })
    await act(async () => {
      resolveFetch?.(
        transitionResponse([
          {
            seam_id: 'seam-0',
            ...seamRanges[0],
            replacement: 'Gamma crossed.\n\nBeta crossed.',
          },
          {
            seam_id: 'seam-1',
            ...seamRanges[1],
            replacement: 'Beta shifted.\n\nDelta shifted.',
          },
          {
            seam_id: 'seam-2',
            ...seamRanges[2],
            replacement: 'Alpha restored.\n\nGamma restored.',
          },
        ]),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const readOutput = () => ({
      request: getRequestBody(fetchMock.mock.calls[0]?.[1]),
      addedText: Array.from(
        view.dom.querySelectorAll('.suggestion-diff'),
        (widget) =>
          Array.from(widget.querySelectorAll('.suggestion-diff-added'))
            .map((node) => node.textContent)
            .join(''),
      ),
      documentText: view.state.doc.toString(),
    })
    expect(readOutput()).toEqual({
      request: {
        premise: { audience: '', purpose: '', thesis: '' },
        blocks: [first, third, second, fourth].map((markdown, index) => ({
          id: `block-${String(index)}`,
          kind: 'paragraph',
          markdown,
        })),
        seams: [
          {
            id: 'seam-0',
            from: afterMove.indexOf(third),
            to: afterMove.indexOf(second) + second.length,
            before_sentence: third,
            middle: '\n\n',
            after_sentence: second,
            before_block_id: 'block-1',
            after_block_id: 'block-2',
          },
          {
            id: 'seam-1',
            from: afterMove.indexOf(second),
            to: afterMove.indexOf(fourth) + fourth.length,
            before_sentence: second,
            middle: '\n\n',
            after_sentence: fourth,
            before_block_id: 'block-2',
            after_block_id: 'block-3',
          },
          {
            id: 'seam-2',
            from: afterMove.indexOf(first),
            to: afterMove.indexOf(third) + third.length,
            before_sentence: first,
            middle: '\n\n',
            after_sentence: third,
            before_block_id: 'block-0',
            after_block_id: 'block-1',
          },
        ],
      },
      addedText: ['restoredrestored', 'shiftedshifted'],
      documentText: afterMove,
    })
  })

  it('keeps code blocks in context and skips seams that touch them', async () => {
    const content = [
      'Before paragraph.',
      '',
      '```txt',
      'opaque line',
      '```',
      '',
      'Middle paragraph.',
      '',
      'After paragraph.',
    ].join('\n')
    const codeFrom = content.indexOf('```')
    const middleFrom = content.indexOf('Middle paragraph.')
    const afterFrom = content.indexOf('After paragraph.')
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(transitionResponse([])),
    )
    vi.stubGlobal('fetch', fetchMock)
    const view = createEditor(content)

    dispatchMoveMarker(view, {
      from: codeFrom + 1,
      to: middleFrom,
      seam: afterFrom,
    })
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const readOutput = () => ({
      request: getRequestBody(fetchMock.mock.calls[0]?.[1]),
      documentText: view.state.doc.toString(),
      suggestionCount: view.dom.querySelectorAll('.suggestion-diff').length,
    })
    expect(readOutput()).toEqual({
      request: {
        premise: { audience: '', purpose: '', thesis: '' },
        blocks: [
          { id: 'block-0', kind: 'paragraph', markdown: 'Before paragraph.' },
          {
            id: 'block-1',
            kind: 'other',
            markdown: '```txt\nopaque line\n```',
          },
          { id: 'block-2', kind: 'paragraph', markdown: 'Middle paragraph.' },
          { id: 'block-3', kind: 'paragraph', markdown: 'After paragraph.' },
        ],
        seams: [
          {
            id: 'seam-2',
            from: middleFrom,
            to: afterFrom + 'After paragraph.'.length,
            before_sentence: 'Middle paragraph.',
            middle: '\n\n',
            after_sentence: 'After paragraph.',
            before_block_id: 'block-2',
            after_block_id: 'block-3',
          },
        ],
      },
      documentText: content,
      suggestionCount: 0,
    })
  })

  it('splits Japanese sentences and ignores periods inside English domains', async () => {
    const paragraphs = [
      '概要です。詳細は example.com を参照。',
      'Use example.com for details. Next sentence.',
      '末尾です。',
    ]
    const content = paragraphs.join('\n\n')
    const japaneseFrom = content.indexOf(paragraphs[0] ?? '')
    const englishFrom = content.indexOf(paragraphs[1] ?? '')
    const finalFrom = content.indexOf(paragraphs[2] ?? '')
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(transitionResponse([])),
    )
    vi.stubGlobal('fetch', fetchMock)
    const view = createEditor(content)

    dispatchMoveMarker(view, {
      from: englishFrom,
      to: finalFrom,
      seam: content.length,
    })
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const readOutput = () => ({
      request: getRequestBody(fetchMock.mock.calls[0]?.[1]),
      documentText: view.state.doc.toString(),
    })
    expect(readOutput()).toEqual({
      request: {
        premise: { audience: '', purpose: '', thesis: '' },
        blocks: paragraphs.map((markdown, index) => ({
          id: `block-${String(index)}`,
          kind: 'paragraph',
          markdown,
        })),
        seams: [
          {
            id: 'seam-0',
            from: japaneseFrom + '概要です。'.length,
            to: englishFrom + 'Use example.com for details.'.length,
            before_sentence: '詳細は example.com を参照。',
            middle: '\n\n',
            after_sentence: 'Use example.com for details.',
            before_block_id: 'block-0',
            after_block_id: 'block-1',
          },
          {
            id: 'seam-1',
            from: englishFrom + 'Use example.com for details. '.length,
            to: finalFrom + '末尾です。'.length,
            before_sentence: 'Next sentence.',
            middle: '\n\n',
            after_sentence: '末尾です。',
            before_block_id: 'block-1',
            after_block_id: 'block-2',
          },
        ],
      },
      documentText: content,
    })
  })

  it('omits transition seams that overlap a body request suggestion after a block move', async () => {
    const bodyRequestLayer = createSuggestionLayer()
    const view = createEditor(afterMove, [bodyRequestLayer.extension])
    const bodyText = 'Section D begins here.'
    const bodyFrom = afterMove.indexOf(bodyText)
    const bodyTo = bodyFrom + bodyText.length
    const bodyProposal = bodyRequestLayer.setSuggestions([
      {
        id: 'body-request-proposal',
        from: bodyFrom,
        to: bodyTo,
        replacement: 'Section D presents another point.',
      },
    ])
    if (bodyProposal.isErr()) throw new Error('Could not set the body proposal')

    let resolveFetch: ((response: Response) => void) | undefined
    const fetchMock = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    dispatchMoveMarker(view, movedRange)
    await act(async () => {
      await vi.waitFor(() => {
        if (fetchMock.mock.calls.length !== 1) {
          throw new Error('Expected a transition request')
        }
      })
    })
    const requestSeamIds = getRequestSeamIds(fetchMock.mock.calls[0]?.[1])
    const seamRanges = [
      {
        from: afterMove.indexOf('Section A ends here.'),
        to:
          afterMove.indexOf('Section C begins here.') +
          'Section C begins here.'.length,
      },
      {
        from: afterMove.indexOf('Section C begins here.'),
        to:
          afterMove.indexOf('Section B begins here.') +
          'Section B begins here.'.length,
      },
    ]

    await act(async () => {
      resolveFetch?.(
        transitionResponse([
          {
            seam_id: 'seam-0',
            ...seamRanges[0],
            replacement: 'Section A leads into Section C.',
          },
          {
            seam_id: 'seam-1',
            ...seamRanges[1],
            replacement: 'Section C leads into Section B.',
          },
        ]),
      )
      await vi.waitFor(() => {
        if (view.dom.querySelectorAll('.cm-suggestion-widget').length !== 2) {
          throw new Error('Expected both non-overlapping proposals')
        }
      })
    })

    const readOutput = () => ({
      requestSeamIds,
      body: view.state.doc.toString(),
      proposalRanges: Array.from(
        view.dom.querySelectorAll<HTMLElement>('.cm-suggestion-widget'),
        (widget) => [
          Number(widget.dataset['suggestionFrom']),
          Number(widget.dataset['suggestionTo']),
        ],
      ),
    })
    expect(readOutput()).toEqual({
      requestSeamIds: ['seam-0', 'seam-1'],
      body: afterMove,
      proposalRanges: [
        [seamRanges[0]?.from, seamRanges[0]?.to],
        [bodyFrom, bodyTo],
      ],
    })
  })

  it('drops transition results that start to overlap a body request while pending', async () => {
    const bodyRequestLayer = createSuggestionLayer()
    const view = createEditor(beforeMove, [bodyRequestLayer.extension])
    let resolveFetch: ((response: Response) => void) | undefined
    const fetchMock = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      moveBlock(view, '# Section C', '# Section B')
      await vi.waitFor(() => {
        if (fetchMock.mock.calls.length !== 1) {
          throw new Error('Expected a transition request')
        }
      })
    })
    const requestSeamIds = getRequestSeamIds(fetchMock.mock.calls[0]?.[1])
    const bodyText = 'Section B begins here.'
    const bodyFrom = afterMove.indexOf(bodyText)
    const bodyTo = bodyFrom + bodyText.length
    const bodyProposal = bodyRequestLayer.setSuggestions([
      {
        id: 'body-request-proposal',
        from: bodyFrom,
        to: bodyTo,
        replacement: 'Section B starts with a different point.',
      },
    ])
    if (bodyProposal.isErr()) throw new Error('Could not set the body proposal')
    const seamRanges = [
      {
        from: afterMove.indexOf('Section A ends here.'),
        to:
          afterMove.indexOf('Section C begins here.') +
          'Section C begins here.'.length,
      },
      {
        from: afterMove.indexOf('Section C begins here.'),
        to: bodyTo,
      },
      {
        from: bodyFrom,
        to:
          afterMove.indexOf('Section D begins here.') +
          'Section D begins here.'.length,
      },
    ]

    await act(async () => {
      resolveFetch?.(
        transitionResponse(
          seamRanges.map((range, index) => ({
            seam_id: `seam-${String(index)}`,
            ...range,
            replacement: `Fictional transition ${String(index)}.`,
          })),
        ),
      )
      await vi.waitFor(() => {
        if (view.dom.querySelectorAll('.cm-suggestion-widget').length !== 2) {
          throw new Error('Expected only the non-overlapping proposal')
        }
      })
    })

    const readOutput = () => ({
      requestSeamIds,
      body: view.state.doc.toString(),
      proposalRanges: Array.from(
        view.dom.querySelectorAll<HTMLElement>('.cm-suggestion-widget'),
        (widget) => [
          Number(widget.dataset['suggestionFrom']),
          Number(widget.dataset['suggestionTo']),
        ],
      ),
    })
    expect(readOutput()).toEqual({
      requestSeamIds: ['seam-0', 'seam-1', 'seam-2'],
      body: afterMove,
      proposalRanges: [
        [seamRanges[0]?.from, seamRanges[0]?.to],
        [bodyFrom, bodyTo],
      ],
    })
  })

  it('does not start new requests for move history undo and redo', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(transitionResponse([])),
    )
    vi.stubGlobal('fetch', fetchMock)
    const view = createEditor()

    await act(async () => {
      moveBlock(view, '# Section C', '# Section B')
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })
    })
    const afterMove = view.state.doc.toString()
    await act(async () => {
      const undo = activeHistory?.undo(view)
      if (!undo) throw new Error('Could not undo the move')
      if (undo.isErr()) throw undo.error
      const redo = activeHistory?.redo(view)
      if (!redo) throw new Error('Could not redo the move')
      if (redo.isErr()) throw redo.error
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const readOutput = () => ({
      documentText: view.state.doc.toString(),
      bodyAfterMove: afterMove,
      requestCount: fetchMock.mock.calls.length,
    })
    expect(readOutput()).toEqual({
      documentText: afterMove,
      bodyAfterMove: afterMove,
      requestCount: 1,
    })
  })

  it('aborts the previous request when another move starts', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              reject(new Error('aborted'))
            },
            { once: true },
          )
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const view = createEditor()

    await act(async () => {
      moveBlock(view, '# Section C', '# Section B')
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })
    })
    await act(async () => {
      moveBlock(view, '# Section B', '# Section A')
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2)
      })
    })

    const readOutput = () => ({
      requestCount: fetchMock.mock.calls.length,
      abortedSignals: fetchMock.mock.calls.map(
        ([, options]) => options?.signal?.aborted ?? false,
      ),
    })
    expect(readOutput()).toEqual({
      requestCount: 2,
      abortedSignals: [true, false],
    })
  })

  it('does not start requests for remote transactions', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const view = createEditor()

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: afterMove },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock.mock.calls).toEqual([])
  })

  it('does not show a result after its target range changes while the request is pending', async () => {
    let resolveFetch: ((response: Response) => void) | undefined
    const fetchMock = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const view = createEditor()

    await act(async () => {
      view.dispatch({
        changes: { from: 0, to: beforeMove.length, insert: afterMove },
        annotations: [
          blockMoved.of(movedRange),
          Transaction.userEvent.of('move'),
        ],
      })
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })
    })
    const seam = {
      id: 'seam-0',
      from: afterMove.indexOf('Section A ends here.'),
      to:
        afterMove.indexOf('Section C begins here.') +
        'Section C begins here.'.length,
    }

    await act(async () => {
      view.dispatch({
        changes: { from: seam.from + 1, to: seam.from + 2, insert: 'x' },
      })
      resolveFetch?.(
        new Response(
          `data: ${JSON.stringify({
            event: 'result',
            data: {
              suggestions: [
                {
                  seam_id: seam.id,
                  from: seam.from,
                  to: seam.to,
                  replacement: 'Changed fictional transition.',
                },
              ],
            },
          })}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
      await vi.waitFor(() => {
        expect(view.dom.querySelectorAll('.cm-suggestion-widget').length).toBe(
          0,
        )
      })
    })

    const readOutput = () => ({
      body: view.state.doc.toString(),
      suggestionWidgets: view.dom.querySelectorAll('.cm-suggestion-widget')
        .length,
    })
    expect(readOutput()).toEqual({
      body:
        afterMove.slice(0, seam.from + 1) +
        'x' +
        afterMove.slice(seam.from + 2),
      suggestionWidgets: 0,
    })
  })

  it('maps a pending proposal after an edit outside its target range', async () => {
    let resolveFetch: ((response: Response) => void) | undefined
    const fetchMock = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const view = createEditor()
    const seam = {
      from: afterMove.indexOf('Section A ends here.'),
      to:
        afterMove.indexOf('Section C begins here.') +
        'Section C begins here.'.length,
    }
    const replacement =
      'Section A ends here.\n\n# Section C\n\nSection C starts here.'

    await act(async () => {
      view.dispatch({
        changes: { from: 0, to: beforeMove.length, insert: afterMove },
        annotations: [
          blockMoved.of(movedRange),
          Transaction.userEvent.of('move'),
        ],
      })
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })
    })
    act(() => {
      view.dispatch({ changes: { from: 0, insert: 'Intro.\n\n' } })
    })
    await act(async () => {
      resolveFetch?.(
        new Response(
          `data: ${JSON.stringify({
            event: 'result',
            data: {
              suggestions: [
                {
                  seam_id: 'seam-0',
                  ...seam,
                  replacement,
                },
              ],
            },
          })}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await vi.waitFor(() => {
      expect(
        view.dom.querySelectorAll(
          '.cm-suggestion-widget [aria-label="提案差分"]',
        ).length,
      ).toBe(1)
    })

    const readOutput = () => ({
      body: view.state.doc.toString(),
      suggestionInsideLine:
        view.dom.querySelector('.cm-suggestion-widget')?.closest('.cm-line') !==
        null,
      suggestionWidgets: view.dom.querySelectorAll(
        '.cm-suggestion-widget [aria-label="提案差分"]',
      ).length,
    })
    expect(readOutput()).toEqual({
      body: `Intro.\n\n${afterMove}`,
      suggestionInsideLine: false,
      suggestionWidgets: 1,
    })
  })

  it('leaves the moved article unchanged and silent when the request fails', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.reject(new Error('fictional request failure')),
    )
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    vi.stubGlobal('fetch', fetchMock)
    const view = createEditor()

    await act(async () => {
      view.dispatch({
        changes: { from: 0, to: beforeMove.length, insert: afterMove },
        annotations: [
          blockMoved.of(movedRange),
          Transaction.userEvent.of('move'),
        ],
      })
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const readOutput = () => ({
      body: view.state.doc.toString(),
      alerts: alertSpy.mock.calls,
      suggestionWidgets: view.dom.querySelectorAll(
        '.cm-suggestion-widget [aria-label="提案差分"]',
      ).length,
      generatingWidgets: view.dom.querySelectorAll(
        '.cm-suggestion-widget [role="status"]',
      ).length,
    })
    expect(readOutput()).toEqual({
      body: afterMove,
      alerts: [],
      suggestionWidgets: 0,
      generatingWidgets: 0,
    })
  })
})
