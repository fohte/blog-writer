import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { TRASH_RETENTION_MS } from '#article/constants'
import {
  addEvidence,
  addMemo,
  addSource,
  dismissMemo,
  getPremise,
  listFindings,
  listSources,
  moveBlock,
  readBody,
  setBody,
  setFindings,
  setMemoAdoptedTo,
  setPremise,
} from '#article/index'
import type { Article, SyncClientOptions } from '#lib/sync-client'
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

function combineArticleListSnapshots(
  beforeRestart: Article[],
  afterRestart: Article[],
) {
  return [beforeRestart, afterRestart]
}

const createFixture = (
  savedDocuments = new Map<string, Uint8Array>(),
  unavailableDocIds = new Set<string>(),
  options: Pick<SyncClientOptions, 'checkAccessRedirect'> = {
    checkAccessRedirect: () => Promise.resolve('unreachable'),
  },
  persistenceFailures = new Set<string>(),
) => {
  const providers: FakeWebsocketProvider[] = []
  const providerAttempts = new Map<string, number>()
  const persistenceAttempts = new Map<string, number>()
  const docs: Y.Doc[] = []
  let articleId = '018f0000-0000-7000-8000-000000000001'
  let now = 1_800_000_000_000
  const result = createSyncClient({
    createDoc: () => {
      const doc = new Y.Doc()
      docs.push(doc)
      return doc
    },
    createPersistence: (docId, doc) => {
      persistenceAttempts.set(docId, (persistenceAttempts.get(docId) ?? 0) + 1)
      if (persistenceFailures.has(docId)) throw new Error('storage unavailable')
      return new FakePersistence(docId, doc, savedDocuments)
    },
    createWebsocketProvider: (url, docId) => {
      providerAttempts.set(docId, (providerAttempts.get(docId) ?? 0) + 1)
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
    providerAttempts,
    persistenceAttempts,
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
    entry.set('syncFilePath', 'notes/sample.md')
    entry.set('syncFileHash', 'sample-hash')
    entry.set('syncFileStatus', 'external_changed')
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
    await Promise.resolve()

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
          title: 'Untitled article',
          syncFilePath: 'notes/sample.md',
          syncFileHash: 'sample-hash',
          syncFileStatus: 'external_changed',
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
    await Promise.resolve()
    const readArticleOutput = () => [
      createResult,
      client.listArticles(),
      providers.some((provider) => provider.docId === id),
    ]

    expect(readArticleOutput()).toEqual([
      { id, createdAt: 1_800_000_000_001, title: 'Untitled article' },
      [{ id, createdAt: 1_800_000_000_001, title: 'Untitled article' }],
      true,
    ])
    client.destroy()

    const restored = createFixture(savedDocuments)
    await restored.client.start()
    expect(restored.client.listArticles()).toEqual([
      { id, createdAt: 1_800_000_000_001, title: 'Untitled article' },
    ])
    restored.client.destroy()
  })

  it('keeps article titles in the index document instead of the article document', () => {
    const { client } = createFixture()
    const article = client.createArticle()._unsafeUnwrap()
    const articleDoc = client.openDocument(article.id)._unsafeUnwrap()
    client.updateArticleTitle(article.id, 'A revised title')._unsafeUnwrap()

    const readTitleOutput = () => ({
      articles: client.listArticles(),
      articleDocumentHasTitle: articleDoc.share.has('title'),
    })
    expect(readTitleOutput()).toEqual({
      articles: [
        {
          id: article.id,
          createdAt: article.createdAt,
          updatedAt: article.createdAt,
          title: 'A revised title',
        },
      ],
      articleDocumentHasTitle: false,
    })
    client.destroy()
  })

  it('records local edits at most once a minute', () => {
    const { client, setNow } = createFixture()
    const article = client.createArticle()._unsafeUnwrap()
    const body = client.openDocument(article.id)._unsafeUnwrap().getText('body')
    const readUpdatedAt = () => client.listArticles()[0]?.updatedAt
    const start = 1_800_000_100_000
    const updatedAtAfter = (now: number, edit: () => void) => {
      setNow(now)
      edit()
      return readUpdatedAt()
    }
    const insert = () => {
      body.insert(0, 'x')
    }

    const readEditTimes = () => ({
      beforeEditing: readUpdatedAt(),
      firstEdit: updatedAtAfter(start, insert),
      withinTheMinute: updatedAtAfter(start + 59_999, insert),
      afterTheMinute: updatedAtAfter(start + 60_000, insert),
      titleEdit: updatedAtAfter(start + 120_000, () => {
        client.updateArticleTitle(article.id, 'A revised title')._unsafeUnwrap()
      }),
    })
    expect(readEditTimes()).toEqual({
      beforeEditing: undefined,
      firstEdit: start,
      withinTheMinute: start,
      afterTheMinute: start + 60_000,
      titleEdit: start + 120_000,
    })
    client.destroy()
  })

  it('keeps the edit time after a restart', () => {
    const { client, savedDocuments } = createFixture()
    const article = client.createArticle()._unsafeUnwrap()
    client
      .openDocument(article.id)
      ._unsafeUnwrap()
      .getText('body')
      .insert(0, 'x')
    client.destroy()

    const restored = createFixture(savedDocuments)

    expect(restored.client.listArticles()).toEqual([
      { ...article, updatedAt: article.createdAt },
    ])
    restored.client.destroy()
  })

  it('does not count a change received from elsewhere as a local edit', () => {
    const { client } = createFixture()
    const article = client.createArticle()._unsafeUnwrap()
    const peer = new Y.Doc()
    peer.getText('body').insert(0, 'Written on another device')

    Y.applyUpdate(
      client.openDocument(article.id)._unsafeUnwrap(),
      Y.encodeStateAsUpdate(peer),
    )

    expect(client.listArticles()).toEqual([article])
    peer.destroy()
    client.destroy()
  })

  it('duplicates an article without its research or publishing targets', async () => {
    const { client, providers, setArticleId, setNow } = createFixture()
    const sourceId = '018f0000-0000-7000-8000-000000000002'
    const copyId = '018f0000-0000-7000-8000-000000000003'
    setArticleId(sourceId)
    client.createArticle()._unsafeUnwrap()
    await Promise.resolve()
    const provider = providers.at(-1)
    provider?.emitStatus('connected')
    provider?.emitSync(true)
    const sourceDoc = client.openDocument(sourceId)._unsafeUnwrap()
    setBody(sourceDoc, 'A paragraph.\n')
    setPremise(sourceDoc, 'audience', 'Gardeners')
    addSource(sourceDoc, {
      id: 'source-a',
      kind: 'url',
      title: 'Example source',
      url: 'https://example.invalid/report',
      fileName: null,
      checkedAt: '2026-02-01T00:00:00.000Z',
      summary: 'A source summary.',
    })._unsafeUnwrap()
    setFindings(sourceDoc, 'source-a', [
      { id: 'finding-a', text: 'A key point.', quote: 'A quotation.' },
    ])._unsafeUnwrap()
    addEvidence(sourceDoc, {
      id: 'evidence-a',
      from: 0,
      to: 1,
      claim: 'A',
      sourceId: 'source-a',
      quote: 'A quotation.',
      verdict: 'supported',
      checkedAt: '2026-02-01T00:00:00.000Z',
    })._unsafeUnwrap()
    client.updateArticleTitle(sourceId, 'A garden article')._unsafeUnwrap()
    client
      .updateArticleExportSettings(sourceId, { exportSlug: 'a-garden-article' })
      ._unsafeUnwrap()
    setArticleId(copyId)
    setNow(1_800_000_100_000)

    const copy = client.duplicateArticle(sourceId)._unsafeUnwrap()
    const copyDoc = client.openDocument(copyId)._unsafeUnwrap()
    const articles = client.listArticles()
    const copiedBody = readBody(copyDoc)
    const copiedPremise = getPremise(copyDoc)
    const copiedSources = listSources(copyDoc)
    const copiedFindings = listFindings(copyDoc)
    const copiedEvidenceIds = [...copyDoc.getMap('evidence').keys()]
    setBody(copyDoc, 'An edited copy.\n')

    const readOutput = () => ({
      copy,
      articles,
      copiedBody,
      copiedPremise,
      copiedSources,
      copiedFindings,
      copiedEvidenceIds,
      sourceBodyAfterEditingCopy: readBody(sourceDoc),
    })
    expect(readOutput()).toEqual({
      copy: {
        id: copyId,
        createdAt: 1_800_000_100_000,
        title: 'A garden article のコピー',
      },
      articles: [
        {
          id: sourceId,
          createdAt: 1_800_000_000_000,
          updatedAt: 1_800_000_000_000,
          title: 'A garden article',
          exportSlug: 'a-garden-article',
        },
        {
          id: copyId,
          createdAt: 1_800_000_100_000,
          title: 'A garden article のコピー',
        },
      ],
      copiedBody: 'A paragraph.\n',
      copiedPremise: { audience: 'Gardeners', purpose: null, claim: null },
      copiedSources: [],
      copiedFindings: [],
      copiedEvidenceIds: [],
      sourceBodyAfterEditingCopy: 'A paragraph.\n',
    })
    client.destroy()
  })

  it.each([
    ['its local copy has not loaded', false],
    ['it is still arriving from the server', true],
  ])(
    'refuses to duplicate an article while %s',
    async (_name, localCopyLoaded) => {
      const { client, setArticleId } = createFixture()
      const article = client.createArticle()._unsafeUnwrap()
      if (localCopyLoaded) await Promise.resolve()
      setArticleId('018f0000-0000-7000-8000-000000000003')

      const readOutput = () => ({
        error: client.duplicateArticle(article.id)._unsafeUnwrapErr().message,
        articles: client.listArticles(),
      })
      expect(readOutput()).toEqual({
        error: 'The article is not ready to copy',
        articles: [article],
      })
      client.destroy()
    },
  )

  it('duplicates an article from its local copy while offline', async () => {
    const { client, providers, setArticleId } = createFixture()
    const article = client.createArticle()._unsafeUnwrap()
    await Promise.resolve()
    providers.at(-1)?.emitConnectionClose()
    const copyId = '018f0000-0000-7000-8000-000000000003'
    setArticleId(copyId)

    expect(client.duplicateArticle(article.id)._unsafeUnwrap()).toEqual({
      id: copyId,
      createdAt: article.createdAt,
      title: 'Untitled article のコピー',
    })
    client.destroy()
  })

  it('summarizes the memos and body of a synced article', async () => {
    const { client, providers } = createFixture()
    const article = client.createArticle()._unsafeUnwrap()
    await Promise.resolve()
    const provider = providers.at(-1)
    provider?.emitStatus('connected')
    provider?.emitSync(true)
    const doc = client.openDocument(article.id)._unsafeUnwrap()
    setBody(doc, '# A heading\n\nA paragraph.\n')
    addMemo(doc, { id: 'memo-a', text: 'A note', order: 0 })._unsafeUnwrap()
    addMemo(doc, { id: 'memo-b', text: 'A note', order: 1 })._unsafeUnwrap()
    addMemo(doc, { id: 'memo-c', text: 'A note', order: 2 })._unsafeUnwrap()
    addMemo(doc, { id: 'memo-d', text: 'A note', order: 3 })._unsafeUnwrap()
    dismissMemo(doc, 'memo-c')._unsafeUnwrap()
    setMemoAdoptedTo(doc, 'memo-d', 0)._unsafeUnwrap()

    expect(client.getArticleSummary(article.id)).toEqual({
      unorganizedMemoCount: 2,
      bodyIsEmpty: false,
    })
    client.destroy()
  })

  it('treats a whitespace-only body as empty from the local copy while offline', async () => {
    const { client, providers } = createFixture()
    const article = client.createArticle()._unsafeUnwrap()
    await Promise.resolve()
    providers.at(-1)?.emitConnectionClose()
    setBody(client.openDocument(article.id)._unsafeUnwrap(), ' \n')

    expect(client.getArticleSummary(article.id)).toEqual({
      unorganizedMemoCount: 0,
      bodyIsEmpty: true,
    })
    client.destroy()
  })

  it.each([
    ['its local copy has not loaded', false],
    ['it is still arriving from the server', true],
  ])(
    'has no summary for an article while %s',
    async (_name, localCopyLoaded) => {
      const { client } = createFixture()
      const article = client.createArticle()._unsafeUnwrap()
      if (localCopyLoaded) await Promise.resolve()

      expect(client.getArticleSummary(article.id)).toBeUndefined()
      client.destroy()
    },
  )

  it('keeps a trashed article across a restart until it is restored', () => {
    const { client, savedDocuments, setNow } = createFixture()
    const article = client.createArticle()._unsafeUnwrap()
    setNow(1_800_000_100_000)
    client.trashArticle(article.id)._unsafeUnwrap()
    client.destroy()

    const restarted = createFixture(savedDocuments)
    const afterRestart = restarted.client.listArticles()
    restarted.client.restoreArticle(article.id)._unsafeUnwrap()

    const readOutput = () => ({
      afterRestart,
      afterRestore: restarted.client.listArticles(),
    })
    expect(readOutput()).toEqual({
      afterRestart: [
        {
          id: article.id,
          createdAt: article.createdAt,
          trashedAt: 1_800_000_100_000,
          title: 'Untitled article',
        },
      ],
      afterRestore: [article],
    })
    restarted.client.destroy()
  })

  it.each([
    ['opens and lists a trashed article before it expires', -1, true],
    ['stops opening and listing a trashed article once it expires', 0, false],
  ])('%s', async (_name, offset, available) => {
    const { client, savedDocuments } = createFixture()
    const article = client.createArticle()._unsafeUnwrap()
    client.trashArticle(article.id)._unsafeUnwrap()
    client.destroy()

    const restarted = createFixture(savedDocuments)
    const trashedAt = article.createdAt
    restarted.setNow(trashedAt + TRASH_RETENTION_MS + offset)
    await restarted.client.start()

    const readOutput = () => ({
      articles: restarted.client.listArticles(),
      openedDocuments: restarted.providerAttempts.has(article.id),
    })
    expect(readOutput()).toEqual({
      articles: available
        ? [
            {
              id: article.id,
              createdAt: article.createdAt,
              trashedAt,
              title: 'Untitled article',
            },
          ]
        : [],
      openedDocuments: available,
    })
    restarted.client.destroy()
  })

  it('persists export settings on the article index entry', async () => {
    const { client, savedDocuments } = createFixture()
    const article = client.createArticle()._unsafeUnwrap()
    client
      .updateArticleExportSettings(article.id, {
        exportDestinationId: 'sample-site',
        exportSlug: 'sample-post',
        exportFrontmatter: 'title: "Sample article"',
      })
      ._unsafeUnwrap()

    const beforeRestart = client.listArticles()
    const expectedArticles = [
      {
        id: article.id,
        createdAt: article.createdAt,
        title: article.title,
        exportDestinationId: 'sample-site',
        exportSlug: 'sample-post',
        exportFrontmatter: 'title: "Sample article"',
      },
    ]
    client.destroy()

    const restored = createFixture(savedDocuments)
    await restored.client.start()
    const afterRestart = restored.client.listArticles()
    expect(combineArticleListSnapshots(beforeRestart, afterRestart)).toEqual([
      expectedArticles,
      expectedArticles,
    ])
    restored.client.destroy()
  })

  it('keeps a provider creation error visible after an article title changes', async () => {
    const articleId = 'article-provider-unavailable'
    const savedIndex = new Y.Doc()
    const articleEntry = new Y.Map<unknown>()
    articleEntry.set('createdAt', 1_800_000_000_000)
    articleEntry.set('title', 'Untitled article')
    savedIndex.getMap<Y.Map<unknown>>('articles').set(articleId, articleEntry)
    const savedDocuments = new Map<string, Uint8Array>([
      ['article-index', Y.encodeStateAsUpdate(savedIndex)],
    ])
    savedIndex.destroy()
    const { client, providerAttempts } = createFixture(
      savedDocuments,
      new Set([articleId]),
    )
    const startResult = await client.start().match(
      () => 'started',
      (error) => error.message,
    )
    await Promise.resolve()
    const errorBeforeTitleChange = client.getError()?.message ?? null
    client.updateArticleTitle(articleId, 'A revised title')._unsafeUnwrap()

    const readProviderErrorOutput = () => ({
      startResult,
      errorBeforeTitleChange,
      errorAfterTitleChange: client.getError()?.message ?? null,
      failedArticleProviderAttempts: providerAttempts.get(articleId) ?? 0,
      article: client.listArticles(),
    })
    expect(readProviderErrorOutput()).toEqual({
      startResult: 'started',
      errorBeforeTitleChange: 'Failed to initialize document synchronization',
      errorAfterTitleChange: 'Failed to initialize document synchronization',
      failedArticleProviderAttempts: 1,
      article: [
        {
          id: articleId,
          createdAt: 1_800_000_000_000,
          updatedAt: 1_800_000_000_000,
          title: 'A revised title',
        },
      ],
    })
    client.destroy()
  })

  it('keeps a synchronous persistence initialization error visible without retrying', () => {
    const articleId = 'article-persistence-unavailable'
    const { client, persistenceAttempts } = createFixture(
      new Map(),
      new Set(),
      { checkAccessRedirect: () => Promise.resolve('unreachable') },
      new Set([articleId]),
    )
    const firstOpenResult = client.openDocument(articleId).match(
      () => 'opened',
      (error) => error.message,
    )
    const errorAfterFirstOpen = client.getError()?.message ?? null
    const secondOpenResult = client.openDocument(articleId).match(
      () => 'opened',
      (error) => error.message,
    )

    const readInitializationFailureOutput = () => ({
      firstOpenResult,
      errorAfterFirstOpen,
      secondOpenResult,
      errorAfterSecondOpen: client.getError()?.message ?? null,
      persistenceAttempts: persistenceAttempts.get(articleId) ?? 0,
    })
    expect(readInitializationFailureOutput()).toEqual({
      firstOpenResult: 'Failed to initialize document synchronization',
      errorAfterFirstOpen: 'Failed to initialize document synchronization',
      secondOpenResult: 'Failed to initialize document synchronization',
      errorAfterSecondOpen: 'Failed to initialize document synchronization',
      persistenceAttempts: 1,
    })
    client.destroy()
  })

  it('repairs a remote deletion when a move record arrives before the editor opens', async () => {
    const articleId = '018f0000-0000-7000-8000-000000000003'
    const baseline = new Y.Doc()
    baseline.clientID = 71
    const scenarioMarkdown =
      '## Cedar\na1\n## Fjord\nmaple maple\n## Vista\nz9\n'
    setBody(baseline, scenarioMarkdown)

    const offlineEditor = new Y.Doc()
    offlineEditor.clientID = 73
    Y.applyUpdate(offlineEditor, Y.encodeStateAsUpdate(baseline))
    const offlineBody = offlineEditor.getText('body')
    offlineBody.insert(offlineBody.toJSON().indexOf('maple') + 5, 'xy')
    offlineBody.delete(offlineBody.toJSON().lastIndexOf('ple'), 3)

    const mover = new Y.Doc()
    mover.clientID = 72
    Y.applyUpdate(mover, Y.encodeStateAsUpdate(baseline))
    moveBlock(mover, {
      from: scenarioMarkdown.indexOf('## Fjord\n'),
      destination: scenarioMarkdown.length,
    })._unsafeUnwrap()
    const moveUpdate = Y.encodeStateAsUpdate(
      mover,
      Y.encodeStateVector(baseline),
    )

    const savedDocuments = new Map([
      [articleId, Y.encodeStateAsUpdate(offlineEditor)],
    ])
    const { client } = createFixture(savedDocuments)
    await client.start()
    const openedDoc = client.openDocument(articleId)._unsafeUnwrap()
    Y.applyUpdate(openedDoc, moveUpdate, 'remote-move')

    const readMoveOutput = () => ({
      body: readBody(openedDoc),
      acknowledgements: openedDoc.getMap('move-acks').size,
    })
    expect(readMoveOutput()).toEqual({
      body: '## Cedar\na1\nxy## Vista\nz9\n\n## Fjord\nmaple ma\n',
      acknowledgements: 1,
    })

    client.destroy()
    baseline.destroy()
    mover.destroy()
    offlineEditor.destroy()
  })

  it('updates document status across a connection and failed reconnect', async () => {
    const { client, providers } = createFixture()
    await client.start()
    const created = client.createArticle()._unsafeUnwrap()
    const states = [client.getStatus(created.id)]
    await Promise.resolve()
    const provider = providers.find(({ docId }) => docId === created.id)
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
      'unsynced',
      'syncing',
      'synced',
      'unsynced',
      'unsynced',
      'unsynced',
    ])
    client.destroy()
  })

  it('records the last time a document was in sync and notifies only when the minute changes', async () => {
    const { client, providers, setNow } = createFixture()
    const startedAt = 1_800_000_000_000
    await client.start()
    const created = client.createArticle()._unsafeUnwrap()
    await Promise.resolve()
    const provider = providers.find(({ docId }) => docId === created.id)
    const body = client.openDocument(created.id)._unsafeUnwrap().getText('body')
    let notifications = 0
    const readings = [
      { syncedAt: client.getSyncedAt(created.id), notifications },
    ]
    const unsubscribe = client.subscribe(() => {
      notifications += 1
    })
    const read = () => {
      readings.push({ syncedAt: client.getSyncedAt(created.id), notifications })
    }
    const editAt = (time: number) => {
      setNow(time)
      body.insert(0, 'a')
      read()
    }

    setNow(startedAt + 1_000)
    // Records the edit time now so its index write stays out of the count below.
    body.insert(0, 'a')
    provider?.emitStatus('connected')
    provider?.emitSync(true)
    notifications = 0
    read()
    editAt(startedAt + 30_000)
    editAt(startedAt + 60_000)
    unsubscribe()
    provider?.emitConnectionClose()
    editAt(startedAt + 120_000)
    setNow(startedAt + 180_000)
    provider?.emitStatus('connected')
    provider?.emitSync(true)
    read()

    expect(readings).toEqual([
      { syncedAt: undefined, notifications: 0 },
      { syncedAt: startedAt + 1_000, notifications: 0 },
      { syncedAt: startedAt + 30_000, notifications: 0 },
      { syncedAt: startedAt + 60_000, notifications: 1 },
      { syncedAt: startedAt + 60_000, notifications: 1 },
      { syncedAt: startedAt + 180_000, notifications: 1 },
    ])
    client.destroy()
  })

  it('marks a document unsynced when its first connection attempt closes', async () => {
    const { client, providers } = createFixture()
    await client.start()
    const created = client.createArticle()._unsafeUnwrap()
    await Promise.resolve()
    const provider = providers.find(({ docId }) => docId === created.id)
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
      await Promise.resolve()
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
    await Promise.resolve()
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
    await Promise.resolve()
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
    await Promise.resolve()
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
    await Promise.resolve()

    expect(providers.map(({ docId }) => docId)).toEqual([
      'article-index',
      '018f0000-0000-7000-8000-000000000003',
    ])
    client.destroy()
  })

  it('uses a secure websocket URL for an HTTPS page', async () => {
    vi.stubGlobal('window', { location: { href: 'https://example.test/' } })
    const { client, providers } = createFixture()
    await Promise.resolve()

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

  it('does not index an article when its local document cannot be created', () => {
    const id = '018f0000-0000-7000-8000-000000000004'
    const { client, setArticleId } = createFixture(
      new Map(),
      new Set(),
      undefined,
      new Set([id]),
    )
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

  it('reports provider initialization errors after restoring stored articles', async () => {
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
    await Promise.resolve()

    const readStartOutput = () => [
      startResult,
      providers.map(({ docId: room }) => room),
      client.getError()?.message,
    ]

    expect(readStartOutput()).toEqual([
      'started',
      ['article-index'],
      'Failed to initialize document synchronization',
    ])
    client.destroy()
  })
})
