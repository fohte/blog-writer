import { indentUnit } from '@codemirror/language'
import {
  EditorState,
  type Extension,
  Prec,
  Transaction,
} from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'

import { getBody, setBody } from '#article/body'
import { blockMoved } from '#article/index'
import {
  MarkdownEditor,
  transitionProposalEditorExtensions,
} from '#editor/index'
import {
  createSuggestionLayer,
  type SuggestionLayerOptions,
} from '#editor/suggestion-layer'
import { saveLlmSettings } from '#lib/llm-settings'
import { createMoveHistory } from '#outline/index'

const initialText = 'opening sentence\nselected sentence\nclosing sentence'
const cleanups: (() => void)[] = []

interface CreateEditorOptions {
  layerOptions?: SuggestionLayerOptions
  selection?: number
}

function createEditor(
  content = initialText,
  onResolve?: (decision: string) => void,
  additionalExtensions: Extension[] = [],
  options: CreateEditorOptions = {},
) {
  const doc = new Y.Doc()
  setBody(doc, content)
  const body = getBody(doc)
  const history = createMoveHistory(doc)
  const host = document.createElement('div')
  document.body.append(host)
  const layer = createSuggestionLayer({
    ...options.layerOptions,
    onCancelInFlight: () => onResolve?.('cancel'),
    onResolve: (_suggestion, decision) => onResolve?.(decision),
  })
  let view: EditorView | undefined

  act(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: body.toJSON(),
        ...(options.selection === undefined
          ? {}
          : { selection: { anchor: options.selection } }),
        extensions: [
          indentUnit.of('  '),
          history.extension,
          yCollab(body, null, { undoManager: false }),
          layer.extension,
          ...additionalExtensions,
        ],
      }),
    })
  })

  if (!view) throw new Error('The suggestion editor did not mount')
  cleanups.push(() => {
    act(() => view?.destroy())
    history.destroy()
    doc.destroy()
    host.remove()
  })

  const setSuggestion = (suggestion: {
    id: string
    from: number
    to: number
    replacement: string
  }) => {
    let result: ReturnType<typeof layer.setSuggestions> | undefined
    act(() => {
      result = layer.setSuggestions([suggestion])
    })
    if (!result) throw new Error('Could not set suggestion')
    if (result.isErr())
      throw new Error(`Could not set suggestion: ${result.error.type}`)
  }

  return { body, doc, history, host, layer, setSuggestion, view }
}

function dispatchKey(view: EditorView, key: string): void {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, key }),
  )
}

function dispatchUndo(view: EditorView): void {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'z',
      bubbles: true,
      [navigator.platform.includes('Mac') ? 'metaKey' : 'ctrlKey']: true,
    }),
  )
}

