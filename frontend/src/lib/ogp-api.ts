import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import type { components } from '#lib/api/schema.gen.d.ts'
import { isRecord } from '#lib/guards'

export type OgpResponse = components['schemas']['OgpResponse']

export type OgpFetcher = (url: string) => ResultAsync<OgpResponse, Error>

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
  ).andThen((response) =>
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
}
