import '#index.css'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import * as Y from 'yjs'

import { getBody, getPremise, setBody, setPremise } from '#article/index'
import { PremiseProposalAccessory } from '#proposals/premise'
import type { PremiseResponse } from '#proposals/premise-api'

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
    setBody(articleDoc, '# Opening\n\n## Details\nA paragraph.\n')
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

    await act(async () => {
      await vi.waitFor(() => {
        expect(
          host?.querySelector(
            '[aria-label="Conversation history"] li:nth-child(2) p',
          )?.textContent,
        ).toEqual('Who should use this process first?')
      })
    })
    await act(async () => {
      await userEvent.click(
        page
          .getByRole('region', { name: 'Reader suggestion' })
          .getByRole('button', { name: '✓ 採用' }),
      )
      await userEvent.click(
        page
          .getByRole('region', { name: 'Claim suggestion' })
          .getByRole('button', { name: '× 却下' }),
      )
      const input = page.getByRole('textbox', {
        name: 'Continue the discussion',
      })
      await userEvent.type(input, 'Make the purpose actionable')
      await userEvent.click(page.getByRole('button', { name: 'Send' }))
    })

    await act(async () => {
      await vi.waitFor(() => {
        expect(
          host?.querySelector(
            '[aria-label="Conversation history"] li:last-child p',
          )?.textContent,
        ).toEqual('The purpose can focus on a specific decision.')
      })
    })
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
    await act(async () => {
      await vi.waitFor(() => {
        expect(
          host?.querySelector(
            '[aria-label="Conversation history"] li:nth-child(2) p',
          )?.textContent,
        ).toEqual('What decision should the article explain?')
      })
    })

    const actual = () => ({
      acceptedPremise,
      persistedPremise: getPremise(articleDoc),
      requestPayloads: requests,
      body: getBody(articleDoc).toJSON(),
    })
    expect(actual()).toEqual({
      acceptedPremise: {
        audience: 'New maintainers',
        purpose: 'Explain a useful process',
        claim: 'A clear process reduces confusion',
      },
      persistedPremise: {
        audience: 'New maintainers',
        purpose: 'Explain a useful process',
        claim: 'A clear process reduces confusion',
      },
      requestPayloads: [
        {
          premise: {
            audience: 'Existing readers',
            purpose: 'Explain a useful process',
            thesis: 'A clear process reduces confusion',
          },
          headings: ['Opening', 'Details'],
          messages: [{ role: 'user', content: 'Clarify the audience' }],
        },
        {
          premise: {
            audience: 'New maintainers',
            purpose: 'Explain a useful process',
            thesis: 'A clear process reduces confusion',
          },
          headings: ['Opening', 'Details'],
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
            audience: 'New maintainers',
            purpose: 'Explain a useful process',
            thesis: 'A clear process reduces confusion',
          },
          headings: ['Opening', 'Details'],
          messages: [{ role: 'user', content: 'Start a fresh discussion' }],
        },
      ],
      body: '# Opening\n\n## Details\nA paragraph.\n',
    })
  })

  it('shows a failed request and keeps the current premise unchanged', async () => {
    const articleDoc = new Y.Doc()
    doc = articleDoc
    setPremise(articleDoc, 'audience', 'Existing readers')
    setPremise(articleDoc, 'purpose', 'Explain a useful process')
    setPremise(articleDoc, 'claim', 'A clear process reduces confusion')
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(null, { status: 503 })),
    )

    renderAccessory(articleDoc)
    await act(async () => {
      await userEvent.type(
        page.getByRole('textbox', { name: 'Continue the discussion' }),
        'Clarify the audience',
      )
      await userEvent.click(page.getByRole('button', { name: 'Send' }))
      await vi.waitFor(() => {
        expect(host?.querySelector('[role="alert"]')?.textContent).toEqual(
          'LLM API returned status 503',
        )
      })
    })

    const actual = () => ({
      alert: host?.querySelector('[role="alert"]')?.textContent ?? null,
      premise: getPremise(articleDoc),
    })
    expect(actual()).toEqual({
      alert: 'LLM API returned status 503',
      premise: {
        audience: 'Existing readers',
        purpose: 'Explain a useful process',
        claim: 'A clear process reduces confusion',
      },
    })
  })
})
