import { EditorView } from '@codemirror/view'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import * as Y from 'yjs'

import { addEvidence } from '#article/evidence'
import { listEvidence, listSources, moveBlock, readBody } from '#article/index'
import { addSource } from '#article/sources'
import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'
import { evidenceDrop } from '#editor/evidence-drop'

function readEvidenceCardOutput(
  marker: HTMLButtonElement,
  card: HTMLElement | null,
  doc: Y.Doc,
) {
  return {
    markerClass: marker.className,
    cardConnected: card?.isConnected,
    remainingEvidence: [...doc.getMap('evidence').keys()],
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

describe('MarkdownEditor', () => {
  it.each([
    {
      name: 'source retrieval fails',
      expectedError: '資料ページを取得できませんでした: HTTP 500',
      expectedStatus: 'unavailable',
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
              status: scenario.expectedStatus === 'unavailable' ? 500 : 200,
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
    vi.stubGlobal('fetch', fetcher)
    window.localStorage.removeItem('blog-writer.llm.route')
    window.localStorage.removeItem('blog-writer.llm.bridge-url')
    if ('route' in scenario) {
      window.localStorage.setItem('blog-writer.llm.route', scenario.route)
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
    vi.stubGlobal('fetch', fetcher)
    window.localStorage.removeItem('blog-writer.llm.route')
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
    vi.stubGlobal('fetch', fetcher)
    window.localStorage.removeItem('blog-writer.llm.route')
    const errors: string[] = []
    const { content, doc } = mountMarkdownEditor(claim, [], (doc) =>
      evidenceDrop(
        doc,
        'article-example',
        (message) => errors.push(message),
        () => undefined,
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

  it('reattaches a pending judgment when its section moves', async () => {
    const claim = 'The result improved.'
    const markdown =
      '# Alpha\n\nThe result improved.\n\n# Beta\n\nOther sentence.\n'
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
    const errors: string[] = []
    const { content, doc } = mountMarkdownEditor(markdown, [], (doc) =>
      evidenceDrop(
        doc,
        'article-example',
        (message) => errors.push(message),
        () => undefined,
      ),
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
    moveBlock(doc, { from: 0, destination: markdown.length })._unsafeUnwrap()
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
      body: '# Beta\n\nOther sentence.\n\n# Alpha\n\nThe result improved.\n',
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

  it('shows heading and inline-code markers while the cursor is in their ranges', () => {
    const { content, host } = mountMarkdownEditor(
      '## Heading **bold** and `code`',
    )
    content?.focus()
    content?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    )
    content?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    )
    content?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    )

    const readOutput = () => ({
      text: content?.textContent,
      headingClass: host.querySelector('.cm-line')?.className,
    })

    expect(readOutput()).toEqual({
      text: '## Heading bold and `code`',
      headingClass: 'cm-line cm-md-heading cm-md-heading-2',
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

    expect(readEvidenceCardOutput(marker, card, doc)).toEqual({
      markerClass: 'cm-evidence-marker cm-evidence-supported',
      cardConnected: false,
      remainingEvidence: [],
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

  it('undoes a body replacement in one Yjs undo step', () => {
    const { body, content, editor } = mountMarkdownEditor('red 🦊 middle blue')

    act(() => {
      editor.current?.replaceBody('longer 🦊 middle gold')
    })
    content?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        bubbles: true,
        [navigator.platform.includes('Mac') ? 'metaKey' : 'ctrlKey']: true,
      }),
    )

    expect(body.toJSON()).toEqual('red 🦊 middle blue')
  })

  it('applies a capped body replacement in one Yjs undo step', () => {
    const unchanged = ' anchor '
    const previous = `${'a'.repeat(4_000)}${unchanged}${'a'.repeat(4_000)}\n`
    const replacement = `${'b'.repeat(4_000)}${unchanged}${'b'.repeat(4_000)}\n`
    const { body, content, editor } = mountMarkdownEditor(previous)

    act(() => {
      editor.current?.replaceBody(replacement)
    })
    const bodyAfterReplace = body.toJSON()
    content?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        bubbles: true,
        [navigator.platform.includes('Mac') ? 'metaKey' : 'ctrlKey']: true,
      }),
    )

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
    content?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        bubbles: true,
        [navigator.platform.includes('Mac') ? 'metaKey' : 'ctrlKey']: true,
      }),
    )

    expect(body.toJSON()).toEqual('original body!')
  })
})
