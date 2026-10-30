import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

import { describe, expect, it, vi } from 'vitest'

type WorkerRequest = {
  url: string
  method: string
  mode: string
}

type WorkerEvent = {
  request?: WorkerRequest
  waitUntil?: (promise: Promise<unknown>) => void
  respondWith?: (response: Promise<unknown>) => void
}

type WorkerResponse = {
  ok: boolean
  redirected: boolean
  clone: () => unknown
}

const template = readFileSync(
  new URL('./service-worker.js', import.meta.url),
  'utf8',
)

const createResponse = (
  options: { ok?: boolean; redirected?: boolean; cloneValue?: unknown } = {},
): WorkerResponse => ({
  ok: options.ok ?? true,
  redirected: options.redirected ?? false,
  clone: vi.fn(() => options.cloneValue ?? 'cached response'),
})

const createWorker = (
  precacheUrls: string[],
  fetchImpl: (input: unknown) => Promise<unknown>,
  events: string[] = [],
) => {
  const listeners = new Map<string, (event: WorkerEvent) => void>()
  const cacheEntries = new Map<string, unknown>()
  const fetchInputs: unknown[] = []
  const workerFetch = (input: unknown) => {
    fetchInputs.push(input)
    return fetchImpl(input)
  }
  const cache = {
    put: vi.fn((request: string, response: unknown) => {
      events.push(`put:${request}`)
      cacheEntries.set(request, response)
      return Promise.resolve()
    }),
  }
  const cacheStorage = {
    open: vi.fn(() => {
      events.push('open')
      return Promise.resolve(cache)
    }),
    match: vi.fn((request: string) => {
      events.push(`match:${request}`)
      return Promise.resolve(cacheEntries.get(request))
    }),
  }
  const workerSelf = {
    location: { origin: 'https://site.example.test' },
    addEventListener: (type: string, listener: (event: WorkerEvent) => void) =>
      listeners.set(type, listener),
    clients: {
      claim: vi.fn(() => {
        events.push('claim')
        return Promise.resolve()
      }),
    },
    skipWaiting: vi.fn(() => {
      events.push('skipWaiting')
      return Promise.resolve()
    }),
  }
  const source = template
    .replace("'__CACHE_NAME__'", JSON.stringify('app-shell-test'))
    .replace("'__PRECACHE_URLS__'", JSON.stringify(precacheUrls))

  runInNewContext(source, {
    caches: cacheStorage,
    fetch: workerFetch,
    self: workerSelf,
    URL,
  })

  return {
    cache,
    cacheEntries,
    cacheStorage,
    events,
    fetchInputs,
    listeners,
    workerSelf,
  }
}

const dispatchInstall = async (worker: ReturnType<typeof createWorker>) => {
  let installationPromise: Promise<unknown> | undefined
  worker.listeners.get('install')?.({
    waitUntil: (promise) => {
      installationPromise = promise
    },
  })

  const installation = await installationPromise?.then(
    () => 'installed' as const,
    () => 'rejected' as const,
  )

  return {
    installation: installation ?? 'not-started',
    cachedUrls: [...worker.cacheEntries.keys()],
    events: [...worker.events],
    skipWaitingCalls: worker.workerSelf.skipWaiting.mock.calls.length,
  }
}

const dispatchFetch = async (
  worker: ReturnType<typeof createWorker>,
  request: WorkerRequest,
) => {
  let responsePromise: Promise<unknown> | undefined
  worker.listeners.get('fetch')?.({
    request,
    respondWith: (response) => {
      responsePromise = response
    },
  })

  const response = await responsePromise

  return {
    handled: responsePromise !== undefined,
    response,
    fetchInputs: [...worker.fetchInputs],
    cacheEntries: [...worker.cacheEntries.entries()],
    events: [...worker.events],
  }
}

const navigateRequest = (path: string): WorkerRequest => ({
  url: new URL(path, 'https://site.example.test').href,
  method: 'GET',
  mode: 'navigate',
})

