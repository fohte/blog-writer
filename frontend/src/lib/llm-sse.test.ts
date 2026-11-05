import { describe, expect, it } from 'vitest'

import { postLlmResult } from '#lib/llm-sse'

function responseFrom(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

function isSummaryResult(value: unknown): value is { summary: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'summary' in value &&
    typeof value.summary === 'string'
  )
}

function readProgressOutput(
  result: { kind: string; value?: unknown; message?: string },
  progress: unknown[],
) {
  return { result, progress }
}

function readAbortOutput(
  result: { kind: string; value?: unknown; message?: string },
  signalWasPassed: boolean,
) {
  return { result, signalWasPassed }
}

describe('LLM SSE client', () => {
  it('reads progress events before returning the final result', async () => {
    const progress: unknown[] = []
    const controller = new AbortController()
    const result = await postLlmResult<{ source: string }, { summary: string }>(
      {
        url: '/api/research/key-points',
        body: { source: 'source-a' },
        signal: controller.signal,
        isResult: isSummaryResult,
        fetcher: () =>
          Promise.resolve(
            responseFrom([
              'event: progress\r\ndata: {"event":"progress","data":{"query":"架空の問い"}}\r\n\r\n',
              'event: result\ndata: {"event":"result","data":{"summary":"要約"}}\n\n',
            ]),
          ),
        onEvent: (event, data) => progress.push({ event, data }),
      },
    ).match(
      (value) => ({ kind: 'result', value }),
      (error) => ({ kind: 'error', message: error.message }),
    )

    expect(readProgressOutput(result, progress)).toEqual({
      result: { kind: 'result', value: { summary: '要約' } },
      progress: [{ event: 'progress', data: { query: '架空の問い' } }],
    })
  })

  it('returns the server error event as a failed result', async () => {
    const result = await postLlmResult<
      { request: string },
      { summary: string }
    >({
      url: '/api/research/key-points',
      body: { request: 'sample' },
      signal: new AbortController().signal,
      isResult: isSummaryResult,
      fetcher: () =>
        Promise.resolve(
          responseFrom([
            'event: error\ndata: {"event":"error","data":{"message":"LLM unavailable"}}\n\n',
          ]),
        ),
    }).match(
      (value) => ({ kind: 'result', value }),
      (error) => ({ kind: 'error', message: error.message }),
    )

    expect(result).toEqual({ kind: 'error', message: 'LLM unavailable' })
  })

  it('passes AbortSignal to fetch and reports an aborted request', async () => {
    const controller = new AbortController()
    controller.abort()
    let signalWasPassed = false
    const result = await postLlmResult<
      { request: string },
      { summary: string }
    >({
      url: '/api/research/key-points',
      body: { request: 'sample' },
      signal: controller.signal,
      isResult: isSummaryResult,
      fetcher: (_url, init) => {
        signalWasPassed = init?.signal === controller.signal
        return Promise.reject(new DOMException('Aborted', 'AbortError'))
      },
    }).match(
      (value) => ({ kind: 'result', value }),
      (error) => ({ kind: 'error', message: error.message }),
    )

    expect(readAbortOutput(result, signalWasPassed)).toEqual({
      result: { kind: 'error', message: 'Failed to connect to the LLM API' },
      signalWasPassed: true,
    })
  })
})
