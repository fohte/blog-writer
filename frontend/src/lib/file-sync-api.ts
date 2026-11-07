import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import type { components } from '#lib/api/schema.gen.d.ts'
import { isRecord } from '#lib/guards'

export type FileSyncConfiguration =
  components['schemas']['FileSyncConfigurationResponse']
export type ArticleFileSyncResponse =
  components['schemas']['ArticleFileSyncResponse']
export type ArticleFileSyncStatus =
  components['schemas']['ArticleFileSyncStatus']

function isFileSyncConfiguration(
  value: unknown,
): value is FileSyncConfiguration {
  return (
    isRecord(value) &&
    typeof value['enabled'] === 'boolean' &&
    (value['directory'] === undefined ||
      value['directory'] === null ||
      typeof value['directory'] === 'string')
  )
}

function isArticleFileSyncResponse(
  value: unknown,
): value is ArticleFileSyncResponse {
  return (
    isRecord(value) &&
    (value['status'] === 'unset' ||
      value['status'] === 'synced' ||
      value['status'] === 'external_changed') &&
    (value['path'] === undefined ||
      value['path'] === null ||
      typeof value['path'] === 'string') &&
    (value['content'] === undefined ||
      value['content'] === null ||
      typeof value['content'] === 'string') &&
    (value['content_hash'] === undefined ||
      value['content_hash'] === null ||
      typeof value['content_hash'] === 'string')
  )
}

function parseResponse<T>(
  response: Response,
  isExpected: (value: unknown) => value is T,
  label: string,
): ResultAsync<T, Error> {
  return ResultAsync.fromPromise(
    response.json() as Promise<unknown>,
    (cause) => new Error(`${label}: 応答を読み取れませんでした。`, { cause }),
  ).andThen((value) => {
    if (!response.ok) {
      const message =
        isRecord(value) && typeof value['error'] === 'string'
          ? value['error']
          : `HTTP ${String(response.status)}`
      return errAsync(new Error(`${label}: ${message}`))
    }
    return isExpected(value)
      ? okAsync(value)
      : errAsync(new Error(`${label}: 応答の形式が正しくありません。`))
  })
}

function request<T>(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  isExpected: (value: unknown) => value is T,
  label: string,
): ResultAsync<T, Error> {
  return ResultAsync.fromPromise(
    fetcher(url, init),
    (cause) => new Error(`${label}: 接続できませんでした。`, { cause }),
  ).andThen((response) => parseResponse(response, isExpected, label))
}

const articleFileSyncUrl = (articleId: string) =>
  `/api/articles/${encodeURIComponent(articleId)}/file-sync`

export function getFileSyncConfiguration(fetcher: typeof fetch) {
  return request(
    fetcher,
    '/api/file-sync/configuration',
    {},
    isFileSyncConfiguration,
    '同期設定を読み込めませんでした',
  )
}

export function getArticleFileSync(fetcher: typeof fetch, articleId: string) {
  return request(
    fetcher,
    articleFileSyncUrl(articleId),
    {},
    isArticleFileSyncResponse,
    '同期ファイルを読み込めませんでした',
  )
}

export function setArticleFileSync(
  fetcher: typeof fetch,
  articleId: string,
  path: string,
) {
  return request(
    fetcher,
    articleFileSyncUrl(articleId),
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    },
    isArticleFileSyncResponse,
    '同期ファイルを指定できませんでした',
  )
}

export function resumeArticleFileSync(
  fetcher: typeof fetch,
  articleId: string,
  hash: string,
) {
  return request(
    fetcher,
    `${articleFileSyncUrl(articleId)}/resume`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hash }),
    },
    isArticleFileSyncResponse,
    '同期を再開できませんでした',
  )
}

export function overwriteArticleFileSync(
  fetcher: typeof fetch,
  articleId: string,
) {
  return request(
    fetcher,
    `${articleFileSyncUrl(articleId)}/overwrite`,
    { method: 'POST' },
    isArticleFileSyncResponse,
    '同期ファイルを上書きできませんでした',
  )
}
