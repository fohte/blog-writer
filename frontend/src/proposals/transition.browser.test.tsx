import { EditorState, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { blockMoved } from '#article/index'
import { createMoveHistory } from '#outline/index'
import { transitionProposalEditorExtensions } from '#proposals/index'

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

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function createEditor(): EditorView {
  const doc = new Y.Doc()
  const history = createMoveHistory(doc)
  const host = document.createElement('div')
  document.body.append(host)
  let view: EditorView | undefined
  act(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: beforeMove,
        extensions: [
          history.extension,
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

  it('does not start requests for undo, redo, or remote transactions', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const view = createEditor()

    for (const userEvent of ['undo', 'redo'] as const) {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: userEvent === 'undo' ? afterMove : beforeMove,
        },
        annotations: [
          blockMoved.of(movedRange),
          Transaction.userEvent.of(userEvent),
        ],
      })
    }
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
    })
    expect(readOutput()).toEqual({ body: afterMove, alerts: [] })
  })
})
