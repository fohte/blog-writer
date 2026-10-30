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
    fetch: fetchImpl,
    self: workerSelf,
    URL,
  })

  return { cache, cacheEntries, cacheStorage, events, listeners, workerSelf }
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

  return {
    handled: responsePromise !== undefined,
    response: await responsePromise,
  }
}

describe('service worker', () => {
  it('rejects installation when an app shell precache request redirects', async () => {
    const events: string[] = []
    const fetchMock = vi.fn((input: unknown) => {
      events.push(`fetch:${String(input)}`)
      return Promise.resolve(createResponse({ redirected: true }))
    })
    const worker = createWorker(['/index.html'], fetchMock, events)
    const installPromises: Promise<unknown>[] = []
    worker.listeners.get('install')?.({
      waitUntil: (promise) => installPromises.push(promise),
    })
    const installation = await Promise.all(installPromises).then(
      () => 'installed',
      () => 'rejected',
    )

    const readInstallationOutput = () => ({
      installation,
      cachedUrls: [...worker.cacheEntries.keys()],
      events,
      skipWaitingCalls: worker.workerSelf.skipWaiting.mock.calls.length,
    })

    expect(readInstallationOutput()).toEqual({
      installation: 'rejected',
      cachedUrls: [],
      events: ['open', 'fetch:/index.html'],
      skipWaitingCalls: 0,
    })
  })

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
    const installPromises: Promise<unknown>[] = []
    worker.listeners.get('install')?.({
      waitUntil: (promise) => installPromises.push(promise),
    })
    await Promise.all(installPromises)

    const readInstallationOutput = () => ({
      cachedUrls: [...worker.cacheEntries.keys()],
      events,
      skipWaitingCalls: worker.workerSelf.skipWaiting.mock.calls.length,
    })

    expect(readInstallationOutput()).toEqual({
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
    const fetchedInputs: unknown[] = []
    const networkResponse = createResponse({ cloneValue: 'network page copy' })
    const fetchMock = vi.fn((input: unknown) => {
      fetchedInputs.push(input)
      events.push('fetch')
      return Promise.resolve(networkResponse)
    })
    const worker = createWorker([], fetchMock, events)
    const request = {
      url: 'https://site.example.test/articles/sample',
      method: 'GET',
      mode: 'navigate',
    }
    const result = await dispatchFetch(worker, request)

    const readNavigationOutput = () => ({
      handled: result.handled,
      returnedNetworkResponse: result.response === networkResponse,
      fetchedOriginalRequest: fetchedInputs[0] === request,
      cachedUrls: [...worker.cacheEntries.keys()],
      cachedPage: worker.cacheEntries.get('/index.html'),
      events,
    })

    expect(readNavigationOutput()).toEqual({
      handled: true,
      returnedNetworkResponse: true,
      fetchedOriginalRequest: true,
      cachedUrls: ['/index.html'],
      cachedPage: 'network page copy',
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
    const result = await dispatchFetch(worker, {
      url: 'https://site.example.test/',
      method: 'GET',
      mode: 'navigate',
    })

    const readNavigationOutput = () => ({
      handled: result.handled,
      returnedNetworkResponse: result.response === redirectedResponse,
      cachedUrls: [...worker.cacheEntries.keys()],
      events,
    })

    expect(readNavigationOutput()).toEqual({
      handled: true,
      returnedNetworkResponse: true,
      cachedUrls: [],
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
    const result = await dispatchFetch(worker, {
      url: 'https://site.example.test/articles/sample',
      method: 'GET',
      mode: 'navigate',
    })

    const readNavigationOutput = () => ({
      handled: result.handled,
      response: result.response,
      events,
    })

    expect(readNavigationOutput()).toEqual({
      handled: true,
      response: 'cached app shell',
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
    const result = await dispatchFetch(worker, {
      url: 'https://site.example.test/articles/sample',
      method: 'GET',
      mode: 'navigate',
    })

    const readNavigationOutput = () => ({
      handled: result.handled,
      returnedNetworkResponse: result.response === networkResponse,
      events,
    })

    expect(readNavigationOutput()).toEqual({
      handled: true,
      returnedNetworkResponse: true,
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
    const apiRequest = await dispatchFetch(worker, {
      url: 'https://site.example.test/api/sync/document',
      method: 'GET',
      mode: 'cors',
    })
    const websocketRequest = await dispatchFetch(worker, {
      url: 'wss://site.example.test/api/sync/document',
      method: 'GET',
      mode: 'websocket',
    })

    const readIgnoredRequestOutput = () => ({
      apiRequest,
      websocketRequest,
      networkFetches: fetchMock.mock.calls.length,
      events,
    })

    expect(readIgnoredRequestOutput()).toEqual({
      apiRequest: { handled: false, response: undefined },
      websocketRequest: { handled: false, response: undefined },
      networkFetches: 0,
      events: [],
    })
  })
})
