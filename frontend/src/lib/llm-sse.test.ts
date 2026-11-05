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

function readMidstreamAbortOutput(
  result: { kind: string; value?: unknown; message?: string },
  progress: unknown[],
  signalWasPassed: boolean,
) {
  return { result, progress, signalWasPassed }
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
              ': keep-alive\r\n\r\n',
              'event: prog',
              'ress\r\ndata: {"event":"progress","data":{"query":"架空',
              'の問い"}}\r\n',
              '\r\n',
              'event: result\r\ndata: {"event":"result","data":{"summary":"要約"}}\r\n',
              '\r\n',
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

  it('reports when a stream ends without a result event', async () => {
    const progress: unknown[] = []
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
            ': keep-alive\n\n',
            'event: progress\ndata: {"event":"progress","data":{"step":"reading"}}\n\n',
          ]),
        ),
      onEvent: (event, data) => progress.push({ event, data }),
    }).match(
      (value) => ({ kind: 'result', value }),
      (error) => ({ kind: 'error', message: error.message }),
    )

    expect(readProgressOutput(result, progress)).toEqual({
      result: { kind: 'error', message: 'LLM stream ended without a result' },
      progress: [{ event: 'progress', data: { step: 'reading' } }],
    })
  })

  it('reports an abort while reading a stream', async () => {
    const controller = new AbortController()
    const progress: unknown[] = []
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
        const stream = new ReadableStream<Uint8Array>({
          start(streamController) {
            streamController.enqueue(
              new TextEncoder().encode(
                'event: progress\ndata: {"event":"progress","data":{"step":"reading"}}\n\n',
              ),
            )
            controller.signal.addEventListener(
              'abort',
              () => {
                streamController.error(
                  new DOMException('Aborted', 'AbortError'),
                )
              },
              { once: true },
            )
          },
        })
        return Promise.resolve(new Response(stream, { status: 200 }))
      },
      onEvent: (event, data) => {
        progress.push({ event, data })
        controller.abort()
      },
    }).match(
      (value) => ({ kind: 'result', value }),
      (error) => ({ kind: 'error', message: error.message }),
    )

    expect(readMidstreamAbortOutput(result, progress, signalWasPassed)).toEqual(
      {
        result: { kind: 'error', message: 'Failed to read LLM stream' },
        progress: [{ event: 'progress', data: { step: 'reading' } }],
        signalWasPassed: true,
      },
    )
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
