import { describe, expect, it } from 'vitest'

import { importClaimEvidence } from '#research/claim-evidence'

function readImportOutput(
  result: Awaited<ReturnType<typeof importClaimEvidence>>,
  requests: { url: string; method: string; body: string | null }[],
) {
  return {
    result: result.match(
      (value) => value,
      (error) => ({ error: error.message }),
    ),
    requests,
  }
}

describe('claim evidence import', () => {
  it.each([
    {
      name: 'server route',
      settings: { route: 'server', bridgeUrl: '' } as const,
      judgementUrl: '/api/research/claim-evidence',
      publishedAt: '2025-03-04',
      expectedPublishedAt: '2025-03-04',
    },
    {
      name: 'local route',
      settings: {
        route: 'local',
        bridgeUrl: 'https://bridge.example.invalid/base/',
      } as const,
      judgementUrl:
        'https://bridge.example.invalid/base/api/research/claim-evidence',
      publishedAt: '2025-03-04',
      expectedPublishedAt: '2025-03-04',
    },
    {
      name: 'server route for a page without a published date',
      settings: { route: 'server', bridgeUrl: '' } as const,
      judgementUrl: '/api/research/claim-evidence',
      publishedAt: undefined,
      expectedPublishedAt: null,
    },
  ])(
    'fetches source text from the server and sends judgment requests through the $name',
    async ({ settings, judgementUrl, publishedAt, expectedPublishedAt }) => {
      const requests: { url: string; method: string; body: string | null }[] =
        []
      const fetcher: typeof fetch = (input, init) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        const method = init?.method ?? 'GET'
        const body = typeof init?.body === 'string' ? init.body : null
        requests.push({ url, method, body })
        if (url.endsWith('/url')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                source_id: 'source-test',
                title: 'Research report',
                final_url: 'https://example.invalid/report',
                published_at: publishedAt,
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
          )
        }
        if (url.includes('/source-bodies/')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                source_id: 'source-test',
                article_id: 'article-test',
                body: 'The report says the value increased.',
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
          )
        }
        return Promise.resolve(
          new Response(
            'event: result\ndata: {"event":"result","data":{"verdict":"supported","quote":{"source_id":"source-test","text":"The value increased."}}}\n\n',
            { headers: { 'content-type': 'text/event-stream' } },
          ),
        )
      }
      const result = await importClaimEvidence(
        fetcher,
        'article-test',
        'source-test',
        'https://example.invalid/report',
        'The value increased.',
        settings,
        new AbortController().signal,
      )

      expect(readImportOutput(result, requests)).toEqual({
        result: {
          title: 'Research report',
          url: 'https://example.invalid/report',
          publishedAt: expectedPublishedAt,
          verdict: 'supported',
          quote: 'The value increased.',
        },
        requests: [
          {
            url: '/api/articles/article-test/source-bodies/source-test/url',
            method: 'POST',
            body: '{"url":"https://example.invalid/report"}',
          },
          {
            url: '/api/articles/article-test/source-bodies/source-test',
            method: 'GET',
            body: null,
          },
          {
            url: judgementUrl,
            method: 'POST',
            body: '{"claim":"The value increased.","sources":[{"id":"source-test","body":"The report says the value increased."}]}',
          },
        ],
      })
    },
  )
})
