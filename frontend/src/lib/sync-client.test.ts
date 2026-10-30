import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import type { SyncClientOptions } from '#lib/sync-client'
import { createSyncClient } from '#lib/sync-client'

class FakePersistence {
  synced = false
  private readonly listeners = new Set<() => void>()

  constructor(docId: string, doc: Y.Doc, storage: Map<string, Uint8Array>) {
    const savedUpdate = storage.get(docId)
    if (savedUpdate) Y.applyUpdate(doc, savedUpdate)
    doc.on('update', () => storage.set(docId, Y.encodeStateAsUpdate(doc)))
    queueMicrotask(() => {
      this.synced = true
      for (const listener of this.listeners) listener()
    })
  }

  on(_event: 'synced', listener: () => void) {
    this.listeners.add(listener)
  }
}

class FakeWebsocketProvider {
  synced = false
  wsconnected = false
  wsconnecting = true
  private readonly statusListeners = new Set<
    (event: { status: 'connected' | 'connecting' | 'disconnected' }) => void
  >()
  private readonly connectionCloseListeners = new Set<() => void>()
  private readonly syncListeners = new Set<(isSynced: boolean) => void>()

  constructor(
    readonly url: string,
    readonly docId: string,
  ) {}

  onStatus(
    listener: (event: {
      status: 'connected' | 'connecting' | 'disconnected'
    }) => void,
  ) {
    this.statusListeners.add(listener)
  }

  onConnectionClose(listener: () => void) {
    this.connectionCloseListeners.add(listener)
  }

  onSync(listener: (isSynced: boolean) => void) {
    this.syncListeners.add(listener)
  }

  emitStatus(status: 'connected' | 'connecting' | 'disconnected') {
    this.wsconnected = status === 'connected'
    this.wsconnecting = status === 'connecting'
    for (const listener of this.statusListeners) listener({ status })
  }

  emitSync(isSynced: boolean) {
    this.synced = isSynced
    for (const listener of this.syncListeners) listener(isSynced)
  }

  emitConnectionClose() {
    for (const listener of this.connectionCloseListeners) listener()
    this.wsconnecting = false
    if (this.wsconnected) {
      this.synced = false
      this.emitStatus('disconnected')
    }
  }

  destroy() {}
}

