import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { getBody, moveBlock, readBody, setBody } from '#article/index'
import type { SyncClientOptions } from '#lib/sync-client'
import { createSyncClient } from '#lib/sync-client'

class ManualPersistence {
  synced = false
  private readonly listeners = new Set<() => void>()

  on(_event: 'synced', listener: () => void) {
    this.listeners.add(listener)
  }

  complete() {
    this.synced = true
    for (const listener of this.listeners) listener()
  }
}

class FakeWebsocketProvider {
  synced = false
  wsconnected = false
  wsconnecting = true

  constructor(readonly docId: string) {}

  onConnectionClose() {}

  onStatus() {}

  onSync() {}

  destroy() {}
}

function createConflictUpdates() {
  const baseline = new Y.Doc()
  baseline.clientID = 71
  const initialBody = '## Cedar\na1\n## Fjord\nmaple maple\n## Vista\nz9\n'
  setBody(baseline, initialBody)

  const offlineEditor = new Y.Doc()
  offlineEditor.clientID = 73
  Y.applyUpdate(offlineEditor, Y.encodeStateAsUpdate(baseline))
  const offlineBody = getBody(offlineEditor)
  offlineBody.insert(offlineBody.toJSON().indexOf('maple') + 5, 'xy')
  offlineBody.delete(offlineBody.toJSON().lastIndexOf('ple'), 3)

  const mover = new Y.Doc()
  mover.clientID = 72
  Y.applyUpdate(mover, Y.encodeStateAsUpdate(baseline))
  moveBlock(mover, {
    from: initialBody.indexOf('## Fjord\n'),
    destination: initialBody.length,
  })._unsafeUnwrap()

  return {
    baseline,
    offlineEditor,
    mover,
    offlineUpdate: Y.encodeStateAsUpdate(offlineEditor),
    moveUpdate: Y.encodeStateAsUpdate(mover, Y.encodeStateVector(baseline)),
  }
}

