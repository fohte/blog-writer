import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import type { SourceKind } from '#article/types'
import type { components } from '#lib/api/schema.gen.d.ts'
import { isRecord } from '#lib/guards'
import type { LlmSettings } from '#lib/llm-settings'
import { postLlmResult } from '#lib/llm-sse'
import {
  fetchSourceUrl,
  getSourceBody,
  saveSourceBody,
  uploadSourceFile,
} from '#lib/source-api'

type KeyPointsResult = components['schemas']['ResearchKeyPointsResult']

function isKeyPointsResult(value: unknown): value is KeyPointsResult {
  return (
    isRecord(value) &&
    Array.isArray(value['sources']) &&
    value['sources'].every(
      (source) =>
        isRecord(source) &&
        typeof source['id'] === 'string' &&
        typeof source['summary'] === 'string' &&
        Array.isArray(source['key_points']) &&
        source['key_points'].every(
          (point) =>
            isRecord(point) &&
            typeof point['text'] === 'string' &&
            typeof point['quote'] === 'string',
        ),
    )
  )
}

type SourceMetadata = {
  kind: SourceKind
  title: string
  url: string | null
  fileName: string | null
}

type ImportedSource = SourceMetadata & {
  summary: string
  findings: { text: string; quote: string }[]
}

class SourceBodyImportError extends Error {
  readonly phase = 'body' as const

  constructor(cause: Error) {
    super(cause.message, { cause })
    this.name = 'SourceBodyImportError'
  }
}

export class SourceAnalysisImportError extends Error {
  readonly phase = 'analysis' as const

  constructor(
    cause: Error,
    readonly source: SourceMetadata,
  ) {
    super(cause.message, { cause })
    this.name = 'SourceAnalysisImportError'
  }
}

type SourceImportError = SourceBodyImportError | SourceAnalysisImportError

function withBodyImportError<T>(
  result: ResultAsync<T, Error>,
): ResultAsync<T, SourceBodyImportError> {
  return result.mapErr((cause) => new SourceBodyImportError(cause))
}

export type SourceInput =
  | { kind: 'url'; url: string }
  | { kind: 'file'; file: File }
  | { kind: 'pasted'; title: string; body: string; url: string | null }

function researchApiUrl(settings: LlmSettings): string {
  if (settings.route === 'server') return '/api/research/key-points'
  return `${settings.bridgeUrl.replace(/\/+$/, '')}/api/research/key-points`
}

function extractSummary(
  fetcher: typeof fetch,
  settings: LlmSettings,
  sourceId: string,
  body: string,
  signal: AbortSignal,
): ResultAsync<KeyPointsResult['sources'][number], Error> {
  if (settings.route === 'local' && settings.bridgeUrl.trim().length === 0) {
    return errAsync(new Error('ローカル LLM の接続先を設定してください。'))
  }
  return postLlmResult<
    components['schemas']['ResearchKeyPointsRequest'],
    KeyPointsResult
  >({
    url: researchApiUrl(settings),
    body: { sources: [{ id: sourceId, body }] },
    signal,
    fetcher,
    isResult: isKeyPointsResult,
  }).andThen((result) => {
    const source = result.sources.find((candidate) => candidate.id === sourceId)
    return source
      ? okAsync(source)
      : errAsync(new Error('LLM の応答に資料が含まれていません。'))
  })
}

export function importSource(
  fetcher: typeof fetch,
  articleId: string,
  sourceId: string,
  input: SourceInput,
  settings: LlmSettings,
  signal: AbortSignal,
): ResultAsync<ImportedSource, SourceImportError> {
  const finish = (
    source: SourceMetadata,
    body: string,
  ): ResultAsync<ImportedSource, SourceImportError> =>
    extractSummary(fetcher, settings, sourceId, body, signal)
      .map((summary) => ({
        ...source,
        summary: summary.summary,
        findings: summary.key_points.map(({ text, quote }) => ({
          text,
          quote,
        })),
      }))
      .mapErr((cause) => new SourceAnalysisImportError(cause, source))

  if (input.kind === 'url') {
    return withBodyImportError(
      fetchSourceUrl(fetcher, articleId, sourceId, input.url, signal),
    ).andThen((response) =>
      withBodyImportError(
        getSourceBody(fetcher, articleId, sourceId, signal),
      ).andThen((stored) =>
        finish(
          {
            kind: 'url',
            title: response.title,
            url: response.final_url,
            fileName: null,
          },
          stored.body,
        ),
      ),
    )
  }

  if (input.kind === 'file') {
    return withBodyImportError(
      uploadSourceFile(fetcher, articleId, sourceId, input.file, signal),
    ).andThen((response) =>
      withBodyImportError(
        getSourceBody(fetcher, articleId, sourceId, signal),
      ).andThen((stored) =>
        finish(
          {
            kind: 'file',
            title: response.title,
            url: null,
            fileName: response.file_name,
          },
          stored.body,
        ),
      ),
    )
  }

  return withBodyImportError(
    saveSourceBody(fetcher, articleId, sourceId, input.body, signal),
  ).andThen(() =>
    finish(
      {
        kind: 'pasted',
        title: input.title,
        url: input.url,
        fileName: null,
      },
      input.body,
    ),
  )
}
