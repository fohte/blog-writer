import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import type { components } from '#lib/api/schema.gen.d.ts'
import { isRecord } from '#lib/guards'

export type ExportDestination = components['schemas']['DestinationResponse']
type ArticleFileResponse = components['schemas']['ArticleFileResponse']

export class ExportApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ExportApiError'
  }
}

export class ExportConflictError extends ExportApiError {
  constructor(message: string) {
    super(message, 409)
    this.name = 'ExportConflictError'
  }
}

function isDestinationList(
  value: unknown,
): value is components['schemas']['DestinationListResponse'] {
  return (
    isRecord(value) &&
    Array.isArray(value['destinations']) &&
    value['destinations'].every(
      (destination) =>
        isRecord(destination) &&
        typeof destination['id'] === 'string' &&
        (destination['format'] === 'markdown' ||
          destination['format'] === 'mdx') &&
        typeof destination['frontmatter_template'] === 'string',
    )
  )
}

function isArticleFile(value: unknown): value is ArticleFileResponse {
  return (
    isRecord(value) &&
    (typeof value['content'] === 'string' || value['content'] === null) &&
    (typeof value['sha'] === 'string' || value['sha'] === null)
  )
}

function isPublishResponse(
  value: unknown,
): value is components['schemas']['PublishArticleResponse'] {
  return isRecord(value) && typeof value['url'] === 'string'
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
      if (response.status === 409) {
        return errAsync(
          new ExportConflictError(
            `公開先のファイルが変更されています。${message.length > 0 ? ` ${message}` : ''}`,
          ),
        )
      }
      return errAsync(
        new ExportApiError(`${label}: ${message}`, response.status),
      )
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

export function getExportDestinations(fetcher: typeof fetch) {
  return request(
    fetcher,
    '/api/export/destinations',
    {},
    isDestinationList,
    '公開先を読み込めませんでした',
  )
}

export function getExportArticleFile(
  fetcher: typeof fetch,
  destinationId: string,
  articleId: string,
  slug: string,
) {
  const query = new URLSearchParams({ slug })
  return request(
    fetcher,
    `/api/export/${encodeURIComponent(destinationId)}/articles/${encodeURIComponent(articleId)}?${query}`,
    {},
    isArticleFile,
    '公開先のファイルを読み込めませんでした',
  )
}

export function publishArticle(
  fetcher: typeof fetch,
  destinationId: string,
  articleId: string,
  payload: { slug: string; content: string; sha: string | null },
) {
  return request(
    fetcher,
    `/api/export/${encodeURIComponent(destinationId)}/articles/${encodeURIComponent(articleId)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
    isPublishResponse,
    'PR を作成できませんでした',
  )
}
