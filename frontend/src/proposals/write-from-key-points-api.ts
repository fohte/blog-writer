import { errAsync, ResultAsync } from 'neverthrow'

import type { components } from '#lib/api/schema.gen.d.ts'
import { isRecord } from '#lib/guards'
import type { LlmSettings } from '#lib/llm-settings'
import { postLlmResult } from '#lib/llm-sse'

export type WriteFromKeyPointsRequest =
  components['schemas']['WriteFromKeyPointsRequest']
export type WriteFromKeyPointsResponse =
  components['schemas']['WriteFromKeyPointsResponse']
export type WrittenSentence = components['schemas']['WrittenSentence']

function isWriteFromKeyPointsResponse(
  value: unknown,
): value is WriteFromKeyPointsResponse {
  return (
    isRecord(value) &&
    Array.isArray(value['sentences']) &&
    value['sentences'].every(
      (sentence) =>
        isRecord(sentence) &&
        typeof sentence['text'] === 'string' &&
        typeof sentence['is_factual'] === 'boolean' &&
        Array.isArray(sentence['key_point_ids']) &&
        sentence['key_point_ids'].every((id) => typeof id === 'string'),
    )
  )
}

function apiUrl(settings: LlmSettings): string {
  if (settings.route === 'server') return '/api/write-from-key-points'
  return `${settings.bridgeUrl.replace(/\/+$/, '')}/api/write-from-key-points`
}

export function requestWriteFromKeyPoints(
  fetcher: typeof fetch,
  settings: LlmSettings,
  body: WriteFromKeyPointsRequest,
  signal: AbortSignal,
): ResultAsync<WriteFromKeyPointsResponse, Error> {
  if (settings.route === 'local' && settings.bridgeUrl.trim().length === 0) {
    return errAsync(new Error('ローカル LLM の接続先を設定してください。'))
  }

  return postLlmResult<WriteFromKeyPointsRequest, WriteFromKeyPointsResponse>({
    url: apiUrl(settings),
    body,
    signal,
    fetcher,
    isResult: isWriteFromKeyPointsResponse,
  })
}
