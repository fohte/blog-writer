import { describe, expect, it } from 'vitest'

import type { WriteFromKeyPointsRequest } from '#proposals/write-from-key-points-api'
import { requestWriteFromKeyPoints } from '#proposals/write-from-key-points-api'

describe('requestWriteFromKeyPoints', () => {
  it('posts to the local bridge route and parses written sentences', async () => {
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
          'data: {"event":"result","data":{"sentences":[{"text":"A measured change occurred.","is_factual":true,"key_point_ids":["point-example"]}]}}\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
    }
    const body: WriteFromKeyPointsRequest = {
      premise: { audience: '', purpose: '', thesis: '' },
      target_heading_id: 'block-0',
      blocks: [],
      sources: [],
    }

    const actual = await requestWriteFromKeyPoints(
      fetcher,
      { route: 'local', bridgeUrl: 'http://localhost:8080/' },
      body,
      new AbortController().signal,
    ).match(
      (result) => ({ kind: 'ok', result }),
      (cause) => ({ kind: 'error', message: cause.message }),
    )

    const readOutput = () => ({ actual, captured })
    expect(readOutput()).toEqual({
      actual: {
        kind: 'ok',
        result: {
          sentences: [
            {
              text: 'A measured change occurred.',
              is_factual: true,
              key_point_ids: ['point-example'],
            },
          ],
        },
      },
      captured: {
        url: 'http://localhost:8080/api/write-from-key-points',
        body: JSON.stringify(body),
        method: 'POST',
      },
    })
  })
})
