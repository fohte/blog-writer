import { err, ok, Result, ResultAsync } from 'neverthrow'
import { v7 } from 'uuid'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'

const ARTICLE_INDEX_DOC_ID = 'article-index'

export type SyncState = 'saved' | 'unsynced' | 'syncing' | 'synced'

export type Article = {
  id: string
  createdAt: number
}

export class SyncClientError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause })
    this.name = 'SyncClientError'
  }
}

interface LocalPersistence {
  synced: boolean
  on(event: 'synced', listener: () => void): void
}

interface WebsocketConnection {
  synced: boolean
  wsconnected: boolean
  wsconnecting: boolean
  onStatus(
    listener: (event: {
      status: 'connected' | 'connecting' | 'disconnected'
    }) => void,
  ): void
  onSync(listener: (isSynced: boolean) => void): void
  destroy(): void
}

export type SyncClientOptions = {
  createDoc: () => Y.Doc
  createPersistence: (docId: string, doc: Y.Doc) => LocalPersistence
  createWebsocketProvider: (
    url: string,
    docId: string,
    doc: Y.Doc,
  ) => WebsocketConnection
  createArticleId: () => string
  now: () => number
}

export interface SyncClientApi {
  readonly indexDoc: Y.Doc
  start(): ResultAsync<void, SyncClientError>
  openDocument(docId: string): Result<Y.Doc, SyncClientError>
  createArticle(): Result<Article, SyncClientError>
  listArticles(): Article[]
  getStatus(docId: string): SyncState | undefined
  subscribe(listener: () => void): () => void
  destroy(): void
}

type SyncDocument = {
  doc: Y.Doc
  persistence: LocalPersistence
  provider: WebsocketConnection
  status: SyncState
  subscribe: (listener: (status: SyncState) => void) => () => void
}

const defaultOptions: SyncClientOptions = {
  createDoc: () => new Y.Doc(),
  createPersistence: (docId, doc) => new IndexeddbPersistence(docId, doc),
  createWebsocketProvider: (url, docId, doc) => {
    const provider = new WebsocketProvider(url, docId, doc)
    return {
      get synced() {
        return provider.synced
      },
      get wsconnected() {
        return provider.wsconnected
      },
      get wsconnecting() {
        return provider.wsconnecting
      },
      onStatus: (listener) => provider.on('status', listener),
      onSync: (listener) => provider.on('sync', listener),
      destroy: () => {
        provider.destroy()
      },
    }
  },
  createArticleId: v7,
  now: Date.now,
}

const toSyncClientError = (cause: unknown) =>
  cause instanceof SyncClientError
    ? cause
    : new SyncClientError(
        'Failed to initialize document synchronization',
        cause,
      )

