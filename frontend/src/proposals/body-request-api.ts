import { errAsync, ResultAsync } from 'neverthrow'

import type { components } from '#lib/api/schema.gen.d.ts'
import { isRecord } from '#lib/guards'
import type { LlmSettings } from '#lib/llm-settings'
import { postLlmResult } from '#lib/llm-sse'

export type BodyRequestResult = components['schemas']['BodyRequestResult']
export type BodyRequestInput = components['schemas']['BodyRequest']

function isBodyRequestResult(value: unknown): value is BodyRequestResult {
  return isRecord(value) && typeof value['replacement'] === 'string'
}

function bodyRequestApiUrl(settings: LlmSettings): string {
  if (settings.route === 'server') return '/api/proposals/body-request'
  return `${settings.bridgeUrl.replace(/\/+$/, '')}/api/proposals/body-request`
}

export function requestBodyProposal(
  fetcher: typeof fetch,
  settings: LlmSettings,
  body: BodyRequestInput,
  signal: AbortSignal,
): ResultAsync<BodyRequestResult, Error> {
  if (settings.route === 'local' && settings.bridgeUrl.trim().length === 0) {
    return errAsync(new Error('ローカル LLM の接続先を設定してください。'))
  }

  return postLlmResult<BodyRequestInput, BodyRequestResult>({
    url: bodyRequestApiUrl(settings),
    body,
    signal,
    fetcher,
    isResult: isBodyRequestResult,
  })
}
