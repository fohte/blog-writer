import { EditorView } from '@codemirror/view'
import { ok } from 'neverthrow'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import * as Y from 'yjs'

import { addEvidence } from '#article/evidence'
import {
  getBody,
  listEvidence,
  listSources,
  moveBlock,
  readBody,
} from '#article/index'
import { addSource } from '#article/sources'
import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'
import { evidenceDrop } from '#editor/evidence-drop'
import type { LlmSettings } from '#lib/llm-settings'

function readEvidenceCardOutput(
  marker: HTMLButtonElement,
  card: HTMLElement | null,
  doc: Y.Doc,
  host: HTMLElement,
) {
  return {
    markerClass: marker.className,
    cardConnected: card?.isConnected,
    remainingEvidence: [...doc.getMap('evidence').keys()],
    remainingMarkers: host.querySelectorAll('.cm-evidence-marker').length,
  }
}

function evidenceDropOptions(
  fetcher: typeof fetch,
  route: string | undefined = 'server',
) {
  let id = 0
  const settings: LlmSettings = {
    route: route === 'local' ? 'local' : 'server',
    bridgeUrl: '',
  }
  return {
    fetcher,
    loadSettings: () => ok(settings),
    newId: () => `drop-id-${(id++).toString()}`,
  }
}

function readDroppedEvidenceOutput(
  prevented: boolean,
  doc: Y.Doc,
  errors: string[],
  claimRequest: string | undefined,
) {
  return {
    prevented,
    errors,
    source: listSources(doc).map(({ status, title, url }) => ({
      status,
      title,
      url,
    })),
    evidence: listEvidence(doc).map(
      ({ claim, currentClaim, edited, quote, verdict }) => ({
        claim,
        currentClaim,
        edited,
        quote,
        verdict,
      }),
    ),
    claimRequest,
  }
}

function readPendingMoveOutput(doc: Y.Doc, errors: string[]) {
  return {
    body: readBody(doc),
    errors,
    evidence: listEvidence(doc).map(
      ({ claim, currentClaim, edited, verdict }) => ({
        claim,
        currentClaim,
        edited,
        verdict,
      }),
    ),
  }
}

function readFallbackDropOutput(
  drop: DragEvent,
  doc: Y.Doc,
  requestCount: number,
) {
  return {
    defaultPrevented: drop.defaultPrevented,
    body: readBody(doc),
    sourceIds: [...doc.getMap('sources').keys()],
    evidenceIds: [...doc.getMap('evidence').keys()],
    requestCount,
  }
}

function readInternalDragRecoveryOutput(
  internalDrop: DragEvent,
  externalDrop: DragEvent,
  doc: Y.Doc,
  requestCount: number,
) {
  return {
    internalDropPrevented: internalDrop.defaultPrevented,
    externalDropPrevented: externalDrop.defaultPrevented,
    body: readBody(doc),
    sources: listSources(doc).map(({ id, status }) => ({ id, status })),
    evidence: listEvidence(doc).map(
      ({ claim, currentClaim, edited, verdict }) => ({
        claim,
        currentClaim,
        edited,
        verdict,
      }),
    ),
    requestCount,
  }
}

function readTypingOutput(
  doc: Y.Doc,
  bodyStringifications: number,
  text: string | undefined,
) {
  return {
    bodyStringifications,
    text,
    evidence: listEvidence(doc),
  }
}

function readEditorEvidenceOutput(doc: Y.Doc, host: HTMLElement) {
  return {
    body: readBody(doc),
    evidence: listEvidence(doc).map(({ currentClaim, edited, id }) => ({
      currentClaim,
      edited,
      id,
    })),
    markers: host.querySelectorAll('.cm-evidence-marker').length,
  }
}

async function dispatchHistoryShortcut(
  content: HTMLElement | null,
  action: 'undo' | 'redo',
) {
  const isMac = navigator.platform.includes('Mac')
  const modifier = isMac ? 'Meta' : 'Control'
  const shortcut =
    action === 'undo'
      ? `{${modifier}>}z{/${modifier}}`
      : isMac
        ? '{Meta>}{Shift>}z{/Shift}{/Meta}'
        : '{Control>}y{/Control}'
  content?.focus()
  await userEvent.keyboard(shortcut)
}

function readEvidenceUndoRedoOutput(
  afterMove: ReturnType<typeof readEditorEvidenceOutput>,
  afterUndo: ReturnType<typeof readEditorEvidenceOutput>,
  afterRedo: ReturnType<typeof readEditorEvidenceOutput>,
) {
  return { afterMove, afterUndo, afterRedo }
}

