import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import type { components } from '#lib/api/schema.gen.d.ts'
import { isRecord } from '#lib/guards'

type SourceBody = components['schemas']['SourceBodyResponse']
type FetchSourceBodyResponse = components['schemas']['FetchSourceBodyResponse']
type ImportFileResponse = components['schemas']['ImportFileResponse']

function isStringRecord(
  value: unknown,
  keys: string[],
): value is Record<string, string> {
  return isRecord(value) && keys.every((key) => typeof value[key] === 'string')
}

function responseJson<T>(
  response: Response,
  isExpected: (value: unknown) => value is T,
  label: string,
): ResultAsync<T, Error> {
  if (!response.ok) {
    return errAsync(new Error(`${label}: HTTP ${response.status.toString()}`))
  }
  return ResultAsync.fromPromise(
    response.json() as Promise<unknown>,
    (cause) => new Error(`${label}: failed to read response`, { cause }),
  ).andThen((value) =>
    isExpected(value)
      ? okAsync(value)
      : errAsync(new Error(`${label}: invalid response`)),
  )
}

const isSourceBody = (value: unknown): value is SourceBody =>
  isStringRecord(value, ['source_id', 'article_id', 'body'])

const isFetchResponse = (value: unknown): value is FetchSourceBodyResponse =>
  isStringRecord(value, ['source_id', 'title', 'final_url'])

const isImportFileResponse = (value: unknown): value is ImportFileResponse =>
  isStringRecord(value, ['source_id', 'title', 'file_name'])

function sourceBodyUrl(articleId: string, sourceId: string): string {
  return `/api/articles/${encodeURIComponent(articleId)}/source-bodies/${encodeURIComponent(sourceId)}`
}

export function fetchSourceUrl(
  fetcher: typeof fetch,
  articleId: string,
  sourceId: string,
  url: string,
  signal: AbortSignal,
): ResultAsync<FetchSourceBodyResponse, Error> {
  return ResultAsync.fromPromise(
    fetcher(`${sourceBodyUrl(articleId, sourceId)}/url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
      signal,
    }),
    (cause) => new Error('資料ページを取得できませんでした。', { cause }),
  ).andThen((response) =>
    responseJson(response, isFetchResponse, '資料ページを取得できませんでした'),
  )
}

export function uploadSourceFile(
  fetcher: typeof fetch,
  articleId: string,
  sourceId: string,
  file: File,
  signal: AbortSignal,
): ResultAsync<ImportFileResponse, Error> {
  const form = new FormData()
  form.append('file', file, file.name)
  return ResultAsync.fromPromise(
    fetcher(`${sourceBodyUrl(articleId, sourceId)}/file`, {
      method: 'POST',
      body: form,
      signal,
    }),
    (cause) => new Error('資料ファイルを取り込めませんでした。', { cause }),
  ).andThen((response) =>
    responseJson(
      response,
      isImportFileResponse,
      '資料ファイルを取り込めませんでした',
    ),
  )
}

export function getSourceBody(
  fetcher: typeof fetch,
  articleId: string,
  sourceId: string,
  signal: AbortSignal,
): ResultAsync<SourceBody, Error> {
  return getOptionalSourceBody(fetcher, articleId, sourceId, signal).andThen(
    (source) =>
      source === undefined
        ? errAsync(new Error('資料本文を読み込めませんでした: HTTP 404'))
        : okAsync(source),
  )
}

export function getOptionalSourceBody(
  fetcher: typeof fetch,
  articleId: string,
  sourceId: string,
  signal: AbortSignal,
): ResultAsync<SourceBody | undefined, Error> {
  return ResultAsync.fromPromise(
    fetcher(sourceBodyUrl(articleId, sourceId), { signal }),
    (cause) => new Error('資料本文を読み込めませんでした。', { cause }),
  ).andThen((response) => {
    if (response.status === 404) return okAsync(undefined)
    return responseJson(
      response,
      isSourceBody,
      '資料本文を読み込めませんでした',
    )
  })
}

export function saveSourceBody(
  fetcher: typeof fetch,
  articleId: string,
  sourceId: string,
  body: string,
  signal: AbortSignal,
): ResultAsync<void, Error> {
  return ResultAsync.fromPromise(
    fetcher(sourceBodyUrl(articleId, sourceId), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
      signal,
    }),
    (cause) => new Error('資料本文を保存できませんでした。', { cause }),
  ).andThen((response) =>
    response.ok
      ? okAsync(undefined)
      : errAsync(
          new Error(
            `資料本文を保存できませんでした: HTTP ${response.status.toString()}`,
          ),
        ),
  )
}

export function deleteSourceBody(
  fetcher: typeof fetch,
  articleId: string,
  sourceId: string,
): ResultAsync<void, Error> {
  return ResultAsync.fromPromise(
    fetcher(sourceBodyUrl(articleId, sourceId), { method: 'DELETE' }),
    (cause) => new Error('資料本文を削除できませんでした。', { cause }),
  ).andThen((response) =>
    response.ok || response.status === 404
      ? okAsync(undefined)
      : errAsync(
          new Error(
            `資料本文を削除できませんでした: HTTP ${response.status.toString()}`,
          ),
        ),
  )
}
