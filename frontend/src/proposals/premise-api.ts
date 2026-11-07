import { errAsync, ResultAsync } from 'neverthrow'

import type { components } from '#lib/api/schema.gen.d.ts'
import { isRecord } from '#lib/guards'
import type { LlmSettings } from '#lib/llm-settings'
import { postLlmResult } from '#lib/llm-sse'

export type PremiseRequest = components['schemas']['PremiseRequest']
export type PremiseResponse = components['schemas']['PremiseResponse']

function isPremiseResponse(value: unknown): value is PremiseResponse {
  return (
    isRecord(value) &&
    typeof value['reply'] === 'string' &&
    (value['audience'] === undefined ||
      typeof value['audience'] === 'string') &&
    (value['purpose'] === undefined || typeof value['purpose'] === 'string') &&
    (value['thesis'] === undefined || typeof value['thesis'] === 'string')
  )
}

function premiseApiUrl(settings: LlmSettings): string {
  if (settings.route === 'server') return '/api/proposals/premise'
  return `${settings.bridgeUrl.replace(/\/+$/, '')}/api/proposals/premise`
}

export function requestPremiseProposal(
  fetcher: typeof fetch,
  settings: LlmSettings,
  body: PremiseRequest,
  signal: AbortSignal,
): ResultAsync<PremiseResponse, Error> {
  if (settings.route === 'local' && settings.bridgeUrl.trim().length === 0) {
    return errAsync(new Error('ローカル LLM の接続先を設定してください。'))
  }

  return postLlmResult<PremiseRequest, PremiseResponse>({
    url: premiseApiUrl(settings),
    body,
    signal,
    fetcher,
    isResult: isPremiseResponse,
  })
}
