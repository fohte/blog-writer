import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

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

  destroy() {}
}

const createFixture = (savedDocuments = new Map<string, Uint8Array>()) => {
  const providers: FakeWebsocketProvider[] = []
  let articleId = '018f0000-0000-7000-8000-000000000001'
  let now = 1_800_000_000_000
  const result = createSyncClient({
    createDoc: () => new Y.Doc(),
    createPersistence: (docId, doc) =>
      new FakePersistence(docId, doc, savedDocuments),
    createWebsocketProvider: (url, docId) => {
      const provider = new FakeWebsocketProvider(url, docId)
      providers.push(provider)
      return provider
    },
    createArticleId: () => articleId,
    now: () => now,
  })

  return {
    client: result._unsafeUnwrap(),
    providers,
    setArticleId: (id: string) => {
      articleId = id
    },
    setNow: (value: number) => {
      now = value
    },
  }
}

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
          url: 'ws://localhost/api/sync/article-index',
        },
        {
          docId: '018f0000-0000-7000-8000-000000000001',
          url: 'ws://localhost/api/sync/018f0000-0000-7000-8000-000000000001',
        },
      ],
    ])
    client.destroy()
  })

  it('creates an article with a nested entry and opens its document', () => {
    const { client, providers, setArticleId, setNow } = createFixture()
    const id = '018f0000-0000-7000-8000-000000000002'
    setArticleId(id)
    setNow(1_800_000_000_001)
    const createResult = client.createArticle()._unsafeUnwrap()
    const entry = client.indexDoc.getMap<Y.Map<unknown>>('articles').get(id)

    const readArticleOutput = () => [
      createResult,
      entry ? Object.fromEntries(entry) : undefined,
      client.listArticles(),
      providers.some((provider) => provider.docId === id),
    ]

    expect(readArticleOutput()).toEqual([
      { id, createdAt: 1_800_000_000_001 },
      { createdAt: 1_800_000_000_001 },
      [{ id, createdAt: 1_800_000_000_001 }],
      true,
    ])
    client.destroy()
  })

  it('updates document status as the websocket connects and disconnects', async () => {
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
    provider?.emitStatus('disconnected')
    states.push(client.getStatus(created.id))

    expect(states).toEqual(['saved', 'syncing', 'synced', 'unsynced'])
    client.destroy()
  })
})