describe('service worker', () => {
  it.each([
    {
      scenario: 'redirects',
      response: createResponse({ redirected: true }),
    },
    {
      scenario: 'returns a non-ok response',
      response: createResponse({ ok: false }),
    },
  ])(
    'rejects installation when a precache request $scenario',
    async ({ response }) => {
      const events: string[] = []
      const fetchMock = vi.fn((input: unknown) => {
        events.push(`fetch:${String(input)}`)
        return Promise.resolve(response)
      })
      const worker = createWorker(['/index.html'], fetchMock, events)
      expect(await dispatchInstall(worker)).toEqual({
        installation: 'rejected',
        cachedUrls: [],
        events: ['open', 'fetch:/index.html'],
        skipWaitingCalls: 0,
      })
    },
  )

  it('precaches successful app shell responses before activation', async () => {
    const events: string[] = []
    const fetchMock = vi.fn((input: unknown) => {
      events.push(`fetch:${String(input)}`)
      return Promise.resolve(createResponse())
    })
    const worker = createWorker(
      ['/index.html', '/assets/app.js'],
      fetchMock,
      events,
    )
    expect(await dispatchInstall(worker)).toEqual({
      installation: 'installed',
      cachedUrls: ['/index.html', '/assets/app.js'],
      events: [
        'open',
        'fetch:/index.html',
        'fetch:/assets/app.js',
        'put:/index.html',
        'put:/assets/app.js',
        'skipWaiting',
      ],
      skipWaitingCalls: 1,
    })
  })

  it('returns the network navigation and caches it before using the app shell', async () => {
    const events: string[] = []
    const networkResponse = createResponse({ cloneValue: 'network page copy' })
    const fetchMock = vi.fn(() => {
      events.push('fetch')
      return Promise.resolve(networkResponse)
    })
    const worker = createWorker([], fetchMock, events)
    const request = navigateRequest('/articles/sample')
    const result = await dispatchFetch(worker, request)

    expect(result).toEqual({
      handled: true,
      response: networkResponse,
      fetchInputs: [request],
      cacheEntries: [['/index.html', 'network page copy']],
      events: ['fetch', 'open', 'put:/index.html'],
    })
  })

  it('returns a redirected network page without caching it', async () => {
    const events: string[] = []
    const redirectedResponse = createResponse({ redirected: true })
    const fetchMock = vi.fn(() => {
      events.push('fetch')
      return Promise.resolve(redirectedResponse)
    })
    const worker = createWorker([], fetchMock, events)
    const request = navigateRequest('/')
    const result = await dispatchFetch(worker, request)

    expect(result).toEqual({
      handled: true,
      response: redirectedResponse,
      fetchInputs: [request],
      cacheEntries: [],
      events: ['fetch'],
    })
  })

  it('falls back to the cached app shell when the navigation request fails', async () => {
    const events: string[] = []
    const fetchMock = vi.fn(() => {
      events.push('fetch')
      return Promise.reject(new TypeError('network failure'))
    })
    const worker = createWorker([], fetchMock, events)
    worker.cacheEntries.set('/index.html', 'cached app shell')
    const request = navigateRequest('/articles/sample')
    const result = await dispatchFetch(worker, request)

    expect(result).toEqual({
      handled: true,
      response: 'cached app shell',
      fetchInputs: [request],
      cacheEntries: [['/index.html', 'cached app shell']],
      events: ['fetch', 'match:/index.html'],
    })
  })

  it('returns the network page when writing the cache fails', async () => {
    const events: string[] = []
    const networkResponse = createResponse()
    const fetchMock = vi.fn(() => {
      events.push('fetch')
      return Promise.resolve(networkResponse)
    })
    const worker = createWorker([], fetchMock, events)
    worker.cache.put.mockRejectedValueOnce(new TypeError('cache unavailable'))
    const request = navigateRequest('/articles/sample')
    const result = await dispatchFetch(worker, request)

    expect(result).toEqual({
      handled: true,
      response: networkResponse,
      fetchInputs: [request],
      cacheEntries: [],
      events: ['fetch', 'open'],
    })
  })

  it('does not handle API or WebSocket requests', async () => {
    const events: string[] = []
    const fetchMock = vi.fn(() => {
      events.push('fetch')
      return Promise.resolve(createResponse())
    })
    const worker = createWorker([], fetchMock, events)
    const apiRequest = dispatchFetch(worker, {
      url: 'https://site.example.test/api/sync/document',
      method: 'GET',
      mode: 'cors',
    })
    const websocketRequest = dispatchFetch(worker, {
      url: 'wss://site.example.test/api/sync/document',
      method: 'GET',
      mode: 'websocket',
    })

    expect(await Promise.all([apiRequest, websocketRequest])).toEqual([
      {
        handled: false,
        response: undefined,
        fetchInputs: [],
        cacheEntries: [],
        events: [],
      },
      {
        handled: false,
        response: undefined,
        fetchInputs: [],
        cacheEntries: [],
        events: [],
      },
    ])
  })
})