async function mountFootnoteEditor() {
  const body = 'First claim. Second claim. Third claim. Fourth claim.'
  const { doc, host } = mountMarkdownEditor(body)
  const checkedAt = '2026-02-01T00:00:00.000Z'
  const sentences = [
    { claim: 'First claim.', sourceId: 'source-b', verdict: 'supported' },
    { claim: 'Second claim.', sourceId: 'source-b', verdict: 'outdated' },
    { claim: 'Third claim.', sourceId: 'source-a', verdict: 'supported' },
    { claim: 'Fourth claim.', sourceId: 'source-b', verdict: 'supported' },
  ] as const
  act(() => {
    for (const id of ['source-a', 'source-b'])
      addSource(doc, {
        id,
        kind: 'url',
        title: id,
        url: `https://example.invalid/${id}`,
        fileName: null,
        checkedAt,
      })._unsafeUnwrap()
    sentences.forEach(({ claim, sourceId, verdict }, index) => {
      const from = body.indexOf(claim)
      addEvidence(doc, {
        id: `evidence-${index.toString()}`,
        from,
        to: from + claim.length,
        claim,
        sourceId,
        quote: 'A quoted sentence.',
        verdict,
        checkedAt,
      })._unsafeUnwrap()
    })
  })
  const readFootnotes = () => ({
    markers: [...host.querySelectorAll('.cm-evidence-marker')].map(
      (marker) => marker.textContent,
    ),
    needsReview: [
      ...host.querySelectorAll('.cm-evidence-text-needs-review'),
    ].map((text) => text.textContent),
  })
  await vi.waitFor(() => {
    if (readFootnotes().markers.length !== 4)
      throw new Error('Footnotes were not rendered')
  })
  return { doc, readFootnotes }
}

const uploadStatus: Record<string, number> = {
  unavailable: 500,
  loginRequired: 424,
}

