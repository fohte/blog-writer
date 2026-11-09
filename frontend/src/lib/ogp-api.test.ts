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

describe('fetchOgp', () => {
  it('posts the URL and returns the OGP response', async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(response)),
    )
    const result = await fetchOgp(
      fetcher,
      'https://docs.example.test/guide',
    ).match(
      (value) => ({ result: 'ok', value }),
      (error) => ({ result: 'error', message: error.message }),
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
    const result = await fetchOgp(
      fetcher,
      'https://docs.example.test/guide',
    ).match(
      (value) => ({ result: 'ok', value }),
      (error) => ({ result: 'error', message: error.message }),
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
    const result = await fetchOgp(
      fetcher,
      'https://docs.example.test/guide',
    ).match(
      (value) => ({ result: 'ok', value }),
      (error) => ({ result: 'error', message: error.message }),
    )

    expect(result).toEqual({
      result: 'error',
      message: 'OGP 応答の形式が正しくありません。',
    })
  })

  it('retries failed URLs and caches successful results per URL', async () => {
    const firstUrl = 'https://docs.example.test/first'
    const secondUrl = 'https://docs.example.test/second'
    const secondResponse = { ...response, title: 'Another guide' }
    let firstRequest = true
    const fetcher = vi.fn((url: string) => {
      if (url === firstUrl && firstRequest) {
        firstRequest = false
        return errAsync(new Error('temporary failure'))
      }
      return okAsync(url === firstUrl ? response : secondResponse)
    })
    const cachedFetcher = createOgpFetcherCache(() => fetcher)
    const firstAttempt = await cachedFetcher(firstUrl).match(
      (value) => ({ result: 'ok', value }),
      (error) => ({ result: 'error', message: error.message }),
    )
    const retried = await cachedFetcher(firstUrl).match(
      (value) => ({ result: 'ok', value }),
      (error) => ({ result: 'error', message: error.message }),
    )
    const otherUrl = await cachedFetcher(secondUrl).match(
      (value) => ({ result: 'ok', value }),
      (error) => ({ result: 'error', message: error.message }),
    )
    const cachedSuccess = await cachedFetcher(firstUrl).match(
      (value) => ({ result: 'ok', value }),
      (error) => ({ result: 'error', message: error.message }),
    )

    const readOutput = () => ({
      firstAttempt,
      retried,
      otherUrl,
      cachedSuccess,
      requests: fetcher.mock.calls,
    })
    expect(readOutput()).toEqual({
      firstAttempt: { result: 'error', message: 'temporary failure' },
      retried: { result: 'ok', value: response },
      otherUrl: { result: 'ok', value: secondResponse },
      cachedSuccess: { result: 'ok', value: response },
      requests: [[firstUrl], [firstUrl], [secondUrl]],
    })
  })
})