function createInsertionEditor() {
  const content = 'before after'
  const editor = createEditor(content)
  const from = 'before '.length
  editor.setSuggestion({
    id: 'suggestion-insert',
    from,
    to: from,
    replacement: 'new ',
  })
  return { ...editor, content, from }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('suggestion layer', () => {
  it('ignores invalid initial suggestion and in-flight ranges', () => {
    const { host } = createEditor('short', undefined, [], {
      layerOptions: {
        initialSuggestions: [
          { id: 'suggestion-a', from: 0, to: 3, replacement: 'one' },
          { id: 'suggestion-b', from: 2, to: 4, replacement: 'two' },
        ],
        initialInFlight: { from: 0, to: 10 },
      },
    })

    const readOutput = () => ({
      content: host.querySelector('.cm-content')?.textContent,
      suggestionWidgets: host.querySelectorAll('.cm-suggestion-widget').length,
    })
    expect(readOutput()).toEqual({ content: 'short', suggestionWidgets: 0 })
  })

  it('uses the editor selection to focus an initial suggestion', () => {
    const from = initialText.indexOf('selected')
    const { host } = createEditor(initialText, undefined, [], {
      layerOptions: {
        initialSuggestions: [
          {
            id: 'suggestion-initial',
            from,
            to: from + 'selected sentence'.length,
            replacement: 'revised sentence',
          },
        ],
      },
      selection: from,
    })

    const readOutput = () => ({
      focused: host.querySelector('[data-focused="true"]') !== null,
      buttonCount: host.querySelectorAll('button').length,
    })
    expect(readOutput()).toEqual({ focused: true, buttonCount: 2 })
  })

  it('maps a suggestion after an outside edit and removes it after an edit inside the range', () => {
    const { host, setSuggestion, view } = createEditor()
    const from = initialText.indexOf('selected')
    setSuggestion({
      id: 'suggestion-a',
      from,
      to: from + 'selected sentence'.length,
      replacement: 'revised sentence',
    })

    act(() => {
      view.dispatch({ changes: { from: 0, insert: 'new ' } })
    })
    const tracked = host.querySelector('.cm-suggestion-widget')?.textContent
    act(() => {
      view.dispatch({
        changes: { from: from + 4 + 2, insert: 'x' },
      })
    })

    const readOutput = () => ({
      afterOutsideEdit: tracked,
      afterInsideEdit:
        host.querySelector('.cm-suggestion-widget')?.textContent ?? null,
    })
    expect(readOutput()).toEqual({
      afterOutsideEdit: 'selectedrevised sentence',
      afterInsideEdit: null,
    })
  })

  it('keeps each suggestion layer state isolated in a shared editor', () => {
    const otherLayer = createSuggestionLayer()
    const { host, layer } = createEditor(initialText, undefined, [
      otherLayer.extension,
    ])
    otherLayer
      .setSuggestions([
        {
          id: 'other-layer-proposal',
          from: 0,
          to: 'opening'.length,
          replacement: 'revised',
        },
      ])
      .match(
        () => undefined,
        () => {
          throw new Error('Could not set the other layer proposal')
        },
      )
    layer.setInFlight({ from: 9, to: 16 }).match(
      () => undefined,
      () => {
        throw new Error('Could not set the in-flight range')
      },
    )
    layer.setSuggestions([]).match(
      () => undefined,
      () => {
        throw new Error('Could not clear the body request suggestions')
      },
    )
    layer.setInFlight(null).match(
      () => undefined,
      () => {
        throw new Error('Could not clear the in-flight range')
      },
    )

    const readOutput = () => ({
      proposalWidgets: host.querySelectorAll('.cm-suggestion-widget').length,
      generatingWidgets: host.querySelectorAll('.suggestion-diff-generating')
        .length,
    })
    expect(readOutput()).toEqual({ proposalWidgets: 1, generatingWidgets: 0 })
  })

  it('keeps an inline suggestion on the same paragraph line', () => {
    const content = 'A sentence with selected words in the middle.'
    const { host, setSuggestion } = createEditor(content)
    const from = content.indexOf('selected')
    setSuggestion({
      id: 'suggestion-a',
      from,
      to: from + 'selected words'.length,
      replacement: 'revised words',
    })

    const readOutput = () => ({
      lineCount: host.querySelectorAll('.cm-line').length,
      text: host.querySelector('.cm-content')?.textContent,
    })
    expect(readOutput()).toEqual({
      lineCount: 1,
      text: 'A sentence with selectedrevised words in the middle.',
    })
  })

  it('shows a non-empty in-flight range inline within one editor line', () => {
    const content = 'A sentence with a pending phrase in the middle.'
    const { host, layer } = createEditor(content)
    const from = content.indexOf('pending')
    let result: ReturnType<typeof layer.setInFlight> | undefined
    act(() => {
      result = layer.setInFlight({ from, to: from + 1 })
    })
    if (!result) throw new Error('Could not set in-flight state')
    if (result.isErr()) throw new Error('Could not set in-flight state')

    const line = host.querySelector('.cm-line')
    const widget = host.querySelector('.cm-suggestion-widget')
    const readOutput = () => ({
      lineCount: host.querySelectorAll('.cm-line').length,
      lineText: line?.textContent ?? null,
      widgetTag: widget?.tagName ?? null,
      widgetIsInLine: line?.contains(widget) ?? false,
      status: widget?.querySelector('[role="status"]')?.textContent ?? null,
    })
    expect(readOutput()).toEqual({
      lineCount: 1,
      lineText: `${content.slice(0, from)}作成中${content.slice(from)}`,
      widgetTag: 'SPAN',
      widgetIsInLine: true,
      status: '作成中',
    })
  })

  it('focuses an unfocused suggestion when it is clicked', async () => {
    const { host, setSuggestion } = createEditor()
    const from = initialText.indexOf('selected')
    setSuggestion({
      id: 'suggestion-a',
      from,
      to: from + 'selected sentence'.length,
      replacement: 'revised sentence',
    })
    const widget = host.querySelector<HTMLElement>('.cm-suggestion-widget')
    if (!widget) throw new Error('Could not find suggestion widget')

    await userEvent.click(widget)

    const readOutput = () => ({
      editorFocused:
        host.querySelector('.cm-content') === document.activeElement,
      focused: host.querySelector('[data-focused="true"]') !== null,
      buttonCount: host.querySelectorAll('button').length,
    })
    expect(readOutput()).toEqual({
      editorFocused: true,
      focused: true,
      buttonCount: 2,
    })
  })

  it('displays a zero-length suggestion at its insertion point', () => {
    const { body, content, from, host, view } = createInsertionEditor()
    act(() => {
      view.dispatch({ selection: { anchor: from } })
    })

    const readOutput = () => ({
      body: body.toJSON(),
      focused: host.querySelector('[data-focused="true"]') !== null,
      text: host.querySelector('.suggestion-diff-text')?.textContent,
    })
    expect(readOutput()).toEqual({
      body: content,
      focused: true,
      text: 'new ',
    })
  })

  it('accepts a zero-length suggestion as an insertion', () => {
    const { body, layer } = createInsertionEditor()

    act(() => {
      layer.accept('suggestion-insert')
    })

    expect(body.toJSON()).toEqual('before new after')
  })

  it('rejects a zero-length suggestion without changing the document', () => {
    const { body, content, host, layer } = createInsertionEditor()

    act(() => {
      layer.reject('suggestion-insert')
    })

    const readOutput = () => ({
      body: body.toJSON(),
      visible: host.querySelector('.cm-suggestion-widget') !== null,
    })
    expect(readOutput()).toEqual({ body: content, visible: false })
  })

  it.each(['start', 'end'] as const)(
    'keeps a suggestion when text is inserted at its %s boundary',
    (boundary) => {
      const { body, host, layer, view } = createEditor()
      const from = initialText.indexOf('selected')
      const to = from + 'selected sentence'.length
      const insertion = boundary === 'start' ? 'prefix ' : ' suffix'
      const insertionPosition = boundary === 'start' ? from : to
      const result = layer.setSuggestions([
        {
          id: 'suggestion-a',
          from,
          to,
          replacement: 'revised sentence',
        },
      ])
      if (result.isErr()) throw new Error('Could not set suggestion')

      act(() => {
        view.dispatch({
          changes: { from: insertionPosition, insert: insertion },
        })
      })
      const diff =
        host.querySelector('.suggestion-diff-text')?.textContent ?? null
      act(() => {
        layer.accept('suggestion-a')
      })

      const expected =
        boundary === 'start'
          ? initialText.replace('selected sentence', 'prefix revised sentence')
          : initialText.replace('selected sentence', 'revised sentence suffix')
      const readOutput = () => ({ diff, body: body.toJSON() })
      expect(readOutput()).toEqual({
        diff: 'selectedrevised sentence',
        body: expected,
      })
    },
  )

  it.each([
    {
      name: 'drops a proposal when a deletion crosses its start',
      from: 2,
      to: 6,
      insert: '',
      expectedVisible: false,
      expectedBody: 'abghijklmnop',
    },
    {
      name: 'drops a proposal when a deletion crosses its end',
      from: 8,
      to: 12,
      insert: '',
      expectedVisible: false,
      expectedBody: 'abcdefghmnop',
    },
    {
      name: 'keeps a proposal when a replacement ends at its start',
      from: 2,
      to: 4,
      insert: 'QR',
      expectedVisible: true,
      expectedBody: 'abQRXYZklmnop',
    },
    {
      name: 'keeps a proposal when a replacement starts at its end',
      from: 10,
      to: 12,
      insert: 'QR',
      expectedVisible: true,
      expectedBody: 'abcdXYZQRmnop',
    },
  ])('$name', ({ from, to, insert, expectedVisible, expectedBody }) => {
    const content = 'abcdefghijklmnop'
    const { body, host, layer, view } = createEditor(content)
    const result = layer.setSuggestions([
      {
        id: 'suggestion-boundary',
        from: 4,
        to: 10,
        replacement: 'XYZ',
      },
    ])
    if (result.isErr()) throw new Error('Could not set suggestion')

    act(() => {
      view.dispatch({ changes: { from, to, insert } })
    })
    const visibleAfterEdit =
      host.querySelector('.cm-suggestion-widget') !== null
    if (visibleAfterEdit) {
      act(() => {
        layer.accept('suggestion-boundary')
      })
    }

    const readOutput = () => ({
      visibleAfterEdit,
      body: body.toJSON(),
    })
    expect(readOutput()).toEqual({
      visibleAfterEdit: expectedVisible,
      body: expectedBody,
    })
  })

  it('drops a zero-length suggestion when text is inserted at its position', () => {
    const { host, from, view } = createInsertionEditor()

    act(() => {
      view.dispatch({ changes: { from, insert: 'edited ' } })
    })

    expect(host.querySelector('.cm-suggestion-widget') !== null).toEqual(false)
  })

  it('drops a suggestion when a remote Yjs edit changes its range', () => {
    const { doc, host, setSuggestion } = createEditor()
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    const from = initialText.indexOf('selected')
    setSuggestion({
      id: 'suggestion-a',
      from,
      to: from + 'selected sentence'.length,
      replacement: 'revised sentence',
    })

    const peerBody = getBody(peer)
    peerBody.insert(from + 3, 'x')
    act(() => {
      Y.applyUpdate(
        doc,
        Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)),
        'remote',
      )
    })

    expect(
      host.querySelector('.cm-suggestion-widget')?.textContent ?? null,
    ).toEqual(null)
    peer.destroy()
  })

  it('resolves an in-flight suggestion at its mapped position after an outside edit', () => {
    const { body, layer, view } = createEditor()
    const from = initialText.indexOf('selected')
    let inFlightResult: ReturnType<typeof layer.setInFlight> | undefined
    act(() => {
      inFlightResult = layer.setInFlight({
        from,
        to: from + 'selected sentence'.length,
      })
    })
    if (!inFlightResult) throw new Error('Could not set in-flight state')
    if (inFlightResult.isErr()) throw new Error('Could not set in-flight state')

    let resolveResult: ReturnType<typeof layer.resolveInFlight> | undefined
    act(() => {
      view.dispatch({ changes: { from: 0, insert: 'new ' } })
      resolveResult = layer.resolveInFlight('revised sentence')
      view.dispatch({ selection: { anchor: from + 'new '.length } })
      dispatchKey(view, 'Tab')
    })
    if (!resolveResult)
      throw new Error('Could not resolve in-flight suggestion')
    if (resolveResult.isErr())
      throw new Error('Could not resolve in-flight suggestion')

    expect(body.toJSON()).toEqual(
      `new ${initialText.replace('selected sentence', 'revised sentence')}`,
    )
  })

  it('rejects an in-flight range that overlaps an existing suggestion', () => {
    const { host, setSuggestion, layer } = createEditor()
    const from = initialText.indexOf('selected')
    setSuggestion({
      id: 'suggestion-a',
      from,
      to: from + 'selected sentence'.length,
      replacement: 'revised sentence',
    })

    let result: ReturnType<typeof layer.setInFlight> | undefined
    act(() => {
      result = layer.setInFlight({ from: from + 2, to: from + 6 })
    })
    if (!result) throw new Error('Could not set in-flight state')
    const inFlightResult = result

    const readOutput = () => ({
      error: inFlightResult.match(
        () => null,
        (error) => error.type,
      ),
      generating: host.querySelector('.suggestion-diff-generating') !== null,
      suggestionText:
        host.querySelector('.suggestion-diff-text')?.textContent ?? null,
    })
    expect(readOutput()).toEqual({
      error: 'overlapping-ranges',
      generating: false,
      suggestionText: 'selectedrevised sentence',
    })
  })

  it('rejects a suggestion that overlaps an existing in-flight range', () => {
    const { host, layer } = createEditor()
    const from = initialText.indexOf('selected')
    let inFlightResult: ReturnType<typeof layer.setInFlight> | undefined
    act(() => {
      inFlightResult = layer.setInFlight({
        from,
        to: from + 'selected sentence'.length,
      })
    })
    if (!inFlightResult) throw new Error('Could not set in-flight state')
    if (inFlightResult.isErr()) throw new Error('Could not set in-flight state')

    let result: ReturnType<typeof layer.setSuggestions> | undefined
    act(() => {
      result = layer.setSuggestions([
        {
          id: 'suggestion-a',
          from: from + 2,
          to: from + 6,
          replacement: 'revised',
        },
      ])
    })
    if (!result) throw new Error('Could not set suggestion')
    const suggestionResult = result

    const readOutput = () => ({
      error: suggestionResult.match(
        () => null,
        (error) => error.type,
      ),
      generating:
        host.querySelector('.suggestion-diff-generating')?.textContent ?? null,
      suggestionVisible: host.querySelector('.suggestion-diff-text') !== null,
    })
    expect(readOutput()).toEqual({
      error: 'overlapping-ranges',
      generating: '作成中',
      suggestionVisible: false,
    })
  })

  it('resolves an in-flight insertion at a suggestion end boundary', () => {
    const content = 'keep proposal'
    const { body, host, setSuggestion, layer } = createEditor(content)
    const from = content.indexOf('proposal')
    setSuggestion({
      id: 'suggestion-a',
      from,
      to: content.length,
      replacement: 'revised proposal',
    })

    let inFlightResult: ReturnType<typeof layer.setInFlight> | undefined
    act(() => {
      inFlightResult = layer.setInFlight({
        from: content.length,
        to: content.length,
      })
    })
    if (!inFlightResult) throw new Error('Could not set in-flight state')
    const setInFlightResult = inFlightResult

    let resolveResult: ReturnType<typeof layer.resolveInFlight> | undefined
    act(() => {
      resolveResult = layer.resolveInFlight('more text')
    })
    if (!resolveResult)
      throw new Error('Could not resolve in-flight suggestion')
    const resolutionResult = resolveResult

    const readOutput = () => ({
      inFlightError: setInFlightResult.match(
        () => null,
        (error) => error.type,
      ),
      resolveError: resolutionResult.match(
        () => null,
        (error) => error.type,
      ),
      body: body.toJSON(),
      suggestionCount: host.querySelectorAll('.cm-suggestion-widget').length,
      pendingCount: host.querySelectorAll('.suggestion-diff-generating').length,
    })
    expect(readOutput()).toEqual({
      inFlightError: null,
      resolveError: null,
      body: content,
      suggestionCount: 2,
      pendingCount: 0,
    })
  })

  it('resolves an in-flight insertion after accepting a suggestion before it', () => {
    const content = 'abcdefghijklmnop'
    const { body, host, layer, view } = createEditor(content)
    const suggestionResult = layer.setSuggestions([
      {
        id: 'suggestion-main',
        from: 5,
        to: 13,
        replacement: 'XYZ',
      },
    ])
    if (suggestionResult.isErr()) throw new Error('Could not set suggestion')

    const inFlightResult = layer.setInFlight({ from: 13, to: 13 })
    if (inFlightResult.isErr()) throw new Error('Could not set in-flight state')

    act(() => {
      layer.accept('suggestion-main')
    })
    const widgetCountAfterAccept = host.querySelectorAll(
      '.cm-suggestion-widget',
    ).length

    let resolveResult: ReturnType<typeof layer.resolveInFlight> | undefined
    act(() => {
      resolveResult = layer.resolveInFlight('!')
    })
    if (!resolveResult)
      throw new Error('Could not resolve in-flight suggestion')
    const resolutionResult = resolveResult

    act(() => {
      view.dispatch({ selection: { anchor: 8 } })
      dispatchKey(view, 'Tab')
    })

    const readOutput = () => ({
      widgetCountAfterAccept,
      resolveError: resolutionResult.match(
        () => null,
        (error) => error.type,
      ),
      body: body.toJSON(),
      suggestionCount: host.querySelectorAll('.cm-suggestion-widget').length,
    })
    expect(readOutput()).toEqual({
      widgetCountAfterAccept: 1,
      resolveError: null,
      body: 'abcdeXYZ!nop',
      suggestionCount: 0,
    })
  })

  it.each([
    {
      name: 'keeps an insertion proposal at an accepted suggestion end',
      suggestions: [
        {
          id: 'suggestion-main',
          from: 5,
          to: 13,
          replacement: 'XYZ',
        },
        {
          id: 'suggestion-end',
          from: 13,
          to: 13,
          replacement: '!',
        },
      ],
      action: 'accept' as const,
      actionId: 'suggestion-main',
      acceptedSuggestionId: 'suggestion-end',
      expectedBody: 'abcdeXYZ!nop',
    },
    {
      name: 'keeps an insertion proposal when a replacement starts at its position',
      suggestions: [
        {
          id: 'suggestion-start',
          from: 5,
          to: 5,
          replacement: '!',
        },
      ],
      action: 'replace' as const,
      from: 5,
      to: 9,
      insert: 'WXYZ',
      acceptedSuggestionId: 'suggestion-start',
      expectedBody: 'abcde!WXYZjklmnop',
    },
  ])('$name', (testCase) => {
    const { body, layer, view } = createEditor('abcdefghijklmnop')
    const result = layer.setSuggestions(testCase.suggestions)
    if (result.isErr()) throw new Error('Could not set suggestions')

    if (testCase.action === 'accept') {
      act(() => {
        layer.accept(testCase.actionId)
      })
    } else {
      act(() => {
        view.dispatch({
          changes: {
            from: testCase.from,
            to: testCase.to,
            insert: testCase.insert,
          },
        })
      })
    }
    act(() => {
      layer.accept(testCase.acceptedSuggestionId)
    })

    expect(body.toJSON()).toEqual(testCase.expectedBody)
  })

  it('ignores an in-flight result after an edit inside its range', () => {
    const cancellations: string[] = []
    const rangeEdits: string[] = []
    const { body, host, layer, view } = createEditor(
      initialText,
      (event) => cancellations.push(event),
      [],
      {
        layerOptions: {
          onInFlightRangeEdited: () => rangeEdits.push('edited'),
        },
      },
    )
    const from = initialText.indexOf('selected')
    let inFlightResult: ReturnType<typeof layer.setInFlight> | undefined
    act(() => {
      inFlightResult = layer.setInFlight({
        from,
        to: from + 'selected sentence'.length,
      })
    })
    if (!inFlightResult) throw new Error('Could not set in-flight state')
    if (inFlightResult.isErr()) throw new Error('Could not set in-flight state')

    let resolveResult: ReturnType<typeof layer.resolveInFlight> | undefined
    act(() => {
      view.dispatch({ changes: { from: from + 2, insert: 'x' } })
      resolveResult = layer.resolveInFlight('revised sentence')
    })
    if (!resolveResult)
      throw new Error('Could not resolve in-flight suggestion')
    if (resolveResult.isErr())
      throw new Error('Could not resolve in-flight suggestion')

    const readOutput = () => ({
      body: body.toJSON(),
      cancellations,
      rangeEdits,
      suggestion:
        host.querySelector('.cm-suggestion-widget')?.textContent ?? null,
    })
    expect(readOutput()).toEqual({
      body: initialText.replace('selected sentence', 'sexlected sentence'),
      cancellations: [],
      rangeEdits: ['edited'],
      suggestion: null,
    })
  })

  it('keeps a later transition proposal when the first seam is edited', async () => {
    const settings = saveLlmSettings(() => window.localStorage, {
      route: 'server',
      bridgeUrl: '',
    })
    if (settings.isErr()) throw settings.error

    const paragraphs = [
      'Alpha sentence.',
      'Beta sentence.',
      'Gamma sentence.',
      'Delta sentence.',
      'Epsilon sentence.',
    ] as const
    const content = paragraphs.join('\n\n')
    const [alpha, beta, gamma, delta, epsilon] = paragraphs

    let resolveFetch: ((response: Response) => void) | undefined
    const fetchMock = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

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
            ...transitionProposalEditorExtensions({ doc, history }),
          ],
        }),
      })
    })
    if (!view) throw new Error('The transition editor did not mount')
    const editorView = view
    cleanups.push(() => {
      act(() => {
        editorView.destroy()
      })
      history.destroy()
      doc.destroy()
      host.remove()
    })

    const seam0 = {
      from: content.indexOf(alpha),
      to: content.indexOf(beta) + beta.length,
    }
    const seam2 = {
      from: content.indexOf(delta),
      to: content.indexOf(epsilon) + epsilon.length,
    }
    await act(async () => {
      editorView.dispatch({
        annotations: [
          blockMoved.of({
            from: content.indexOf(beta),
            to: content.indexOf(gamma),
            seam: content.indexOf(epsilon),
          }),
          Transaction.userEvent.of('move'),
        ],
      })
      await vi.waitFor(() => {
        if (fetchMock.mock.calls.length !== 1)
          throw new Error('The transition request did not start')
      })
    })

    await act(async () => {
      editorView.dispatch({
        changes: { from: seam0.from + 2, to: seam0.from + 3, insert: 'x' },
      })
      resolveFetch?.(
        new Response(
          `data: ${JSON.stringify({
            event: 'result',
            data: {
              suggestions: [
                {
                  seam_id: 'seam-0',
                  ...seam0,
                  replacement: 'Alpha revised.\n\nBeta revised.',
                },
                {
                  seam_id: 'seam-2',
                  ...seam2,
                  replacement: 'Delta revised.\n\nEpsilon revised.',
                },
              ],
            },
          })}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const readOutput = () => ({
      body: body.toJSON(),
      requestAborted: fetchMock.mock.calls[0]?.[1]?.signal?.aborted ?? null,
      addedText: Array.from(
        editorView.dom.querySelectorAll('.suggestion-diff-added'),
        (node) => node.textContent,
      ),
    })
    expect(readOutput()).toEqual({
      body: content.replace('Alpha sentence.', 'Alxha sentence.'),
      requestAborted: false,
      addedText: ['revised', 'revised'],
    })
  })

  it('drops a suggestion when its block is moved by delete and insert', () => {
    const content = 'before\nmove this block\nafter'
    const { body, doc, host, setSuggestion } = createEditor(content)
    const from = content.indexOf('move')
    setSuggestion({
      id: 'suggestion-a',
      from,
      to: from + 'move this block'.length,
      replacement: 'move the block',
    })

    act(() => {
      doc.transact(() => {
        const moved = body
          .toJSON()
          .slice(from, from + 'move this block\n'.length)
        body.delete(from, moved.length)
        body.insert(body.length, moved)
      })
    })

    expect(
      host.querySelector('.cm-suggestion-widget')?.textContent ?? null,
    ).toEqual(null)
  })

  it('keeps a suggestion when a different block moves before its range', () => {
    const content = 'before\nselected sentence\nmoving block\nafter'
    const { body, doc, host, setSuggestion } = createEditor(content)
    const from = content.indexOf('selected')
    const movedFrom = content.indexOf('moving block')
    const movedText = 'moving block\n'
    setSuggestion({
      id: 'suggestion-a',
      from,
      to: from + 'selected sentence'.length,
      replacement: 'revised sentence',
    })

    act(() => {
      doc.transact(() => {
        body.delete(movedFrom, movedText.length)
        body.insert(0, movedText)
      })
    })
    const afterMove = host.querySelector('.cm-suggestion-widget') !== null
    act(() => {
      body.insert(movedText.length + from + 2, 'x')
    })

    const readOutput = () => ({
      afterMove,
      afterEdit: host.querySelector('.cm-suggestion-widget') !== null,
    })
    expect(readOutput()).toEqual({ afterMove: true, afterEdit: false })
  })

  it('keeps adjacent typing separate from an accepted suggestion in history', () => {
    const content = 'before selected after'
    const from = content.indexOf('selected')
    const { body, history, layer, setSuggestion, view } = createEditor(content)
    setSuggestion({
      id: 'suggestion-a',
      from,
      to: from + 'selected'.length,
      replacement: 'revised sentence',
    })

    vi.spyOn(Date, 'now').mockReturnValue(10_100)
    act(() => {
      view.dispatch({
        changes: { from, insert: '!' },
        annotations: [
          Transaction.userEvent.of('input.type'),
          Transaction.time.of(10_000),
        ],
      })
      layer.accept('suggestion-a')
      view.dispatch({
        changes: { from: from + 1 + 'revised sentence'.length, insert: '?' },
        annotations: [
          Transaction.userEvent.of('input.type'),
          Transaction.time.of(10_200),
        ],
      })
    })

    const afterEdits = body.toJSON()
    const undoResults: boolean[] = []
    const afterUndo: string[] = []
    act(() => {
      for (let step = 0; step < 3; step += 1) {
        undoResults.push(
          history.undo(view).match(
            (didUndo) => didUndo,
            () => false,
          ),
        )
        afterUndo.push(body.toJSON())
      }
    })

    const readOutput = () => ({ afterEdits, undoResults, afterUndo })
    expect(readOutput()).toEqual({
      afterEdits: 'before !revised sentence? after',
      undoResults: [true, true, true],
      afterUndo: [
        'before !revised sentence after',
        'before !selected after',
        content,
      ],
    })
  })

  it('keeps prior typing when one undo reverses an accepted suggestion in MarkdownEditor', () => {
    const doc = new Y.Doc()
    setBody(doc, initialText)
    const body = getBody(doc)
    const host = document.createElement('div')
    document.body.append(host)
    const history = createMoveHistory(doc)
    const layer = createSuggestionLayer()
    const root = createRoot(host)
    act(() => {
      root.render(
        <MarkdownEditor
          extensions={[layer.extension]}
          history={history}
          text={body}
        />,
      )
    })
    cleanups.push(() => {
      act(() => {
        root.unmount()
      })
      history.destroy()
      doc.destroy()
      host.remove()
    })
    const content = host.querySelector<HTMLElement>('.cm-content')
    const view = content ? EditorView.findFromDOM(content) : null
    if (!view) throw new Error('The Markdown editor did not mount')
    const from = initialText.indexOf('selected')

    let suggestionResult: ReturnType<typeof layer.setSuggestions> | undefined
    act(() => {
      suggestionResult = layer.setSuggestions([
        {
          id: 'suggestion-a',
          from,
          to: from + 'selected sentence'.length,
          replacement: 'revised sentence',
        },
      ])
    })
    if (!suggestionResult) throw new Error('Could not set suggestion')
    if (suggestionResult.isErr()) throw new Error('Could not set suggestion')

    act(() => {
      view.dispatch({
        changes: { from: 0, insert: 'new ' },
        annotations: Transaction.userEvent.of('input.type'),
      })
    })
    const afterTyping = body.toJSON()
    act(() => {
      layer.accept('suggestion-a')
    })
    const afterAccept = body.toJSON()
    act(() => {
      view.dispatch({
        changes: { from: body.toJSON().length, insert: '!' },
        annotations: Transaction.userEvent.of('input.type'),
      })
      dispatchUndo(view)
    })
    const afterFirstUndo = body.toJSON()
    act(() => {
      dispatchUndo(view)
    })

    const readOutput = () => ({
      afterAccept,
      afterTyping,
      afterFirstUndo,
      afterSecondUndo: body.toJSON(),
    })
    expect(readOutput()).toEqual({
      afterAccept: `new ${initialText.replace('selected sentence', 'revised sentence')}`,
      afterTyping: `new ${initialText}`,
      afterFirstUndo: `new ${initialText.replace('selected sentence', 'revised sentence')}`,
      afterSecondUndo: `new ${initialText}`,
    })
  })

  it('moves to the next suggestion before using Tab for the editor default', () => {
    const { host, layer, view } = createEditor()
    const first = initialText.indexOf('selected')
    const second = initialText.indexOf('closing')
    const result = layer.setSuggestions([
      {
        id: 'suggestion-b',
        from: second,
        to: initialText.length,
        replacement: 'last replacement',
      },
      {
        id: 'suggestion-a',
        from: first,
        to: first + 'opening sentence'.length,
        replacement: 'first replacement',
      },
    ])
    if (result.isErr()) throw new Error('Could not set suggestions')

    act(() => {
      view.dispatch({ selection: { anchor: 0 } })
      dispatchKey(view, 'Tab')
    })

    const readOutput = () => ({
      cursor: view.state.selection.main.head,
      focusedCount: host.querySelectorAll('[data-focused="true"]').length,
    })
    expect(readOutput()).toEqual({ cursor: first, focusedCount: 1 })
  })

  it('passes Tab to the next keymap when no suggestion or list item is active', () => {
    let fallbackRuns = 0
    const { body, view } = createEditor(initialText, undefined, [
      Prec.lowest(
        keymap.of([
          {
            key: 'Tab',
            run: () => {
              fallbackRuns += 1
              return true
            },
          },
        ]),
      ),
    ])

    act(() => {
      dispatchKey(view, 'Tab')
    })

    const readOutput = () => ({ body: body.toJSON(), fallbackRuns })
    expect(readOutput()).toEqual({ body: initialText, fallbackRuns: 1 })
  })

  it('accepts a focused suggestion from its button and restores editor focus', async () => {
    const { body, host, setSuggestion, view } = createEditor()
    const from = initialText.indexOf('selected')
    setSuggestion({
      id: 'suggestion-a',
      from,
      to: from + 'selected sentence'.length,
      replacement: 'revised sentence',
    })
    act(() => {
      view.dispatch({ selection: { anchor: from } })
    })
    const button = host.querySelector<HTMLButtonElement>('button')
    if (!button) throw new Error('Could not find accept button')
    await userEvent.click(button)

    const readOutput = () => ({
      body: body.toJSON(),
      editorFocused: view.hasFocus,
    })
    expect(readOutput()).toEqual({
      body: initialText.replace('selected sentence', 'revised sentence'),
      editorFocused: true,
    })
  })

  it('rejects a focused suggestion from its button and restores editor focus', async () => {
    const { body, host, setSuggestion, view } = createEditor()
    const from = initialText.indexOf('selected')
    setSuggestion({
      id: 'suggestion-a',
      from,
      to: from + 'selected sentence'.length,
      replacement: 'revised sentence',
    })
    act(() => {
      view.dispatch({ selection: { anchor: from } })
    })
    const button = host.querySelectorAll<HTMLButtonElement>('button')[1]
    if (!button) throw new Error('Could not find reject button')
    await userEvent.click(button)

    const readOutput = () => ({
      body: body.toJSON(),
      visible: host.querySelector('.cm-suggestion-widget') !== null,
      editorFocused: view.hasFocus,
    })
    expect(readOutput()).toEqual({
      body: initialText,
      visible: false,
      editorFocused: true,
    })
  })

  it('prioritizes list indentation before moving to the next suggestion', () => {
    const content = '- list item\n\nlast line'
    const { body, layer, view } = createEditor(content)
    const suggestions = layer.setSuggestions([
      {
        id: 'suggestion-a',
        from: content.indexOf('last'),
        to: content.length,
        replacement: 'final line',
      },
    ])
    if (suggestions.isErr()) throw new Error('Could not set suggestions')
    act(() => {
      view.dispatch({ selection: { anchor: 4 } })
      dispatchKey(view, 'Tab')
    })

    expect(body.toJSON()).toEqual('  - list item\n\nlast line')
  })

  it('accepts a focused suggestion in a list before indenting on Tab', () => {
    const content = '- selected sentence\nnext line'
    const { body, layer, view } = createEditor(content)
    const from = content.indexOf('selected')
    const result = layer.setSuggestions([
      {
        id: 'suggestion-list',
        from,
        to: from + 'selected sentence'.length,
        replacement: 'revised sentence',
      },
    ])
    if (result.isErr()) throw new Error('Could not set suggestion')

    act(() => {
      view.dispatch({ selection: { anchor: from } })
      dispatchKey(view, 'Tab')
    })

    expect(body.toJSON()).toEqual('- revised sentence\nnext line')
  })

  it('accepts a focused suggestion in another layer before indenting a list', () => {
    const content = '- selected sentence\nnext line'
    const secondLayer = createSuggestionLayer()
    const { body, view } = createEditor(content, undefined, [
      secondLayer.extension,
    ])
    const from = content.indexOf('selected')
    let result: ReturnType<typeof secondLayer.setSuggestions> | undefined
    act(() => {
      result = secondLayer.setSuggestions([
        {
          id: 'suggestion-secondary',
          from,
          to: from + 'selected sentence'.length,
          replacement: 'revised sentence',
        },
      ])
      view.dispatch({ selection: { anchor: from } })
      dispatchKey(view, 'Tab')
    })
    if (!result) throw new Error('Could not set suggestion')
    if (result.isErr()) throw new Error('Could not set suggestion')

    expect(body.toJSON()).toEqual('- revised sentence\nnext line')
  })

  it('cancels in-flight work before rejecting a focused suggestion', () => {
    const events: string[] = []
    const rangeEdits: string[] = []
    const { body, host, layer, view } = createEditor(
      initialText,
      (event) => events.push(event),
      [],
      {
        layerOptions: {
          onInFlightRangeEdited: () => rangeEdits.push('edited'),
        },
      },
    )
    const from = initialText.indexOf('selected')
    const result = layer.setSuggestions([
      {
        id: 'suggestion-a',
        from,
        to: from + 'selected sentence'.length,
        replacement: 'revised sentence',
      },
    ])
    if (result.isErr()) throw new Error('Could not set suggestions')
    let inFlightResult: ReturnType<typeof layer.setInFlight> | undefined
    act(() => {
      inFlightResult = layer.setInFlight({
        from: initialText.length,
        to: initialText.length,
      })
    })
    if (!inFlightResult) throw new Error('Could not set in-flight state')
    if (inFlightResult.isErr()) throw new Error('Could not set in-flight state')

    act(() => {
      view.dispatch({ selection: { anchor: from } })
      dispatchKey(view, 'Escape')
    })
    const afterCancel = host.querySelector('.suggestion-diff-text')?.textContent
    act(() => {
      dispatchKey(view, 'Escape')
    })

    const readOutput = () => ({
      afterCancel,
      afterReject:
        host.querySelector('.cm-suggestion-widget')?.textContent ?? null,
      body: body.toJSON(),
      events,
      rangeEdits,
    })
    expect(readOutput()).toEqual({
      afterCancel: 'selectedrevised sentence',
      afterReject: null,
      body: initialText,
      events: ['cancel', 'reject'],
      rangeEdits: [],
    })
  })

  it('cancels another layer in-flight work before rejecting a focused suggestion', () => {
    const events: string[] = []
    const secondLayer = createSuggestionLayer({
      onCancelInFlight: () => events.push('cancel'),
    })
    const { body, host, layer, view } = createEditor(
      initialText,
      (event) => events.push(event),
      [secondLayer.extension],
    )
    const from = initialText.indexOf('selected')
    const suggestionResult = layer.setSuggestions([
      {
        id: 'suggestion-primary',
        from,
        to: from + 'selected sentence'.length,
        replacement: 'revised sentence',
      },
    ])
    if (suggestionResult.isErr()) throw new Error('Could not set suggestion')
    const inFlightResult = secondLayer.setInFlight({
      from: initialText.length,
      to: initialText.length,
    })
    if (inFlightResult.isErr()) throw new Error('Could not set in-flight state')

    act(() => {
      view.dispatch({ selection: { anchor: from } })
      dispatchKey(view, 'Escape')
    })

    const readOutput = () => ({
      body: body.toJSON(),
      suggestionWidgets: host.querySelectorAll('.cm-suggestion-widget').length,
      generatingWidgets: host.querySelectorAll('.suggestion-diff-generating')
        .length,
      events,
    })
    expect(readOutput()).toEqual({
      body: initialText,
      suggestionWidgets: 1,
      generatingWidgets: 0,
      events: ['cancel'],
    })
  })

  it('passes Escape to the next keymap when there is no active state', () => {
    let fallbackRuns = 0
    const { body, view } = createEditor(initialText, undefined, [
      Prec.lowest(
        keymap.of([
          {
            key: 'Escape',
            run: () => {
              fallbackRuns += 1
              return true
            },
          },
        ]),
      ),
    ])

    act(() => {
      dispatchKey(view, 'Escape')
    })

    const readOutput = () => ({ body: body.toJSON(), fallbackRuns })
    expect(readOutput()).toEqual({ body: initialText, fallbackRuns: 1 })
  })
})
