import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import type { components } from '#lib/api/schema.gen.d.ts'
import { isRecord } from '#lib/guards'

export type OgpResponse = components['schemas']['OgpResponse']

export type OgpFetcher = (url: string) => ResultAsync<OgpResponse, Error>

type OgpOutcome =
  { kind: 'success'; value: OgpResponse } | { kind: 'failure'; error: Error }

type CachedOgpRequest = { outcome: Promise<OgpOutcome> }

function resultFromOgpOutcome(outcome: Promise<OgpOutcome>) {
  return ResultAsync.fromPromise(
    outcome,
    (cause) => new Error('OGP request result could not be shared.', { cause }),
  ).andThen((result) =>
    result.kind === 'success' ? okAsync(result.value) : errAsync(result.error),
  )
}

export function createOgpFetcherCache(
  readFetcher: () => OgpFetcher | undefined,
): OgpFetcher {
  let activeFetcher = readFetcher()
  let requests = new Map<string, CachedOgpRequest>()

  return (url) => {
    const fetcher = readFetcher()
    if (fetcher !== activeFetcher) {
      activeFetcher = fetcher
      requests = new Map()
    }

    const cached = requests.get(url)
    if (cached) return resultFromOgpOutcome(cached.outcome)
    if (!fetcher) return errAsync(new Error('OGP fetcher is not configured'))
    const entry = {
      outcome: fetcher(url).match(
        (value) => ({ kind: 'success', value }) as const,
        (error) => ({ kind: 'failure', error }) as const,
      ),
    }
    requests.set(url, entry)
    void entry.outcome.then((result) => {
      if (result.kind === 'failure' && requests.get(url) === entry)
        requests.delete(url)
    })
    return resultFromOgpOutcome(entry.outcome)
  }
}

function isOgpResponse(value: unknown): value is OgpResponse {
  return (
    isRecord(value) &&
    typeof value['available'] === 'boolean' &&
    (typeof value['description'] === 'string' ||
      value['description'] === null) &&
    (typeof value['final_url'] === 'string' || value['final_url'] === null) &&
    (typeof value['image'] === 'string' || value['image'] === null) &&
    (typeof value['title'] === 'string' || value['title'] === null)
  )
}

export function fetchOgp(fetcher: typeof fetch, url: string) {
  return ResultAsync.fromPromise(
    fetcher('/api/ogp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    }),
    (cause) => new Error('OGP 情報を取得できませんでした。', { cause }),
  )
    .andThen((response) =>
      ResultAsync.fromPromise(
        response.json() as Promise<unknown>,
        (cause) => new Error('OGP 応答を読み取れませんでした。', { cause }),
      ).andThen((value) => {
        if (!response.ok)
          return errAsync(
            new Error(`OGP request failed: ${String(response.status)}`),
          )
        return isOgpResponse(value)
          ? okAsync(value)
          : errAsync(new Error('OGP 応答の形式が正しくありません。'))
      }),
    )
    .mapErr((error) => {
      console.warn('OGP request failed', error)
      return error
    })
}