describe('MarkdownEditor', () => {
  it.each([
    {
      name: 'source retrieval fails',
      expectedError: '資料ページを取得できませんでした: HTTP 500',
      expectedStatus: 'unavailable',
      expectedTitle: 'example.invalid',
    },
    {
      name: 'the source page requires a login',
      expectedError:
        'ログインが必要なページのため、資料ページを取得できませんでした。',
      expectedStatus: 'loginRequired',
      expectedTitle: 'example.invalid',
    },
    {
      name: 'claim judgment fails after retrieval',
      expectedError:
        '資料は登録しましたが、根拠を判定できませんでした: judge unavailable',
      expectedStatus: 'analysisFailed',
      expectedTitle: 'Report title',
    },
    {
      name: 'the local LLM is not configured',
      expectedError:
        '資料は登録しましたが、根拠を判定できませんでした: ローカル LLM の接続先を設定してください。',
      expectedStatus: 'analysisFailed',
      expectedTitle: 'Report title',
      route: 'local',
    },
  ])('stores a dropped source when $name', async (scenario) => {
    const fetcher: typeof fetch = (input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      if (url.endsWith('/url')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              source_id: 'source-test',
              title: 'Report title',
              final_url: 'https://example.invalid/report',
            }),
            {
              status: uploadStatus[scenario.expectedStatus] ?? 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
        )
      }
      if (url.includes('/source-bodies/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              source_id: 'source-test',
              article_id: 'article-example',
              body: 'The report describes a result.',
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        )
      }
      return Promise.resolve(
        new Response(
          'event: error\ndata: {"event":"error","data":{"message":"judge unavailable"}}\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
    }
    const errors: string[] = []
    const { content, doc } = mountMarkdownEditor(
      'A research sentence.',
      [],
      (doc) =>
        evidenceDrop(
          doc,
          'article-example',
          (message) => errors.push(message),
          () => undefined,
          evidenceDropOptions(fetcher, scenario.route ?? 'server'),
        ),
    )
    vi.spyOn(EditorView.prototype, 'posAtCoords').mockReturnValue(5)
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/uri-list', 'https://example.invalid/report')
    const drop = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    })
    content?.dispatchEvent(drop)
    await vi.waitFor(() => {
      if (doc.getMap('sources').size !== 1)
        throw new Error('The dropped source was not saved')
    })

    expect(
      readDroppedEvidenceOutput(drop.defaultPrevented, doc, errors, undefined),
    ).toEqual({
      prevented: true,
      errors: [scenario.expectedError],
      source: [
        {
          status: scenario.expectedStatus,
          title: scenario.expectedTitle,
          url: 'https://example.invalid/report',
        },
      ],
      evidence: [],
      claimRequest: undefined,
    })
  })

  it.each([
    { name: 'Escape is pressed', event: 'escape' },
    { name: 'the connection is lost', event: 'offline' },
  ])('cancels a dropped URL when $name', async (scenario) => {
    let signal: AbortSignal | undefined
    let resolveAbort: (() => void) | undefined
    const aborted = new Promise<void>((resolve) => {
      resolveAbort = resolve
    })
    const fetcher: typeof fetch = (_input, init) => {
      signal = init?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            resolveAbort?.()
            reject(new DOMException('Request aborted', 'AbortError'))
          },
          { once: true },
        )
      })
    }
    const errors: string[] = []
    const { content, doc } = mountMarkdownEditor(
      'A research sentence.',
      [],
      (doc) =>
        evidenceDrop(
          doc,
          'article-example',
          (message) => errors.push(message),
          () => undefined,
          evidenceDropOptions(fetcher),
        ),
    )
    vi.spyOn(EditorView.prototype, 'posAtCoords').mockReturnValue(5)
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/uri-list', 'https://example.invalid/report')
    const drop = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    })
    content?.dispatchEvent(drop)
    await vi.waitFor(() => {
      if (!signal) throw new Error('The source request did not start')
    })
    act(() => {
      window.dispatchEvent(
        scenario.event === 'escape'
          ? new KeyboardEvent('keydown', { key: 'Escape' })
          : new Event('offline'),
      )
    })
    await aborted
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0)
    })

    expect(
      readDroppedEvidenceOutput(drop.defaultPrevented, doc, errors, undefined),
    ).toEqual({
      prevented: true,
      errors: [],
      source: [],
      evidence: [],
      claimRequest: undefined,
    })
  })

  it('imports a dropped URL and saves its judgment for the sentence', async () => {
    const claim = 'This result improved.'
    const requests: { url: string; body: string | null }[] = []
    let sourceId = ''
    const fetcher: typeof fetch = (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      const body = typeof init?.body === 'string' ? init.body : null
      requests.push({ url, body })
      const sourceIdInPath = url.split('/source-bodies/')[1]?.split('/')[0]
      if (sourceIdInPath !== undefined) sourceId = sourceIdInPath
      if (url.endsWith('/url')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              source_id: sourceId,
              title: 'Report title',
              final_url: 'https://example.invalid/report',
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        )
      }
      if (url.includes('/source-bodies/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              source_id: sourceId,
              article_id: 'article-example',
              body: 'The report says this result improved.',
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        )
      }
      return Promise.resolve(
        new Response(
          `event: result\ndata: {"event":"result","data":{"verdict":"supported","quote":{"source_id":"${sourceId}","text":"This result improved."}}}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
    }
    const errors: string[] = []
    const { content, doc } = mountMarkdownEditor(claim, [], (doc) =>
      evidenceDrop(
        doc,
        'article-example',
        (message) => errors.push(message),
        () => undefined,
        evidenceDropOptions(fetcher),
      ),
    )
    vi.spyOn(EditorView.prototype, 'posAtCoords').mockReturnValue(5)
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/uri-list', 'https://example.invalid/report')
    const drop = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    })
    content?.dispatchEvent(drop)
    await vi.waitFor(() => {
      if (doc.getMap('evidence').size !== 1)
        throw new Error('The judgment was not attached to the sentence')
    })
    const claimRequest = requests.find(({ url }) =>
      url.endsWith('/api/research/claim-evidence'),
    )?.body
    const normalizedClaimRequest = claimRequest?.replace(
      /"id":"[^"]+"/u,
      '"id":"source-id"',
    )

    expect(
      readDroppedEvidenceOutput(
        drop.defaultPrevented,
        doc,
        errors,
        normalizedClaimRequest,
      ),
    ).toEqual({
      prevented: true,
      errors: [],
      source: [
        {
          title: 'Report title',
          url: 'https://example.invalid/report',
          status: 'ready',
        },
      ],
      evidence: [
        {
          claim,
          currentClaim: claim,
          edited: false,
          quote: 'This result improved.',
          verdict: 'supported',
        },
      ],
      claimRequest:
        '{"claim":"This result improved.","sources":[{"id":"source-id","body":"The report says this result improved."}]}',
    })
  })

  it('keeps an internal drag on CodeMirror’s move path and accepts the next URL drop', async () => {
    const url = 'https://example.invalid/report'
    const markdown = `Start ${url} end.`
    let requestCount = 0
    const fetcher: typeof fetch = (input) => {
      requestCount += 1
      const requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      const sourceId = 'drop-id-0'
      if (requestUrl.endsWith('/url')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              source_id: sourceId,
              title: 'Report title',
              final_url: url,
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        )
      }
      if (requestUrl.includes('/source-bodies/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              source_id: sourceId,
              article_id: 'article-example',
              body: 'The report supports the sentence.',
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        )
      }
      return Promise.resolve(
        new Response(
          `event: result\ndata: {"event":"result","data":{"verdict":"supported","quote":{"source_id":"${sourceId}","text":"A supporting sentence."}}}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
    }
    const { content, doc } = mountMarkdownEditor(markdown, [], (doc) =>
      evidenceDrop(
        doc,
        'article-example',
        () => undefined,
        () => undefined,
        evidenceDropOptions(fetcher),
      ),
    )
    const view = content ? EditorView.findFromDOM(content) : null
    if (!view) throw new Error('CodeMirror view was not rendered')
    const from = markdown.indexOf(url)
    view.dispatch({ selection: { anchor: from, head: from + url.length } })
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/plain', url)
    vi.spyOn(EditorView.prototype, 'posAtCoords').mockReturnValue(0)
    content?.dispatchEvent(
      new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      }),
    )
    const drop = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    })
    content?.dispatchEvent(drop)
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve()
      })
    })
    const externalDataTransfer = new DataTransfer()
    externalDataTransfer.setData('text/uri-list', url)
    const externalDrop = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: externalDataTransfer,
    })
    content?.dispatchEvent(externalDrop)
    await vi.waitFor(() => {
      if (doc.getMap('evidence').size !== 1)
        throw new Error('The external drop did not save its judgment')
    })

    expect(
      readInternalDragRecoveryOutput(drop, externalDrop, doc, requestCount),
    ).toEqual({
      internalDropPrevented: true,
      externalDropPrevented: true,
      body: `${url}Start  end.`,
      sources: [{ id: 'drop-id-0', status: 'ready' }],
      evidence: [
        {
          claim: `${url}Start  end.`,
          currentClaim: `${url}Start  end.`,
          edited: false,
          verdict: 'supported',
        },
      ],
      requestCount: 3,
    })
  })

  it.each([
    {
      name: 'a file',
      kind: 'file',
      expectedBody: 'A ressource textearch sentence.',
      defaultPrevented: true,
    },
    {
      name: 'plain text that is not a URL',
      kind: 'text',
      expectedBody: 'A resordinary textearch sentence.',
      defaultPrevented: true,
    },
  ])(
    'leaves $name drops to CodeMirror’s default handling',
    async (scenario) => {
      let requestCount = 0
      const fetcher: typeof fetch = () => {
        requestCount += 1
        return Promise.resolve(new Response('{}'))
      }
      const { content, doc } = mountMarkdownEditor(
        'A research sentence.',
        [],
        (doc) =>
          evidenceDrop(
            doc,
            'article-example',
            () => undefined,
            () => undefined,
            evidenceDropOptions(fetcher),
          ),
      )
      vi.spyOn(EditorView.prototype, 'posAtCoords').mockReturnValue(5)
      const dataTransfer = new DataTransfer()
      if (scenario.kind === 'file')
        dataTransfer.items.add(
          new File(['source text'], 'source.txt', { type: 'text/plain' }),
        )
      else dataTransfer.setData('text/plain', 'ordinary text')
      const drop = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      })
      content?.dispatchEvent(drop)
      if (scenario.kind === 'file') {
        await vi.waitFor(() => {
          if (readBody(doc) !== scenario.expectedBody)
            throw new Error(
              'CodeMirror did not apply its default drop behavior',
            )
        })
      }

      expect(readFallbackDropOutput(drop, doc, requestCount)).toEqual({
        defaultPrevented: scenario.defaultPrevented,
        body: scenario.expectedBody,
        sourceIds: [],
        evidenceIds: [],
        requestCount: 0,
      })
    },
  )

  it('reattaches a pending judgment when its section moves', async () => {
    const claim = 'The result improved.'
    const markdown =
      '# Alpha\n\nOther sentence.\n\n# Beta\n\nThe result improved.'
    let sourceId = ''
    let resolveJudgement: ((response: Response) => void) | undefined
    let signalJudgementStarted: (() => void) | undefined
    const judgementStarted = new Promise<void>((resolve) => {
      signalJudgementStarted = resolve
    })
    const fetcher: typeof fetch = (input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      const sourceIdInPath = url.split('/source-bodies/')[1]?.split('/')[0]
      if (sourceIdInPath !== undefined) sourceId = sourceIdInPath
      if (url.endsWith('/url')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              source_id: sourceId,
              title: 'Report title',
              final_url: 'https://example.invalid/report',
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        )
      }
      if (url.includes('/source-bodies/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              source_id: sourceId,
              article_id: 'article-example',
              body: 'The report says the result improved.',
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        )
      }
      signalJudgementStarted?.()
      return new Promise((resolve) => {
        resolveJudgement = resolve
      })
    }
    vi.stubGlobal('fetch', fetcher)
    window.localStorage.removeItem('blog-writer.llm.route')
    window.localStorage.removeItem('blog-writer.llm.bridge-url')
    const errors: string[] = []
    const { content, doc, updateExtensions } = mountMarkdownEditor(
      markdown,
      [],
      undefined,
      {
        articleId: 'article-example',
        onEvidenceError: (message) => errors.push(message),
      },
    )
    vi.spyOn(EditorView.prototype, 'posAtCoords').mockReturnValue(
      markdown.indexOf(claim) + 5,
    )
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/uri-list', 'https://example.invalid/report')
    const drop = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    })
    content?.dispatchEvent(drop)
    await judgementStarted
    updateExtensions([
      EditorView.contentAttributes.of({ 'data-extension': 'updated' }),
    ])
    moveBlock(doc, {
      from: markdown.indexOf('# Beta'),
      destination: 0,
    })._unsafeUnwrap()
    const resolve = resolveJudgement
    if (!resolve) throw new Error('The claim judgment did not start')
    resolve(
      new Response(
        `event: result\ndata: {"event":"result","data":{"verdict":"supported","quote":{"source_id":"${sourceId}","text":"The result improved."}}}\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    )
    await vi.waitFor(() => {
      if (doc.getMap('evidence').size !== 1)
        throw new Error('The judgment was not attached to the moved sentence')
    })

    expect(readPendingMoveOutput(doc, errors)).toEqual({
      body: '# Beta\n\nThe result improved.\n\n# Alpha\n\nOther sentence.\n',
      errors: [],
      evidence: [
        {
          claim,
          currentClaim: claim,
          edited: false,
          verdict: 'supported',
        },
      ],
    })
  })

  it('shows heading and inline-code markers while the cursor is in their ranges', async () => {
    const markdownText = '## Heading **bold** and `code`'
    const cursorPosition = markdownText.indexOf('code') + 3
    const { content, host } = mountMarkdownEditor(markdownText)
    host.style.width = '800px'
    const view = content ? EditorView.findFromDOM(content) : null
    content?.focus()
    await act(async () => {
      await userEvent.keyboard('{End}{ArrowLeft}{ArrowLeft}')
    })
    const line = host.querySelector<HTMLElement>('.cm-line')
    const lineHeight = line
      ? Number.parseFloat(getComputedStyle(line).lineHeight)
      : Number.NaN

    const readOutput = () => ({
      text: content?.textContent,
      headingClass: host.querySelector('.cm-line')?.className,
      wrapped:
        !line ||
        !Number.isFinite(lineHeight) ||
        line.getBoundingClientRect().height > lineHeight * 1.5,
      selection: view?.state.selection.main.head,
    })

    expect(readOutput()).toEqual({
      text: '## Heading bold and `code`',
      headingClass: 'cm-line cm-md-heading cm-md-heading-2',
      wrapped: false,
      selection: cursorPosition,
    })
  })

  it('accepts additional CodeMirror extensions', () => {
    const { content } = mountMarkdownEditor('body', [
      EditorView.contentAttributes.of({ 'data-extension': 'included' }),
    ])

    expect(content?.getAttribute('data-extension')).toEqual('included')
  })

  it('opens a source card from the sentence marker and removes its evidence', async () => {
    const claim = 'A research sentence.'
    const { doc, host } = mountMarkdownEditor(claim)
    act(() => {
      addSource(doc, {
        id: 'source-example',
        kind: 'url',
        title: 'Example source',
        url: 'https://example.invalid/report',
        fileName: null,
        checkedAt: '2026-02-01T00:00:00.000Z',
        summary: 'A short source summary.',
      })._unsafeUnwrap()
      addEvidence(doc, {
        id: 'evidence-example',
        from: 0,
        to: claim.length,
        claim,
        sourceId: 'source-example',
        quote: 'A quoted sentence.',
        verdict: 'supported',
        checkedAt: '2026-02-01T00:00:00.000Z',
      })._unsafeUnwrap()
    })
    await vi.waitFor(() => {
      const rendered = host.querySelector('.cm-evidence-marker')
      if (!rendered) throw new Error('Evidence marker was not rendered')
      return rendered
    })
    const marker = host.querySelector<HTMLButtonElement>('.cm-evidence-marker')
    if (!marker) throw new Error('Evidence marker was not rendered')
    act(() => {
      marker.click()
    })
    const card = host.querySelector<HTMLElement>('.cm-evidence-card')
    const remove = card?.querySelector<HTMLButtonElement>('button')
    if (!remove)
      throw new Error('Evidence card did not render its remove action')
    await act(async () => {
      await userEvent.click(remove)
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve()
        })
      })
    })
    await vi.waitFor(() => {
      if (doc.getMap('evidence').size > 0)
        throw new Error('Evidence was not removed')
    })

    expect(readEvidenceCardOutput(marker, card, doc, host)).toEqual({
      markerClass: 'cm-evidence-marker cm-evidence-supported',
      cardConnected: false,
      remainingEvidence: [],
      remainingMarkers: 0,
    })
  })

  it.each([
    { name: 'the marker is clicked again', closeWithEscape: false },
    { name: 'Escape is pressed', closeWithEscape: true },
  ])('closes an open source card when $name', async (scenario) => {
    const claim = 'A research sentence.'
    const { doc, host } = mountMarkdownEditor(claim)
    act(() => {
      addSource(doc, {
        id: 'source-example',
        kind: 'url',
        title: 'Example source',
        url: 'https://example.invalid/report',
        fileName: null,
        checkedAt: '2026-02-01T00:00:00.000Z',
      })._unsafeUnwrap()
      addEvidence(doc, {
        id: 'evidence-example',
        from: 0,
        to: claim.length,
        claim,
        sourceId: 'source-example',
        quote: 'A quoted sentence.',
        verdict: 'supported',
        checkedAt: '2026-02-01T00:00:00.000Z',
      })._unsafeUnwrap()
    })
    await vi.waitFor(() => {
      if (!host.querySelector('.cm-evidence-marker'))
        throw new Error('Evidence marker was not rendered')
    })
    const marker = host.querySelector<HTMLButtonElement>('.cm-evidence-marker')
    if (!marker) throw new Error('Evidence marker was not rendered')
    act(() => {
      marker.click()
    })
    await vi.waitFor(() => {
      if (!host.querySelector('.cm-evidence-card'))
        throw new Error('Evidence card was not opened')
    })
    const card = host.querySelector<HTMLElement>('.cm-evidence-card')
    if (!card) throw new Error('Evidence card was not opened')
    act(() => {
      if (scenario.closeWithEscape)
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      else marker.click()
    })
    await vi.waitFor(() => {
      if (card.isConnected) throw new Error('Evidence card was not closed')
    })

    expect(readEvidenceCardOutput(marker, card, doc, host)).toEqual({
      markerClass: 'cm-evidence-marker cm-evidence-supported',
      cardConnected: false,
      remainingEvidence: ['evidence-example'],
      remainingMarkers: 1,
    })
  })

  it('numbers footnotes per source in reading order and marks sentences that need review', async () => {
    const { readFootnotes } = await mountFootnoteEditor()

    expect(readFootnotes()).toEqual({
      markers: ['[1]', '[?]', '[2]', '[1]'],
      needsReview: ['Second claim.'],
    })
  })

  it('marks a sentence edited after its check for review and renumbers the remaining footnotes', async () => {
    const { doc, readFootnotes } = await mountFootnoteEditor()
    act(() => {
      getBody(doc).insert('First'.length, ' edited')
    })
    await vi.waitFor(() => {
      if (readFootnotes().markers[0] !== '[?]')
        throw new Error('The edited sentence was not marked for review')
    })

    expect(readFootnotes()).toEqual({
      markers: ['[?]', '[?]', '[1]', '[2]'],
      needsReview: ['First edited claim.', 'Second claim.'],
    })
  })

  it('reconfigures extensions without remounting the editor', () => {
    const { content, host, updateExtensions } = mountMarkdownEditor('body')
    updateExtensions([
      EditorView.contentAttributes.of({ 'data-extension': 'included' }),
    ])

    const updatedContent = host.querySelector<HTMLElement>('.cm-content')
    const readOutput = () => ({
      sameContentElement: updatedContent === content,
      text: updatedContent?.textContent,
      extension: updatedContent?.getAttribute('data-extension'),
    })

    expect(readOutput()).toEqual({
      sameContentElement: true,
      text: 'body',
      extension: 'included',
    })
  })

  it('keeps a caller-provided editor height without adding a conflicting height', () => {
    const { host } = mountMarkdownEditor('body', [], undefined, {
      className: 'h-[240px]',
    })
    const readOutput = () => ({
      wrapperClassName: host.querySelector('.relative')?.className,
      editorHostClassName: host.querySelector('.relative > div')?.className,
    })

    expect(readOutput()).toEqual({
      wrapperClassName: 'relative h-full',
      editorHostClassName: 'h-[240px]',
    })
  })

  it('skips body stringification while typing with no evidence', () => {
    const { body, content, doc } = mountMarkdownEditor('A research sentence.')
    const toJSON = vi.spyOn(body, 'toJSON')
    toJSON.mockClear()
    const view = content ? EditorView.findFromDOM(content) : null
    view?.dispatch({ changes: { from: 0, insert: '!' } })

    expect(
      readTypingOutput(doc, toJSON.mock.calls.length, content?.textContent),
    ).toEqual({
      bodyStringifications: 0,
      text: '!A research sentence.',
      evidence: [],
    })
  })

  it('shows the opening Markdown marker when the cursor touches it', () => {
    const { content } = mountMarkdownEditor('**bold**')

    expect(content?.textContent).toEqual('**bold')
  })

  it('shows Markdown markers touched by the selection', () => {
    const { content } = mountMarkdownEditor('**bold**')
    const view = content ? EditorView.findFromDOM(content) : null
    view?.dispatch({ selection: { anchor: 0, head: 8 } })

    expect(content?.textContent).toEqual('**bold**')
  })

  it('preserves positions between separated body edits', () => {
    const { body, doc, editor } = mountMarkdownEditor('red 🦊 middle blue')
    const middle = Y.createRelativePositionFromTypeIndex(body, 9)

    act(() => {
      editor.current?.replaceBody('longer 🦊 middle gold')
    })

    const readOutput = () => ({
      body: body.toJSON(),
      middle: Y.createAbsolutePositionFromRelativePosition(middle, doc)?.index,
    })

    expect(readOutput()).toEqual({
      body: 'longer 🦊 middle gold',
      middle: 12,
    })
  })

  it('undoes a body replacement in one Yjs undo step', async () => {
    const { body, content, editor } = mountMarkdownEditor('red 🦊 middle blue')

    act(() => {
      editor.current?.replaceBody('longer 🦊 middle gold')
    })
    await act(async () => {
      await dispatchHistoryShortcut(content, 'undo')
    })

    expect(body.toJSON()).toEqual('red 🦊 middle blue')
  })

  it('applies a capped body replacement in one Yjs undo step', async () => {
    const unchanged = ' anchor '
    const previous = `${'a'.repeat(4_000)}${unchanged}${'a'.repeat(4_000)}\n`
    const replacement = `${'b'.repeat(4_000)}${unchanged}${'b'.repeat(4_000)}\n`
    const { body, content, editor } = mountMarkdownEditor(previous)

    act(() => {
      editor.current?.replaceBody(replacement)
    })
    const bodyAfterReplace = body.toJSON()
    await act(async () => {
      await dispatchHistoryShortcut(content, 'undo')
    })

    const readOutput = () => ({
      bodyAfterReplace,
      bodyAfterUndo: body.toJSON(),
    })

    expect(readOutput()).toEqual({
      bodyAfterReplace: replacement,
      bodyAfterUndo: previous,
    })
  })

  it('keeps typing before a body replacement in a separate Yjs undo step', async () => {
    const { body, content, editor } = mountMarkdownEditor('original body')
    content?.focus()
    await userEvent.keyboard('{End}')
    await userEvent.keyboard('!')

    act(() => {
      editor.current?.replaceBody('imported body')
    })
    await act(async () => {
      await dispatchHistoryShortcut(content, 'undo')
    })

    expect(body.toJSON()).toEqual('original body!')
  })

  it('restores evidence when a moved section is undone in the editor', async () => {
    const markdown = '# Alpha\n\nFirst sentence.\n\n# Beta\n\nFinal sentence.'
    const claim = 'Final sentence.'
    const { content, doc, history, host } = mountMarkdownEditor(
      markdown,
      [],
      undefined,
      {
        prepareDoc: (doc) => {
          addSource(doc, {
            id: 'source-example',
            kind: 'url',
            title: 'Example source',
            url: 'https://example.invalid/report',
            fileName: null,
            checkedAt: '2026-02-01T00:00:00.000Z',
          })._unsafeUnwrap()
          addEvidence(doc, {
            id: 'evidence-example',
            from: markdown.indexOf(claim),
            to: markdown.length,
            claim,
            sourceId: 'source-example',
            quote: 'A quoted sentence.',
            verdict: 'supported',
            checkedAt: '2026-02-01T00:00:00.000Z',
          })._unsafeUnwrap()
        },
      },
    )
    const view = content ? EditorView.findFromDOM(content) : null
    if (!view) throw new Error('CodeMirror view was not rendered')
    act(() => {
      history
        .move(
          {
            from: markdown.indexOf('# Beta'),
            destination: 0,
          },
          view,
        )
        ._unsafeUnwrap()
    })
    await act(async () => {
      await dispatchHistoryShortcut(content, 'undo')
    })

    expect(readEditorEvidenceOutput(doc, host)).toEqual({
      body: markdown,
      evidence: [
        {
          id: 'evidence-example',
          currentClaim: claim,
          edited: false,
        },
      ],
      markers: 1,
    })
  })

  it('restores a hidden evidence range on undo and hides it again on redo', async () => {
    const markdown =
      '# Alpha\n\nFirst sentence.\n\n# Beta\n\nSecond sentence.\n'
    const movedMarkdown =
      '# Beta\n\nSecond sentence.\n\n# Alpha\n\nFirst sentence.\n'
    const claim = 'First sentence.\n\n# Beta\n\nSecond sentence.'
    const from = markdown.indexOf('First sentence.')
    const to = markdown.indexOf('Second sentence.') + 'Second sentence.'.length
    const { content, doc, history, host } = mountMarkdownEditor(
      markdown,
      [],
      undefined,
      {
        prepareDoc: (doc) => {
          addSource(doc, {
            id: 'source-example',
            kind: 'url',
            title: 'Example source',
            url: 'https://example.invalid/report',
            fileName: null,
            checkedAt: '2026-02-01T00:00:00.000Z',
          })._unsafeUnwrap()
          addEvidence(doc, {
            id: 'evidence-example',
            from,
            to,
            claim,
            sourceId: 'source-example',
            quote: 'A quoted sentence.',
            verdict: 'supported',
            checkedAt: '2026-02-01T00:00:00.000Z',
          })._unsafeUnwrap()
        },
      },
    )
    const view = content ? EditorView.findFromDOM(content) : null
    if (!view) throw new Error('CodeMirror view was not rendered')
    act(() => {
      history
        .move({ from: 0, destination: markdown.length }, view)
        ._unsafeUnwrap()
    })
    const afterMove = readEditorEvidenceOutput(doc, host)
    await act(async () => {
      await dispatchHistoryShortcut(content, 'undo')
    })
    await vi.waitFor(() => {
      if (
        readBody(doc) !== markdown ||
        host.querySelectorAll('.cm-evidence-marker').length !== 1
      )
        throw new Error('Undo did not restore the hidden evidence')
    })
    const afterUndo = readEditorEvidenceOutput(doc, host)
    await act(async () => {
      await dispatchHistoryShortcut(content, 'redo')
    })
    await vi.waitFor(() => {
      if (
        readBody(doc) !== movedMarkdown ||
        host.querySelectorAll('.cm-evidence-marker').length !== 0
      )
        throw new Error('Redo did not hide the evidence again')
    })

    expect(
      readEvidenceUndoRedoOutput(
        afterMove,
        afterUndo,
        readEditorEvidenceOutput(doc, host),
      ),
    ).toEqual({
      afterMove: {
        body: movedMarkdown,
        evidence: [],
        markers: 0,
      },
      afterUndo: {
        body: markdown,
        evidence: [
          {
            id: 'evidence-example',
            currentClaim: claim,
            edited: false,
          },
        ],
        markers: 1,
      },
      afterRedo: {
        body: movedMarkdown,
        evidence: [],
        markers: 0,
      },
    })
  })
})
