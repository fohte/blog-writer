import { describe, expect, it } from 'vitest'

import { requestPremiseProposal } from '#proposals/premise-api'

describe('requestPremiseProposal', () => {
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
          'data: {"event":"result","data":{"reply":"Which step should the article explain?"}}\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
    }
    const actual = await requestPremiseProposal(
      fetcher,
      { route: 'local', bridgeUrl: 'http://localhost:8080/' },
      {
        premise: { audience: '', purpose: '', thesis: '' },
        headings: [],
        messages: [{ role: 'user', content: 'Outline a short tutorial' }],
      },
      new AbortController().signal,
    ).match(
      (result) => ({ kind: 'ok', result }),
      (cause) => ({ kind: 'error', message: cause.message }),
    )

    const readOutput = () => ({ actual, requestedUrl })
    expect(readOutput()).toEqual({
      actual: {
        kind: 'ok',
        result: { reply: 'Which step should the article explain?' },
      },
      requestedUrl: 'http://localhost:8080/api/proposals/premise',
    })
  })
})
