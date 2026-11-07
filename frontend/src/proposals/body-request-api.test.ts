import { describe, expect, it } from 'vitest'

import { requestBodyProposal } from '#proposals/body-request-api'

describe('requestBodyProposal', () => {
  it('posts to the configured server route and parses the replacement result', async () => {
    const captured: {
      url?: string | undefined
      body?: string | undefined
      method?: string | undefined
    } = {}
    const fetcher: typeof fetch = (input, init) => {
      captured.url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      captured.body = typeof init?.body === 'string' ? init.body : undefined
      captured.method = init?.method
      return Promise.resolve(
        new Response(
          'data: {"event":"result","data":{"replacement":"A shorter sentence."}}\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
    }

    const actual = await requestBodyProposal(
      fetcher,
      { route: 'server', bridgeUrl: '' },
      {
        instruction: 'make it concise',
        premise: { audience: 'reader', purpose: 'purpose', claim: 'claim' },
        headings: ['# Article'],
        section:
          '# Article\n⟪依頼範囲の開始⟫This sentence is unnecessarily long.⟪依頼範囲の終了⟫',
        target: 'This sentence is unnecessarily long.',
      },
      new AbortController().signal,
    ).match(
      (result) => ({ kind: 'ok', result }),
      (cause) => ({ kind: 'error', message: cause.message }),
    )

    const readOutput = () => ({ actual, captured })
    expect(readOutput()).toEqual({
      actual: { kind: 'ok', result: { replacement: 'A shorter sentence.' } },
      captured: {
        url: '/api/proposals/body-request',
        body: JSON.stringify({
          instruction: 'make it concise',
          premise: { audience: 'reader', purpose: 'purpose', claim: 'claim' },
          headings: ['# Article'],
          section:
            '# Article\n⟪依頼範囲の開始⟫This sentence is unnecessarily long.⟪依頼範囲の終了⟫',
          target: 'This sentence is unnecessarily long.',
        }),
        method: 'POST',
      },
    })
  })

  it('posts to the local bridge route when local LLM settings are selected', async () => {
    let requestedUrl: string | undefined
    const fetcher: typeof fetch = (input) => {
      requestedUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      return Promise.resolve(
        new Response(
          'data: {"event":"result","data":{"replacement":"A shorter sentence."}}\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
    }

    const actual = await requestBodyProposal(
      fetcher,
      { route: 'local', bridgeUrl: 'http://localhost:8080/' },
      {
        instruction: 'make it concise',
        premise: { audience: '', purpose: '', claim: '' },
        headings: [],
        section: '⟪依頼範囲の開始⟫Text⟪依頼範囲の終了⟫',
        target: 'Text',
      },
      new AbortController().signal,
    ).match(
      (result) => ({ kind: 'ok', result }),
      (cause) => ({ kind: 'error', message: cause.message }),
    )

    const readOutput = () => ({ actual, requestedUrl })
    expect(readOutput()).toEqual({
      actual: { kind: 'ok', result: { replacement: 'A shorter sentence.' } },
      requestedUrl: 'http://localhost:8080/api/proposals/body-request',
    })
  })
})
