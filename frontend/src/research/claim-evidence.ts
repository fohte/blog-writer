import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import type { EvidenceVerdict } from '#article/types'
import type { components } from '#lib/api/schema.gen.d.ts'
import { isRecord } from '#lib/guards'
import type { LlmSettings } from '#lib/llm-settings'
import { postLlmResult } from '#lib/llm-sse'
import { fetchSourceUrl, getSourceBody } from '#lib/source-api'
import { getSourceHost } from '#research/source-format'

export type ClaimEvidenceResult =
  components['schemas']['JudgeClaimEvidenceResult']
type ClaimEvidenceRequest = components['schemas']['JudgeClaimEvidenceRequest']
type ClaimEvidenceSourceInput =
  components['schemas']['ClaimEvidenceSourceInput']

export type ImportedClaimEvidence = {
  title: string
  url: string
  verdict: EvidenceVerdict
  quote: string
}

export class ClaimEvidenceImportError extends Error {
  constructor(
    message: string,
    readonly phase: 'source' | 'judgement',
    readonly title: string,
    readonly url: string,
    cause?: Error,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ClaimEvidenceImportError'
  }
}

function isClaimEvidenceResult(value: unknown): value is ClaimEvidenceResult {
  return (
    isRecord(value) &&
    (value['verdict'] === 'supported' ||
      value['verdict'] === 'insufficient' ||
      value['verdict'] === 'outdated' ||
      value['verdict'] === 'contradicted') &&
    (value['quote'] === null ||
      value['quote'] === undefined ||
      (isRecord(value['quote']) &&
        typeof value['quote']['source_id'] === 'string' &&
        typeof value['quote']['text'] === 'string'))
  )
}

function apiUrl(settings: LlmSettings): string {
  if (settings.route === 'server') return '/api/research/claim-evidence'
  return `${settings.bridgeUrl.replace(/\/+$/, '')}/api/research/claim-evidence`
}

export function judgeClaimEvidenceFromSources(
  fetcher: typeof fetch,
  claim: string,
  sources: ClaimEvidenceSourceInput[],
  settings: LlmSettings,
  signal: AbortSignal,
  before?: string,
  after?: string,
): ResultAsync<ClaimEvidenceResult, Error> {
  if (settings.route === 'local' && settings.bridgeUrl.trim().length === 0)
    return errAsync(new Error('ローカル LLM の接続先を設定してください。'))
  return postLlmResult<ClaimEvidenceRequest, ClaimEvidenceResult>({
    url: apiUrl(settings),
    body: {
      claim,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
      sources,
    },
    signal,
    fetcher,
    isResult: isClaimEvidenceResult,
  }).andThen((result) => {
    if (
      result.quote &&
      !sources.some(({ id }) => id === result.quote?.source_id)
    )
      return errAsync(new Error('判定 API が別の資料を引用しました。'))
    return okAsync(result)
  })
}

export function importClaimEvidence(
  fetcher: typeof fetch,
  articleId: string,
  sourceId: string,
  url: string,
  claim: string,
  settings: LlmSettings,
  signal: AbortSignal,
): ResultAsync<ImportedClaimEvidence, ClaimEvidenceImportError> {
  const sourceTitle = getSourceHost(url) ?? url

  return fetchSourceUrl(fetcher, articleId, sourceId, url, signal)
    .mapErr(
      (cause) =>
        new ClaimEvidenceImportError(
          cause.message,
          'source',
          sourceTitle,
          url,
          cause,
        ),
    )
    .andThen((response) =>
      getSourceBody(fetcher, articleId, sourceId, signal)
        .mapErr(
          (cause) =>
            new ClaimEvidenceImportError(
              cause.message,
              'source',
              response.title,
              response.final_url,
              cause,
            ),
        )
        .andThen((source) => {
          if (
            settings.route === 'local' &&
            settings.bridgeUrl.trim().length === 0
          ) {
            return errAsync(
              new ClaimEvidenceImportError(
                'ローカル LLM の接続先を設定してください。',
                'judgement',
                response.title,
                response.final_url,
              ),
            )
          }
          return postLlmResult<ClaimEvidenceRequest, ClaimEvidenceResult>({
            url: apiUrl(settings),
            body: {
              claim,
              sources: [{ id: sourceId, body: source.body }],
            },
            signal,
            fetcher,
            isResult: isClaimEvidenceResult,
          })
            .mapErr(
              (cause) =>
                new ClaimEvidenceImportError(
                  cause.message,
                  'judgement',
                  response.title,
                  response.final_url,
                  cause,
                ),
            )
            .andThen((result) => {
              if (result.quote && result.quote.source_id !== sourceId) {
                return errAsync(
                  new ClaimEvidenceImportError(
                    '判定 API が別の資料を引用しました。',
                    'judgement',
                    response.title,
                    response.final_url,
                  ),
                )
              }
              return okAsync({
                title: response.title,
                url: response.final_url,
                verdict: result.verdict,
                quote: result.quote?.text ?? '',
              })
            })
        }),
    )
}
