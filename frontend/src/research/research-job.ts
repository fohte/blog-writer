import { errAsync, type ResultAsync } from 'neverthrow'

import type { components } from '#lib/api/schema.gen.d.ts'
import { isRecord } from '#lib/guards'
import type { LlmSettings } from '#lib/llm-settings'
import { postLlmResult } from '#lib/llm-sse'

type ResearchJobRequest = components['schemas']['ResearchJobRequest']
type ResearchJobResult = components['schemas']['ResearchJobResult']

function isResearchJobResult(value: unknown): value is ResearchJobResult {
  if (!isRecord(value) || !Array.isArray(value['sources'])) return false
  const analysis = value['analysis']
  if (
    !isRecord(analysis) ||
    analysis['task'] !== 'key_points' ||
    !isRecord(analysis['data']) ||
    !Array.isArray(analysis['data']['sources'])
  )
    return false

  const validAnalysisSources = analysis['data']['sources'].every(
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
  const validSources = value['sources'].every(
    (source) =>
      isRecord(source) &&
      typeof source['id'] === 'string' &&
      typeof source['url'] === 'string' &&
      (source['final_url'] === undefined ||
        source['final_url'] === null ||
        typeof source['final_url'] === 'string') &&
      (source['title'] === undefined || typeof source['title'] === 'string') &&
      (source['body'] === undefined ||
        source['body'] === null ||
        typeof source['body'] === 'string') &&
      (source['status'] === 'available' || source['status'] === 'unavailable'),
  )
  return validAnalysisSources && validSources
}

function researchApiUrl(settings: LlmSettings): string {
  if (settings.route === 'server') return '/api/research/jobs'
  if (settings.bridgeUrl.trim().length === 0) return ''
  return `${settings.bridgeUrl.replace(/\/+$/, '')}/api/research/jobs`
}

export function runResearchJob(
  fetcher: typeof fetch,
  settings: LlmSettings,
  question: string,
  signal: AbortSignal,
  onProgress: (query: string) => void,
): ResultAsync<ResearchJobResult, Error> {
  const url = researchApiUrl(settings)
  if (url.length === 0)
    return errAsync(new Error('ローカル LLM の接続先を設定してください。'))

  return postLlmResult<ResearchJobRequest, ResearchJobResult>({
    url,
    body: { task: 'key_points', question },
    signal,
    fetcher,
    isResult: isResearchJobResult,
    onEvent: (event, data) => {
      if (
        event === 'progress' &&
        isRecord(data) &&
        typeof data['query'] === 'string'
      )
        onProgress(data['query'])
    },
  })
}
