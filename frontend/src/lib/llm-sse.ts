import { err, errAsync, ok, okAsync, Result, ResultAsync } from 'neverthrow'

type LlmStreamEnvelope = {
  event: string
  data: unknown
}

type StreamStep<TResult> =
  { terminal: true; value: TResult } | { terminal: false }

type LlmStreamOptions<TBody, TResult> = {
  url: string
  body: TBody
  signal: AbortSignal
  fetcher?: typeof fetch
  onEvent?: (event: string, data: unknown) => void
  isResult: (data: unknown) => data is TResult
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseEnvelope(
  eventName: string,
  rawData: string,
): Result<LlmStreamEnvelope, Error> {
  return Result.fromThrowable(
    (): unknown => JSON.parse(rawData),
    (cause) => new Error('LLM stream returned invalid JSON', { cause }),
  )().andThen((value) => {
    if (
      !isRecord(value) ||
      typeof value['event'] !== 'string' ||
      !('data' in value)
    ) {
      return err(new Error('LLM stream returned an invalid event'))
    }
    if (eventName !== 'message' && eventName !== value['event']) {
      return err(new Error('LLM stream event names did not match'))
    }
    return ok({ event: value['event'], data: value['data'] })
  })
}

function readResult<TBody, TResult>(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: Pick<LlmStreamOptions<TBody, TResult>, 'isResult' | 'onEvent'>,
): ResultAsync<TResult, Error> {
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = 'message'
  let dataLines: string[] = []

  const dispatch = (): Result<StreamStep<TResult>, Error> | undefined => {
    if (dataLines.length === 0) {
      eventName = 'message'
      return undefined
    }
    const envelope = parseEnvelope(eventName, dataLines.join('\n'))
    eventName = 'message'
    dataLines = []
    return envelope.andThen((parsed) => {
      if (parsed.event === 'result') {
        return options.isResult(parsed.data)
          ? ok({ terminal: true, value: parsed.data })
          : err(new Error('LLM stream returned an invalid result'))
      }
      if (parsed.event === 'error') {
        const message =
          isRecord(parsed.data) && typeof parsed.data['message'] === 'string'
            ? parsed.data['message']
            : 'LLM request failed'
        return err(new Error(message))
      }
      const callbackResult = Result.fromThrowable(
        () => options.onEvent?.(parsed.event, parsed.data),
        (cause) => new Error('LLM event handler failed', { cause }),
      )()
      return callbackResult.map(() => ({ terminal: false as const }))
    })
  }

  const processLine = (
    line: string,
  ): Result<StreamStep<TResult>, Error> | undefined => {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line
    if (normalized.length === 0) return dispatch()
    if (normalized.startsWith(':')) return undefined
    const separator = normalized.indexOf(':')
    const field = separator === -1 ? normalized : normalized.slice(0, separator)
    const value =
      separator === -1 ? '' : normalized.slice(separator + 1).replace(/^ /, '')
    if (field === 'event') eventName = value
    if (field === 'data') dataLines.push(value)
    return undefined
  }

  const read = (): ResultAsync<TResult, Error> =>
    ResultAsync.fromPromise(
      reader.read(),
      (cause) => new Error('Failed to read LLM stream', { cause }),
    ).andThen(({ done, value }) => {
      if (done) {
        buffer += decoder.decode()
        const finalLine = buffer.length > 0 ? processLine(buffer) : undefined
        if (finalLine !== undefined && finalLine.isErr()) {
          return errAsync(finalLine.error)
        }
        const finalEvent = processLine('') ?? finalLine
        if (finalEvent !== undefined && finalEvent.isErr()) {
          return errAsync(finalEvent.error)
        }
        if (
          finalEvent !== undefined &&
          finalEvent.isOk() &&
          finalEvent.value.terminal
        ) {
          return okAsync(finalEvent.value.value)
        }
        return errAsync(new Error('LLM stream ended without a result'))
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const event = processLine(line)
        if (event !== undefined && event.isErr()) return errAsync(event.error)
        if (event !== undefined && event.isOk() && event.value.terminal) {
          return okAsync(event.value.value)
        }
      }
      return read()
    })

  return read()
}

export function postLlmResult<TBody, TResult>(
  options: LlmStreamOptions<TBody, TResult>,
): ResultAsync<TResult, Error> {
  const fetcher = options.fetcher ?? fetch
  return ResultAsync.fromPromise(
    fetcher(options.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(options.body),
      signal: options.signal,
    }),
    (cause) => new Error('Failed to connect to the LLM API', { cause }),
  ).andThen((response) => {
    if (!response.ok) {
      return errAsync(
        new Error(`LLM API returned status ${response.status.toString()}`),
      )
    }
    if (!response.body) return errAsync(new Error('LLM API returned no stream'))
    return readResult<TBody, TResult>(response.body.getReader(), options)
  })
}
