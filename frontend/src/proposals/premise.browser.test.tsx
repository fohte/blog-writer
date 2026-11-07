import '#index.css'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import * as Y from 'yjs'

import { getBody, getPremise, setBody, setPremise } from '#article/index'
import type { components } from '#lib/api/schema.gen.d.ts'
import { PremiseProposalAccessory } from '#proposals/premise'

type PremiseResponse = components['schemas']['PremiseResponse']

let host: HTMLDivElement | undefined
let root: Root | undefined
let doc: Y.Doc | undefined
let previousRoute: string | null = null

function renderAccessory(articleDoc: Y.Doc) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root?.render(<PremiseProposalAccessory doc={articleDoc} />)
  })
}

function unmountAccessory() {
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
}

async function waitForRequestToFinish() {
  await act(async () => {
    await vi.waitFor(() => {
      if (host?.querySelector('[role="status"]') !== null) {
        throw new Error('The premise request is still running')
      }
    })
  })
}

async function waitForProposalCount(expected: number) {
  await act(async () => {
    await vi.waitFor(() => {
      if (
        (host?.querySelectorAll('[aria-label$="suggestion"]').length ?? 0) !==
        expected
      ) {
        throw new Error('The expected premise suggestions are not visible')
      }
    })
  })
}

function createSseResponse(response: PremiseResponse): Response {
  return new Response(
    `data: ${JSON.stringify({ event: 'result', data: response })}\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await page.viewport(1024, 768)
  previousRoute = window.localStorage.getItem('blog-writer.llm.route')
  window.localStorage.setItem('blog-writer.llm.route', 'server')
})

afterEach(() => {
  unmountAccessory()
  doc?.destroy()
  doc = undefined
  if (previousRoute === null) {
    window.localStorage.removeItem('blog-writer.llm.route')
  } else {
    window.localStorage.setItem('blog-writer.llm.route', previousRoute)
  }
  vi.unstubAllGlobals()
})

describe('premise proposal accessory', () => {
  it('sends the open conversation and persists only accepted field values', async () => {
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setBody(
      articleDoc,
      '# Opening\n\n## Details\n\n### Deep detail\nA paragraph.\n',
    )
    setPremise(articleDoc, 'audience', 'Existing readers')
    setPremise(articleDoc, 'purpose', 'Explain a useful process')
    setPremise(articleDoc, 'claim', 'A clear process reduces confusion')

    const responses: PremiseResponse[] = [
      {
        reply: 'Who should use this process first?',
        audience: 'New maintainers',
        thesis: 'A short checklist helps new maintainers catch risky changes',
      },
      {
        reply: 'The purpose can focus on a specific decision.',
        purpose: 'Help new maintainers decide which changes need review',
      },
      { reply: 'What decision should the article explain?' },
    ]
    const requests: unknown[] = []
    const fetcher: typeof fetch = (_input, init) => {
      if (typeof init?.body !== 'string') {
        return Promise.reject(new Error('The request body was not a string'))
      }
      requests.push(JSON.parse(init.body))
      const response = responses.shift()
      if (!response) {
        return Promise.reject(new Error('No response was queued'))
      }
      return Promise.resolve(
        new Response(
          `data: ${JSON.stringify({ event: 'result', data: response })}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
    }
    vi.stubGlobal('fetch', fetcher)

    renderAccessory(articleDoc)
    await act(async () => {
      await userEvent.type(
        page.getByRole('textbox', { name: 'Continue the discussion' }),
        'Clarify the audience',
      )
      await userEvent.click(page.getByRole('button', { name: 'Send' }))
    })

    await waitForRequestToFinish()
    await act(async () => {
      await userEvent.click(
        page
          .getByRole('region', { name: 'Claim suggestion' })
          .getByRole('button', { name: '✓ 採用' }),
      )
      await userEvent.click(
        page
          .getByRole('region', { name: 'Reader suggestion' })
          .getByRole('button', { name: '× 却下' }),
      )
      const input = page.getByRole('textbox', {
        name: 'Continue the discussion',
      })
      await userEvent.type(input, 'Make the purpose actionable')
      await userEvent.click(page.getByRole('button', { name: 'Send' }))
    })

    await waitForRequestToFinish()
    const acceptedPremise = getPremise(articleDoc)

    unmountAccessory()
    renderAccessory(articleDoc)
    await act(async () => {
      await userEvent.type(
        page.getByRole('textbox', { name: 'Continue the discussion' }),
        'Start a fresh discussion',
      )
      await userEvent.click(page.getByRole('button', { name: 'Send' }))
    })
    await waitForRequestToFinish()

    const actual = () => ({
      acceptedPremise,
      persistedPremise: getPremise(articleDoc),
      requestPayloads: requests,
      body: getBody(articleDoc).toJSON(),
      renderedState: {
        messages: Array.from(
          host?.querySelectorAll('[aria-label="Conversation history"] li') ??
            [],
        ).map((message) => ({
          speaker: message.querySelector('span')?.textContent ?? null,
          content: message.querySelector('p')?.textContent ?? null,
        })),
        suggestionCount:
          host?.querySelectorAll('[aria-label$="suggestion"]').length ?? 0,
        generating: host?.querySelector('[role="status"]')?.textContent ?? null,
        error: host?.querySelector('[role="alert"]')?.textContent ?? null,
        draft:
          host?.querySelector<HTMLTextAreaElement>('textarea')?.value ?? null,
      },
    })
    expect(actual()).toEqual({
      acceptedPremise: {
        audience: 'Existing readers',
        purpose: 'Explain a useful process',
        claim: 'A short checklist helps new maintainers catch risky changes',
      },
      persistedPremise: {
        audience: 'Existing readers',
        purpose: 'Explain a useful process',
        claim: 'A short checklist helps new maintainers catch risky changes',
      },
      requestPayloads: [
        {
          premise: {
            audience: 'Existing readers',
            purpose: 'Explain a useful process',
            thesis: 'A clear process reduces confusion',
          },
          headings: ['# Opening', '## Details', '### Deep detail'],
          messages: [{ role: 'user', content: 'Clarify the audience' }],
        },
        {
          premise: {
            audience: 'Existing readers',
            purpose: 'Explain a useful process',
            thesis:
              'A short checklist helps new maintainers catch risky changes',
          },
          headings: ['# Opening', '## Details', '### Deep detail'],
          messages: [
            { role: 'user', content: 'Clarify the audience' },
            {
              role: 'assistant',
              content: 'Who should use this process first?',
            },
            { role: 'user', content: 'Make the purpose actionable' },
          ],
        },
        {
          premise: {
            audience: 'Existing readers',
            purpose: 'Explain a useful process',
            thesis:
              'A short checklist helps new maintainers catch risky changes',
          },
          headings: ['# Opening', '## Details', '### Deep detail'],
          messages: [{ role: 'user', content: 'Start a fresh discussion' }],
        },
      ],
      body: '# Opening\n\n## Details\n\n### Deep detail\nA paragraph.\n',
      renderedState: {
        messages: [
          {
            speaker: 'You',
            content: 'Start a fresh discussion',
          },
          {
            speaker: 'Assistant',
            content: 'What decision should the article explain?',
          },
        ],
        suggestionCount: 0,
        generating: null,
        error: null,
        draft: '',
      },
    })
  })

  it('discards displayed proposals for locally and remotely edited fields', async () => {
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setPremise(articleDoc, 'audience', 'Existing readers')
    setPremise(articleDoc, 'purpose', 'Explain a useful process')
    setPremise(articleDoc, 'claim', 'A clear process reduces confusion')
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        createSseResponse({
          reply: 'These three fields can be more specific.',
          audience: 'New maintainers',
          purpose: 'Help readers choose a safe process',
          thesis: 'A short checklist helps readers catch risky changes',
        }),
      ),
    )

    renderAccessory(articleDoc)
    await act(async () => {
      await userEvent.type(
        page.getByRole('textbox', { name: 'Continue the discussion' }),
        'Clarify the premise',
      )
      await userEvent.click(page.getByRole('button', { name: 'Send' }))
    })
    await waitForRequestToFinish()
    await waitForProposalCount(3)

    act(() => {
      setPremise(articleDoc, 'audience', 'Locally edited readers')
    })
    await waitForProposalCount(2)

    const remoteDoc = new Y.Doc()
    Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(articleDoc))
    setPremise(remoteDoc, 'claim', 'A remote reader edit changed the claim')
    act(() => {
      Y.applyUpdate(
        articleDoc,
        Y.encodeStateAsUpdate(remoteDoc, Y.encodeStateVector(articleDoc)),
      )
    })
    remoteDoc.destroy()
    await waitForProposalCount(1)

    const actual = () => ({
      premise: getPremise(articleDoc),
      proposals: Array.from(
        host?.querySelectorAll('[aria-label$="suggestion"]') ?? [],
      ).map((proposal) => ({
        label: proposal.querySelector('h3')?.textContent ?? null,
        original: proposal.querySelector('del')?.textContent ?? null,
        replacement: proposal.querySelector('ins')?.textContent ?? null,
      })),
    })
    expect(actual()).toEqual({
      premise: {
        audience: 'Locally edited readers',
        purpose: 'Explain a useful process',
        claim: 'A remote reader edit changed the claim',
      },
      proposals: [
        {
          label: 'Purpose',
          original: 'Explain a useful',
          replacement: 'Help readers choose a safe',
        },
      ],
    })
  })

  it('discards suggestions for fields edited while a request is generating', async () => {
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setPremise(articleDoc, 'audience', 'Existing readers')
    setPremise(articleDoc, 'purpose', 'Explain a useful process')
    setPremise(articleDoc, 'claim', 'A clear process reduces confusion')
    let resolveResponse: ((response: Response) => void) | undefined
    let requestCount = 0
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', ((_input, init) => {
      requestCount += 1
      requestSignal = init?.signal ?? undefined
      return new Promise<Response>((resolve) => {
        resolveResponse = resolve
      })
    }) satisfies typeof fetch)

    renderAccessory(articleDoc)
    await act(async () => {
      await userEvent.type(
        page.getByRole('textbox', { name: 'Continue the discussion' }),
        'Clarify the premise',
      )
      await userEvent.click(page.getByRole('button', { name: 'Send' }))
    })
    await act(async () => {
      await vi.waitFor(() => {
        if (
          resolveResponse === undefined ||
          host?.querySelector('[role="status"]')?.textContent !== 'Thinking…'
        ) {
          throw new Error('The request did not start')
        }
      })
    })
    await act(async () => {
      setPremise(articleDoc, 'purpose', 'Edited while generating')
      resolveResponse?.(
        createSseResponse({
          reply: 'The premise has become more specific.',
          audience: 'New maintainers',
          purpose: 'Use the new purpose suggestion',
          thesis: 'A checklist helps maintainers catch risky changes',
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const actual = () => ({
      premise: getPremise(articleDoc),
      proposals: Array.from(
        host?.querySelectorAll('[aria-label$="suggestion"]') ?? [],
      ).map((proposal) => proposal.querySelector('h3')?.textContent ?? null),
      generating: host?.querySelector('[role="status"]')?.textContent ?? null,
      error: host?.querySelector('[role="alert"]')?.textContent ?? null,
      requestCount,
      requestAborted: requestSignal?.aborted ?? null,
    })
    expect(actual()).toEqual({
      premise: {
        audience: 'Existing readers',
        purpose: 'Edited while generating',
        claim: 'A clear process reduces confusion',
      },
      proposals: ['Reader', 'Claim'],
      generating: null,
      error: null,
      requestCount: 1,
      requestAborted: false,
    })
  })

  it('preserves pending proposals when a follow-up request fails', async () => {
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setPremise(articleDoc, 'audience', 'Existing readers')
    setPremise(articleDoc, 'purpose', 'Explain a useful process')
    setPremise(articleDoc, 'claim', 'A clear process reduces confusion')
    let requestCount = 0
    vi.stubGlobal('fetch', (() => {
      requestCount += 1
      if (requestCount === 2) {
        return Promise.resolve(new Response(null, { status: 503 }))
      }
      return Promise.resolve(
        new Response(
          `data: ${JSON.stringify({
            event: 'result',
            data: {
              reply: 'The claim can name a useful outcome.',
              thesis:
                'A short review checklist helps new maintainers catch risky changes',
            },
          })}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
    }) satisfies typeof fetch)

    renderAccessory(articleDoc)
    await act(async () => {
      await userEvent.type(
        page.getByRole('textbox', { name: 'Continue the discussion' }),
        'Clarify the audience',
      )
      await userEvent.click(page.getByRole('button', { name: 'Send' }))
    })
    await waitForRequestToFinish()
    await act(async () => {
      const input = page.getByRole('textbox', {
        name: 'Continue the discussion',
      })
      await userEvent.type(input, 'Ask another question')
      await userEvent.click(page.getByRole('button', { name: 'Send' }))
    })
    await waitForRequestToFinish()

    const actual = () => ({
      alert: host?.querySelector('[role="alert"]')?.textContent ?? null,
      premise: getPremise(articleDoc),
      draft:
        host?.querySelector<HTMLTextAreaElement>('textarea')?.value ?? null,
      generating: host?.querySelector('[role="status"]')?.textContent ?? null,
      proposals: Array.from(
        host?.querySelectorAll('[aria-label$="suggestion"]') ?? [],
      ).map((proposal) => ({
        label: proposal.querySelector('h3')?.textContent ?? null,
        original: proposal.querySelector('del')?.textContent ?? null,
        replacement: proposal.querySelector('ins')?.textContent ?? null,
      })),
    })
    expect(actual()).toEqual({
      alert: 'LLM API returned status 503',
      premise: {
        audience: 'Existing readers',
        purpose: 'Explain a useful process',
        claim: 'A clear process reduces confusion',
      },
      draft: 'Ask another question',
      generating: null,
      proposals: [
        {
          label: 'Claim',
          original: 'clear process reduces confusion',
          replacement:
            'short review checklist helps new maintainers catch risky changes',
        },
      ],
    })
  })
})
