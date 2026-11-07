import { errAsync, type ResultAsync } from 'neverthrow'

import type { components } from '#lib/api/schema.gen.d.ts'
import { isRecord } from '#lib/guards'
import type { LlmSettings } from '#lib/llm-settings'
import { LlmStreamInterruptedError, postLlmResult } from '#lib/llm-sse'

type ResearchJobRequest = components['schemas']['ResearchJobRequest']
type ResearchJobResult = components['schemas']['ResearchJobResult']

const activeResearchJobs = new Map<string, object>()

export function acquireResearchLock(articleId: string, token: object): boolean {
  if (activeResearchJobs.has(articleId)) return false
  activeResearchJobs.set(articleId, token)
  return true
}

export function releaseResearchLock(articleId: string, token: object): void {
  if (activeResearchJobs.get(articleId) === token)
    activeResearchJobs.delete(articleId)
}

export class ResearchJobInterruptedError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'ResearchJobInterruptedError'
  }
}

function isResearchJobResult(value: unknown): value is ResearchJobResult {
  if (!isRecord(value) || !Array.isArray(value['sources'])) return false
  const analysis = value['analysis']
  if (!isRecord(analysis) || !isRecord(analysis['data'])) return false
  const validAnalysis =
    analysis['task'] === 'key_points'
      ? Array.isArray(analysis['data']['sources']) &&
        analysis['data']['sources'].every(
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
      : analysis['task'] === 'claim_evidence' &&
        (analysis['data']['verdict'] === 'supported' ||
          analysis['data']['verdict'] === 'insufficient' ||
          analysis['data']['verdict'] === 'outdated' ||
          analysis['data']['verdict'] === 'contradicted') &&
        (analysis['data']['quote'] === undefined ||
          analysis['data']['quote'] === null ||
          (isRecord(analysis['data']['quote']) &&
            typeof analysis['data']['quote']['source_id'] === 'string' &&
            typeof analysis['data']['quote']['text'] === 'string')) &&
        (analysis['data']['suggestion'] === undefined ||
          analysis['data']['suggestion'] === null ||
          typeof analysis['data']['suggestion'] === 'string')
  const validSources = value['sources'].every(
    (source) =>
      isRecord(source) &&
      typeof source['id'] === 'string' &&
      typeof source['url'] === 'string' &&
      (source['final_url'] === undefined ||
        source['final_url'] === null ||
        typeof source['final_url'] === 'string') &&
      (source['title'] === undefined ||
        source['title'] === null ||
        typeof source['title'] === 'string') &&
      (source['body'] === undefined ||
        source['body'] === null ||
        typeof source['body'] === 'string') &&
      (source['status'] === 'available' || source['status'] === 'unavailable'),
  )
  return validAnalysis && validSources
}

function researchApiUrl(settings: LlmSettings): string {
  if (settings.route === 'server') return '/api/research/jobs'
  if (settings.bridgeUrl.trim().length === 0) return ''
  return `${settings.bridgeUrl.replace(/\/+$/, '')}/api/research/jobs`
}

export function runResearchJob(
  fetcher: typeof fetch,
  settings: LlmSettings,
  request: ResearchJobRequest,
  signal: AbortSignal,
  onProgress: (query: string) => void,
): ResultAsync<ResearchJobResult, Error> {
  const url = researchApiUrl(settings)
  if (url.length === 0)
    return errAsync(new Error('ローカル LLM の接続先を設定してください。'))

  return postLlmResult<ResearchJobRequest, ResearchJobResult>({
    url,
    body: request,
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
  }).mapErr((error) =>
    error instanceof LlmStreamInterruptedError
      ? new ResearchJobInterruptedError('調査の接続が中断されました。', error)
      : error,
  )
}
