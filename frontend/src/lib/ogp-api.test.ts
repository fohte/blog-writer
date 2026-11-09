import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { createOgpFetcherCache, fetchOgp } from '#lib/ogp-api'

const response = {
  available: true,
  description: 'A short description.',
  final_url: 'https://docs.example.test/guide',
  image: 'https://assets.example.test/guide.webp',
  title: 'A useful guide',
}

function summarizeOgpResult(result: ReturnType<typeof fetchOgp>) {
  return result.match(
    (value) => ({ result: 'ok', value }),
    (error) => ({ result: 'error', message: error.message }),
  )
}

describe('fetchOgp', () => {
  it('posts the URL and returns the OGP response', async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(response)),
    )
    const result = await summarizeOgpResult(
      fetchOgp(fetcher, 'https://docs.example.test/guide'),
    )

    const readOutput = () => ({ result, requests: fetcher.mock.calls })
    expect(readOutput()).toEqual({
      result: { result: 'ok', value: response },
      requests: [
        [
          '/api/ogp',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: 'https://docs.example.test/guide' }),
          },
        ],
      ],
    })
  })

  it('returns an error when the endpoint responds unsuccessfully', async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ error: 'unavailable' }, { status: 502 })),
    )
    const result = await summarizeOgpResult(
      fetchOgp(fetcher, 'https://docs.example.test/guide'),
    )

    expect(result).toEqual({
      result: 'error',
      message: 'OGP request failed: 502',
    })
  })

  it('returns an error when a successful response has an invalid shape', async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          available: true,
          description: null,
          image: null,
          title: null,
        }),
      ),
    )
    const result = await summarizeOgpResult(
      fetchOgp(fetcher, 'https://docs.example.test/guide'),
    )

    expect(result).toEqual({
      result: 'error',
      message: 'OGP 応答の形式が正しくありません。',
    })
  })

  it('retries a URL after its request fails', async () => {
    const firstUrl = 'https://docs.example.test/first'
    let firstRequest = true
    const fetcher = vi.fn((url: string) => {
      if (url === firstUrl && firstRequest) {
        firstRequest = false
        return errAsync(new Error('temporary failure'))
      }
      return okAsync(response)
    })
    const cachedFetcher = createOgpFetcherCache(() => fetcher)
    const firstAttempt = await summarizeOgpResult(cachedFetcher(firstUrl))
    const retried = await summarizeOgpResult(cachedFetcher(firstUrl))

    const readOutput = () => ({
      firstAttempt,
      retried,
      requests: fetcher.mock.calls,
    })
    expect(readOutput()).toEqual({
      firstAttempt: { result: 'error', message: 'temporary failure' },
      retried: { result: 'ok', value: response },
      requests: [[firstUrl], [firstUrl]],
    })
  })

  it('caches successful results independently by URL', async () => {
    const firstUrl = 'https://docs.example.test/first'
    const secondUrl = 'https://docs.example.test/second'
    const secondResponse = { ...response, title: 'Another guide' }
    const fetcher = vi.fn((url: string) =>
      okAsync(url === firstUrl ? response : secondResponse),
    )
    const cachedFetcher = createOgpFetcherCache(() => fetcher)
    const firstUrlResult = await summarizeOgpResult(cachedFetcher(firstUrl))
    const secondUrlResult = await summarizeOgpResult(cachedFetcher(secondUrl))
    const cachedFirstUrlResult = await summarizeOgpResult(
      cachedFetcher(firstUrl),
    )

    const readOutput = () => ({
      firstUrlResult,
      secondUrlResult,
      cachedFirstUrlResult,
      requests: fetcher.mock.calls,
    })
    expect(readOutput()).toEqual({
      firstUrlResult: { result: 'ok', value: response },
      secondUrlResult: { result: 'ok', value: secondResponse },
      cachedFirstUrlResult: { result: 'ok', value: response },
      requests: [[firstUrl], [secondUrl]],
    })
  })
})
