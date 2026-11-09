import { describe, expect, it, vi } from 'vitest'

import { fetchOgp } from '#lib/ogp-api'

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
})