const createFixture = (
  savedDocuments = new Map<string, Uint8Array>(),
  unavailableDocIds = new Set<string>(),
  options: Pick<SyncClientOptions, 'checkAccessRedirect'> = {
    checkAccessRedirect: () => Promise.resolve('unreachable'),
  },
) => {
  const providers: FakeWebsocketProvider[] = []
  const docs: Y.Doc[] = []
  let articleId = '018f0000-0000-7000-8000-000000000001'
  let now = 1_800_000_000_000
  const result = createSyncClient({
    createDoc: () => {
      const doc = new Y.Doc()
      docs.push(doc)
      return doc
    },
    createPersistence: (docId, doc) =>
      new FakePersistence(docId, doc, savedDocuments),
    createWebsocketProvider: (url, docId) => {
      if (unavailableDocIds.has(docId)) throw new Error('offline')
      const provider = new FakeWebsocketProvider(url, docId)
      providers.push(provider)
      return provider
    },
    createArticleId: () => articleId,
    now: () => now,
    ...options,
  })

  return {
    client: result._unsafeUnwrap(),
    providers,
    docs,
    savedDocuments,
    setArticleId: (id: string) => {
      articleId = id
    },
    setNow: (value: number) => {
      now = value
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createSyncClient', () => {
  it('restores indexed articles and opens a websocket for each document at startup', async () => {
    const storage = new Map<string, Uint8Array>()
    const savedIndex = new Y.Doc()
    const entry = new Y.Map<unknown>()
    entry.set('createdAt', 1_800_000_000_000)
    savedIndex
      .getMap<Y.Map<unknown>>('articles')
      .set('018f0000-0000-7000-8000-000000000001', entry)
    storage.set('article-index', Y.encodeStateAsUpdate(savedIndex))
    savedIndex.destroy()

    const { client, providers } = createFixture(storage)
    const startResult = await client.start().match(
      () => 'started',
      (error) => error.message,
    )

    const readStartupOutput = () => [
      startResult,
      client.listArticles(),
      providers.map(({ docId, url }) => ({ docId, url })),
    ]

    expect(readStartupOutput()).toEqual([
      'started',
      [
        {
          id: '018f0000-0000-7000-8000-000000000001',
          createdAt: 1_800_000_000_000,
        },
      ],
      [
        {
          docId: 'article-index',
          url: 'ws://localhost/api/sync',
        },
        {
          docId: '018f0000-0000-7000-8000-000000000001',
          url: 'ws://localhost/api/sync',
        },
      ],
    ])
    client.destroy()
  })

  it('creates an article with a nested entry and opens its document', async () => {
    const { client, providers, savedDocuments, setArticleId, setNow } =
      createFixture()
    const id = '018f0000-0000-7000-8000-000000000002'
    setArticleId(id)
    setNow(1_800_000_000_001)
    const createResult = client.createArticle()._unsafeUnwrap()
    const readArticleOutput = () => [
      createResult,
      client.listArticles(),
      providers.some((provider) => provider.docId === id),
    ]

    expect(readArticleOutput()).toEqual([
      { id, createdAt: 1_800_000_000_001 },
      [{ id, createdAt: 1_800_000_000_001 }],
      true,
    ])
    client.destroy()

    const restored = createFixture(savedDocuments)
    await restored.client.start()
    expect(restored.client.listArticles()).toEqual([
      { id, createdAt: 1_800_000_000_001 },
    ])
    restored.client.destroy()
  })

  it('updates document status across a connection and failed reconnect', async () => {
    const { client, providers } = createFixture()
    await client.start()
    const created = client.createArticle()._unsafeUnwrap()
    const provider = providers.find(({ docId }) => docId === created.id)

    const states = [client.getStatus(created.id)]
    await Promise.resolve()
    provider?.emitStatus('connecting')
    states.push(client.getStatus(created.id))
    provider?.emitStatus('connected')
    provider?.emitSync(true)
    states.push(client.getStatus(created.id))
    provider?.emitConnectionClose()
    states.push(client.getStatus(created.id))
    provider?.emitStatus('connecting')
    states.push(client.getStatus(created.id))
    provider?.emitConnectionClose()
    states.push(client.getStatus(created.id))

    expect(states).toEqual([
      'saved',
      'syncing',
      'synced',
      'unsynced',
      'unsynced',
      'unsynced',
    ])
    client.destroy()
  })

  it('marks a document unsynced when its first connection attempt closes', async () => {
    const { client, providers } = createFixture()
    await client.start()
    const created = client.createArticle()._unsafeUnwrap()
    const provider = providers.find(({ docId }) => docId === created.id)

    await Promise.resolve()
    const states = [client.getStatus(created.id)]
    provider?.emitConnectionClose()
    states.push(client.getStatus(created.id))

    expect(states).toEqual(['syncing', 'unsynced'])
    client.destroy()
  })

  const opaqueRedirectResponse = () => {
    const response = new Response()
    Object.defineProperties(response, {
      type: { value: 'opaqueredirect' },
      status: { value: 0 },
    })
    return response
  }

  const responseWithRedirectMetadata = () => {
    const response = new Response(null, { status: 302 })
    Object.defineProperty(response, 'redirected', { value: true })
    return response
  }

  it.each([
    {
      scenario: 'Access redirects to its login page',
      response: opaqueRedirectResponse(),
      expectedAuthentication: true,
    },
    {
      scenario: 'a visible redirect status is not an opaque redirect',
      response: responseWithRedirectMetadata(),
      expectedAuthentication: false,
    },
    {
      scenario: 'the network request cannot reach the server',
      response: undefined,
      expectedAuthentication: false,
    },
  ])(
    'distinguishes login expiry when $scenario',
    async ({ response, expectedAuthentication }) => {
      const requests: { url: string; options: RequestInit | undefined }[] = []
      const fetchMock = vi.fn((input: URL, init?: RequestInit) => {
        requests.push({ url: input.href, options: init })
        return response === undefined
          ? Promise.reject(new TypeError('offline'))
          : Promise.resolve(response)
      })
      vi.stubGlobal('fetch', fetchMock)
      const { client, providers } = createFixture(new Map(), new Set(), {})
      await client.start()
      const article = client.createArticle()._unsafeUnwrap()
      const provider = providers.find(({ docId }) => docId === article.id)

      provider?.emitConnectionClose()
      await new Promise((resolve) => setTimeout(resolve, 0))

      const readAuthenticationOutput = () => ({
        requiresAuthentication: client.requiresAuthentication(),
        status: client.getStatus(article.id),
        request: requests[0],
      })

      expect(readAuthenticationOutput()).toEqual({
        requiresAuthentication: expectedAuthentication,
        status: 'unsynced',
        request: {
          url: 'http://localhost/',
          options: { cache: 'no-store', redirect: 'manual' },
        },
      })
      client.destroy()
    },
  )

  it.each([
    { scenario: 'the app is reachable', result: 'reachable' as const },
    { scenario: 'the app is unreachable', result: 'unreachable' as const },
  ])('clears the login prompt when $scenario', async ({ result }) => {
    const results: ('redirected' | 'reachable' | 'unreachable')[] = [
      'redirected',
      result,
    ]
    const checkAccessRedirect = vi.fn(() =>
      Promise.resolve(results.shift() ?? 'unreachable'),
    )
    const { client, providers } = createFixture(new Map(), new Set(), {
      checkAccessRedirect,
    })
    await client.start()
    const article = client.createArticle()._unsafeUnwrap()
    const provider = providers.find(({ docId }) => docId === article.id)

    provider?.emitConnectionClose()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const initiallyRequired = client.requiresAuthentication()
    provider?.emitConnectionClose()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const readAuthenticationOutput = () => ({
      initiallyRequired,
      requiresAuthentication: client.requiresAuthentication(),
      status: client.getStatus(article.id),
      checks: checkAccessRedirect.mock.calls.length,
    })

    expect(readAuthenticationOutput()).toEqual({
      initiallyRequired: true,
      requiresAuthentication: false,
      status: 'unsynced',
      checks: 2,
    })
    client.destroy()
  })

  it('clears the login prompt when the websocket reconnects', async () => {
    const checkAccessRedirect = vi.fn(() =>
      Promise.resolve('redirected' as const),
    )
    const { client, providers } = createFixture(new Map(), new Set(), {
      checkAccessRedirect,
    })
    await client.start()
    const article = client.createArticle()._unsafeUnwrap()
    const provider = providers.find(({ docId }) => docId === article.id)

    provider?.emitConnectionClose()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const initiallyRequired = client.requiresAuthentication()
    provider?.emitStatus('connected')

    const readAuthenticationOutput = () => ({
      initiallyRequired,
      requiresAuthentication: client.requiresAuthentication(),
      status: client.getStatus(article.id),
      checks: checkAccessRedirect.mock.calls.length,
    })

    expect(readAuthenticationOutput()).toEqual({
      initiallyRequired: true,
      requiresAuthentication: false,
      status: 'syncing',
      checks: 1,
    })
    client.destroy()
  })

  it('runs only one authentication check for simultaneous document failures', async () => {
    const checkAccessRedirect = vi.fn(() =>
      Promise.resolve('unreachable' as const),
    )
    const { client, providers, setArticleId } = createFixture(
      new Map(),
      new Set(),
      { checkAccessRedirect },
    )
    await client.start()
    const firstArticle = client.createArticle()._unsafeUnwrap()
    setArticleId('018f0000-0000-7000-8000-000000000006')
    const secondArticle = client.createArticle()._unsafeUnwrap()
    const articles = [firstArticle, secondArticle]
    const articleProviders = articles.map(({ id }) =>
      providers.find(({ docId }) => docId === id),
    )

    articleProviders[0]?.emitConnectionClose()
    articleProviders[1]?.emitConnectionClose()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const readAuthenticationOutput = () => ({
      requiresAuthentication: client.requiresAuthentication(),
      statuses: articles.map(({ id }) => client.getStatus(id)),
      checks: checkAccessRedirect.mock.calls.length,
    })

    expect(readAuthenticationOutput()).toEqual({
      requiresAuthentication: false,
      statuses: ['unsynced', 'unsynced'],
      checks: 1,
    })
    client.destroy()
  })

  it('opens an article added to the index after startup', async () => {
    const { client, docs, providers } = createFixture()
    await client.start()
    const entry = new Y.Map<unknown>()
    entry.set('createdAt', 1_800_000_000_000)
    docs[0]
      ?.getMap<Y.Map<unknown>>('articles')
      .set('018f0000-0000-7000-8000-000000000003', entry)

    expect(providers.map(({ docId }) => docId)).toEqual([
      'article-index',
      '018f0000-0000-7000-8000-000000000003',
    ])
    client.destroy()
  })

  it('uses a secure websocket URL for an HTTPS page', () => {
    vi.stubGlobal('window', { location: { href: 'https://example.test/' } })
    const { client, providers } = createFixture()

    expect(providers.map(({ url }) => url)).toEqual([
      'wss://example.test/api/sync',
    ])
    client.destroy()
  })

  it('does not open article documents when destroyed before local loading finishes', async () => {
    const { client, providers } = createFixture()
    const start = client.start()
    client.destroy()
    const startResult = await start.match(
      () => 'started',
      (error) => error.message,
    )

    const readStartOutput = () => [
      startResult,
      providers.map(({ docId }) => docId),
    ]

    expect(readStartOutput()).toEqual([
      'The sync client has been destroyed',
      ['article-index'],
    ])
  })

  it('does not index an article when its document cannot be opened', () => {
    const id = '018f0000-0000-7000-8000-000000000004'
    const { client, setArticleId } = createFixture(new Map(), new Set([id]))
    setArticleId(id)
    const createResult = client.createArticle().match(
      () => 'created',
      (error) => error.message,
    )

    const readCreateOutput = () => [createResult, client.listArticles()]

    expect(readCreateOutput()).toEqual([
      'Failed to initialize document synchronization',
      [],
    ])
    client.destroy()
  })

  it('reports when a stored article cannot be opened during startup', async () => {
    const docId = '018f0000-0000-7000-8000-000000000005'
    const savedIndex = new Y.Doc()
    const entry = new Y.Map<unknown>()
    entry.set('createdAt', 1_800_000_000_000)
    savedIndex.getMap<Y.Map<unknown>>('articles').set(docId, entry)
    const storage = new Map([
      ['article-index', Y.encodeStateAsUpdate(savedIndex)],
    ])
    savedIndex.destroy()

    const { client, providers } = createFixture(storage, new Set([docId]))
    const startResult = await client.start().match(
      () => 'started',
      (error) => error.message,
    )

    const readStartOutput = () => [
      startResult,
      providers.map(({ docId: room }) => room),
    ]

    expect(readStartOutput()).toEqual([
      'Failed to initialize document synchronization',
      ['article-index'],
    ])
    client.destroy()
  })
})
