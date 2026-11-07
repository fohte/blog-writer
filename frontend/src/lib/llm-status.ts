import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import type { components } from '#lib/api/schema.gen.d.ts'

type LlmStatus = Pick<components['schemas']['LlmStatusResponse'], 'locked'>

const isLlmStatus = (value: unknown): value is LlmStatus =>
  typeof value === 'object' &&
  value !== null &&
  'locked' in value &&
  typeof value.locked === 'boolean'

const parseLlmStatus = (value: unknown) =>
  isLlmStatus(value)
    ? okAsync(value)
    : errAsync(new Error('Invalid LLM settings response'))

// The local bridge serves the same endpoint, so `baseUrl` doubles as its reachability check.
export function fetchLlmStatus(fetcher: typeof fetch, baseUrl = '') {
  return ResultAsync.fromPromise(
    fetcher(`${baseUrl.replace(/\/+$/, '')}/api/llm/status`),
    (cause) => new Error('Failed to load LLM settings', { cause }),
  ).andThen((response) => {
    if (!response.ok) {
      return errAsync(
        new Error(`Failed to load LLM settings: ${String(response.status)}`),
      )
    }

    return ResultAsync.fromPromise(
      response.json().then((value: unknown) => value),
      (cause) => new Error('Failed to read LLM settings response', { cause }),
    ).andThen(parseLlmStatus)
  })
}