describe('sync document persistence', () => {
  it('starts the article index while its local persistence is still loading', async () => {
    const persistenceByDocId = new Map<string, ManualPersistence>()
    const providerDocIds: string[] = []
    const client = createSyncClient({
      createDoc: () => new Y.Doc(),
      createPersistence: (docId) => {
        const persistence = new ManualPersistence()
        persistenceByDocId.set(docId, persistence)
        return persistence
      },
      createWebsocketProvider: (_url, docId) => {
        providerDocIds.push(docId)
        return new FakeWebsocketProvider(docId)
      },
      createArticleId: () => 'article-created-before-index-load',
      now: () => 1_800_000_000_000,
    })._unsafeUnwrap()
    const startResult = await Promise.race([
      client.start().match(
        () => 'started',
        (error) => error.message,
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve('pending')
        }, 50)
      }),
    ])
    const createdArticle = client.createArticle()._unsafeUnwrap()

    const readPendingIndexOutput = () => ({
      startResult,
      createdArticle,
      articles: client.listArticles(),
      providers: providerDocIds,
      articleStatus: client.getStatus(createdArticle.id),
      indexPersistenceReady:
        persistenceByDocId.get('article-index')?.synced ?? false,
    })
    expect(readPendingIndexOutput()).toEqual({
      startResult: 'started',
      createdArticle: {
        id: 'article-created-before-index-load',
        createdAt: 1_800_000_000_000,
        title: 'Untitled article',
      },
      articles: [
        {
          id: 'article-created-before-index-load',
          createdAt: 1_800_000_000_000,
          title: 'Untitled article',
        },
      ],
      providers: ['article-index'],
      articleStatus: 'unsynced',
      indexPersistenceReady: false,
    })
    client.destroy()
  })

  it('repairs a persisted move conflict before opening its websocket', () => {
    const articleId = 'article-hydration'
    const { baseline, offlineEditor, mover, offlineUpdate, moveUpdate } =
      createConflictUpdates()
    const persistenceByDocId = new Map<string, ManualPersistence>()
    const providerDocIds: string[] = []
    const client = createSyncClient({
      createDoc: () => new Y.Doc(),
      createPersistence: (docId, doc) => {
        if (docId === articleId) {
          Y.applyUpdate(doc, offlineUpdate, 'indexeddb')
          Y.applyUpdate(doc, moveUpdate, 'remote-move')
        }
        const persistence = new ManualPersistence()
        persistenceByDocId.set(docId, persistence)
        return persistence
      },
      createWebsocketProvider: (_url, docId) => {
        providerDocIds.push(docId)
        return new FakeWebsocketProvider(docId)
      },
      createArticleId: () => articleId,
      now: () => 1_800_000_000_000,
    })._unsafeUnwrap()
    const articleDoc = client.openDocument(articleId)._unsafeUnwrap()
    const providerDocIdsBeforeLoad = [...providerDocIds]
    const statusBeforeLoad = client.getStatus(articleId)
    const bodyBeforeLoad = readBody(articleDoc)
    const acknowledgementsBeforeLoad = articleDoc.getMap('move-acks').size
    persistenceByDocId.get(articleId)?.complete()

    const readHydrationOutput = () => ({
      providerDocIdsBeforeLoad,
      statusBeforeLoad,
      bodyBeforeLoad,
      acknowledgementsBeforeLoad,
      providerDocIdsAfterLoad: providerDocIds,
      body: readBody(articleDoc),
      acknowledgements: articleDoc.getMap('move-acks').size,
      statusAfterLoad: client.getStatus(articleId),
    })
    expect(readHydrationOutput()).toEqual({
      providerDocIdsBeforeLoad: ['article-index'],
      statusBeforeLoad: 'unsynced',
      bodyBeforeLoad: '## Cedar\na1\nxy## Vista\nz9\n\n## Fjord\nmaple ma\n',
      acknowledgementsBeforeLoad: 1,
      providerDocIdsAfterLoad: ['article-index', articleId],
      body: '## Cedar\na1\nxy## Vista\nz9\n\n## Fjord\nmaple ma\n',
      acknowledgements: 1,
      statusAfterLoad: 'syncing',
    })
    client.destroy()
    baseline.destroy()
    offlineEditor.destroy()
    mover.destroy()
  })

  it('keeps editing local when persistence never finishes loading', () => {
    const articleId = 'article-local-only'
    const providerDocIds: string[] = []
    const client = createSyncClient({
      createDoc: () => new Y.Doc(),
      createPersistence: () => new ManualPersistence(),
      createWebsocketProvider: (_url, docId) => {
        providerDocIds.push(docId)
        return new FakeWebsocketProvider(docId)
      },
      createArticleId: () => articleId,
      now: () => 1_800_000_000_000,
    })._unsafeUnwrap()
    const articleDoc = client.openDocument(articleId)._unsafeUnwrap()
    setBody(articleDoc, 'Local draft\n')

    const readLocalOnlyOutput = () => ({
      status: client.getStatus(articleId),
      body: readBody(articleDoc),
      providerDocIds,
    })
    expect(readLocalOnlyOutput()).toEqual({
      status: 'unsynced',
      body: 'Local draft\n',
      providerDocIds: ['article-index'],
    })
    client.destroy()
  })

  it('stops observing move conflicts when the sync client is destroyed', () => {
    const docs: Y.Doc[] = []
    const options: SyncClientOptions = {
      createDoc: () => {
        const doc = new Y.Doc()
        docs.push(doc)
        return doc
      },
      createPersistence: () => new ManualPersistence(),
      createWebsocketProvider: (_url, docId) =>
        new FakeWebsocketProvider(docId),
      createArticleId: () => 'article-observer-cleanup',
      now: () => 1_800_000_000_000,
    }
    const client = createSyncClient(options)._unsafeUnwrap()
    const articleDoc = client
      .openDocument('article-observer-cleanup')
      ._unsafeUnwrap()
    const off = vi.spyOn(articleDoc, 'off')
    client.destroy()

    const readCleanupOutput = () =>
      off.mock.calls.filter(([event]) => event === 'afterTransaction').length
    expect(readCleanupOutput()).toEqual(1)
  })
})
