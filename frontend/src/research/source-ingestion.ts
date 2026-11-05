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

export class SourceImportError extends Error {
  constructor(
    readonly phase: 'body' | 'analysis',
    cause: Error,
    readonly source?: SourceMetadata,
  ) {
    super(cause.message, { cause })
    this.name = 'SourceImportError'
  }
}

function withImportPhase<T>(
  result: ResultAsync<T, Error>,
  phase: SourceImportError['phase'],
): ResultAsync<T, SourceImportError> {
  return result.mapErr((cause) => new SourceImportError(phase, cause))
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
): ResultAsync<ImportedSource, Error> {
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
      .mapErr((cause) => new SourceImportError('analysis', cause, source))

  if (input.kind === 'url') {
    return withImportPhase(
      fetchSourceUrl(fetcher, articleId, sourceId, input.url, signal),
      'body',
    ).andThen((response) =>
      withImportPhase(
        getSourceBody(fetcher, articleId, sourceId, signal),
        'body',
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
    return withImportPhase(
      uploadSourceFile(fetcher, articleId, sourceId, input.file, signal),
      'body',
    ).andThen((response) =>
      withImportPhase(
        getSourceBody(fetcher, articleId, sourceId, signal),
        'body',
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

  return withImportPhase(
    saveSourceBody(fetcher, articleId, sourceId, input.body, signal),
    'body',
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
