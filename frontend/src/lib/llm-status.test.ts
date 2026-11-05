import { describe, expect, it, vi } from 'vitest'

import { fetchLlmStatus } from '#lib/llm-status'

describe('fetchLlmStatus', () => {
  it('returns the lock state from the status endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          provider: 'claude_code',
          locked: true,
          web_search: false,
        }),
      ),
    )
    const actual = await fetchLlmStatus(fetcher).match(
      ({ locked }) => ({ result: 'ok', locked }),
      (error) => ({ result: 'error', message: error.message }),
    )

    expect(actual).toEqual({ result: 'ok', locked: true })
  })
})