const createWebsocketUrl = (docId: string) => {
  const pageUrl =
    typeof window === 'undefined' ? 'http://localhost/' : window.location.href
  const url = new URL(`/api/sync/${encodeURIComponent(docId)}`, pageUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

class SyncClient implements SyncClientApi {
  private readonly documents = new Map<string, SyncDocument>()
  private readonly listeners = new Set<() => void>()

  private constructor(
    private readonly options: SyncClientOptions,
    readonly index: SyncDocument,
  ) {
    this.documents.set(ARTICLE_INDEX_DOC_ID, index)
    this.index.doc.on('update', () => {
      this.emitChange()
    })
  }

  get indexDoc() {
    return this.index.doc
  }

  static create(options: SyncClientOptions) {
    return Result.fromThrowable(() => {
      const doc = options.createDoc()
      const local = options.createPersistence(ARTICLE_INDEX_DOC_ID, doc)
      const provider = options.createWebsocketProvider(
        createWebsocketUrl(ARTICLE_INDEX_DOC_ID),
        ARTICLE_INDEX_DOC_ID,
        doc,
      )
      return new SyncClient(options, makeSyncDocument(doc, local, provider))
    }, toSyncClientError)()
  }

  start() {
    return ResultAsync.fromPromise(
      waitForLocalPersistence(this.index.persistence),
      toSyncClientError,
    ).andThen(() => {
      for (const article of this.listArticles()) {
        const result = this.openDocument(article.id)
        if (result.isErr()) return err(result.error)
      }
      return ok(undefined)
    })
  }

  openDocument(docId: string) {
    const existing = this.documents.get(docId)
    if (existing) return ok(existing.doc)

    const result = Result.fromThrowable(() => {
      const doc = this.options.createDoc()
      const local = this.options.createPersistence(docId, doc)
      const provider = this.options.createWebsocketProvider(
        createWebsocketUrl(docId),
        docId,
        doc,
      )
      const document = makeSyncDocument(doc, local, provider)
      document.subscribe(() => {
        this.emitChange()
      })
      this.documents.set(docId, document)
      this.emitChange()
      return doc
    }, toSyncClientError)()

    return result
  }

  createArticle() {
    return Result.fromThrowable(() => {
      const article = {
        id: this.options.createArticleId(),
        createdAt: this.options.now(),
      }
      const entry = new Y.Map<unknown>()
      entry.set('createdAt', article.createdAt)
      this.index.doc.getMap<Y.Map<unknown>>('articles').set(article.id, entry)
      const documentResult = this.openDocument(article.id)
      if (documentResult.isErr()) return err(documentResult.error)
      this.emitChange()
      return ok(article)
    }, toSyncClientError)().andThen((result) => result)
  }

  listArticles(): Article[] {
    return [...this.index.doc.getMap<Y.Map<unknown>>('articles')]
      .map(([id, entry]) => {
        const createdAt = entry.get('createdAt')
        return { id, createdAt: typeof createdAt === 'number' ? createdAt : 0 }
      })
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  }

  getStatus(docId: string) {
    return this.documents.get(docId)?.status
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  destroy() {
    for (const document of this.documents.values()) {
      document.provider.destroy()
      document.doc.destroy()
    }
    this.documents.clear()
    this.listeners.clear()
  }

  private emitChange() {
    for (const listener of this.listeners) listener()
  }
}

const waitForLocalPersistence = (persistence: LocalPersistence) =>
  persistence.synced
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        persistence.on('synced', resolve)
      })

const makeSyncDocument = (
  doc: Y.Doc,
  persistence: LocalPersistence,
  provider: WebsocketConnection,
): SyncDocument => {
  let status: SyncState = 'saved'
  let localReady = persistence.synced
  let connectionStatus: 'connected' | 'connecting' | 'disconnected' =
    provider.wsconnected
      ? 'connected'
      : provider.wsconnecting
        ? 'connecting'
        : 'disconnected'
  let hasConnected = provider.wsconnected
  let isSynced = provider.synced
  const listeners = new Set<(status: SyncState) => void>()

  const setStatus = (next: SyncState) => {
    if (status === next) return
    status = next
    for (const listener of listeners) listener(status)
  }

  const refreshStatus = () => {
    if (!localReady) {
      setStatus('saved')
      return
    }
    if (connectionStatus === 'connecting') {
      setStatus('syncing')
      return
    }
    if (connectionStatus === 'connected') {
      setStatus(isSynced ? 'synced' : 'syncing')
      return
    }
    setStatus(hasConnected ? 'unsynced' : 'saved')
  }

  persistence.on('synced', () => {
    localReady = true
    refreshStatus()
  })
  provider.onStatus(({ status: next }) => {
    connectionStatus = next
    if (next === 'connected') hasConnected = true
    refreshStatus()
  })
  provider.onSync((synced) => {
    isSynced = synced
    refreshStatus()
  })
  return {
    doc,
    persistence,
    provider,
    get status() {
      return status
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export const createSyncClient = (
  options: SyncClientOptions = defaultOptions,
): Result<SyncClientApi, SyncClientError> => SyncClient.create(options)
