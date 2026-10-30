import { err, ok, Result, ResultAsync } from 'neverthrow'
import { v7 } from 'uuid'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'

const ARTICLE_INDEX_DOC_ID = 'article-index'

export type SyncState = 'saved' | 'unsynced' | 'syncing' | 'synced'
type AccessCheckResult = 'redirected' | 'reachable' | 'unreachable'

export type Article = {
  id: string
  createdAt: number
}

class SyncClientError extends Error {
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
  onConnectionClose(listener: () => void): void
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
  checkAccessRedirect?: () => Promise<AccessCheckResult>
}

export interface SyncClientApi {
  start(): ResultAsync<void, SyncClientError>
  openDocument(docId: string): Result<Y.Doc, SyncClientError>
  createArticle(): Result<Article, SyncClientError>
  listArticles(): Article[]
  getStatus(docId: string): SyncState | undefined
  getError(): SyncClientError | undefined
  requiresAuthentication(): boolean
  subscribe(listener: () => void): () => void
  destroy(): void
}

type SyncDocument = {
  doc: Y.Doc
  persistence: LocalPersistence
  provider: WebsocketConnection
  status: SyncState
  subscribe: (listener: (event: SyncDocumentEvent) => void) => () => void
}

type SyncDocumentEvent = 'status' | 'connection-close' | 'connected'

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
      onConnectionClose: (listener) =>
        provider.on('connection-close', listener),
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

const createWebsocketUrl = () => {
  const pageUrl =
    typeof window === 'undefined' ? 'http://localhost/' : window.location.href
  const url = new URL('/api/sync', pageUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

const checkAccessRedirect = () => {
  const pageUrl =
    typeof window === 'undefined' ? 'http://localhost/' : window.location.href
  return ResultAsync.fromPromise(
    fetch(new URL('/', pageUrl), { cache: 'no-store', redirect: 'manual' }),
    toSyncClientError,
  ).match(
    (response) =>
      response.type === 'opaqueredirect' ||
      response.redirected ||
      (response.status >= 300 && response.status < 400)
        ? 'redirected'
        : 'reachable',
    () => 'unreachable',
  )
}

const buildSyncDocument = (options: SyncClientOptions, docId: string) =>
  Result.fromThrowable(() => options.createDoc(), toSyncClientError)().andThen(
    (doc) => {
      const persistenceResult = Result.fromThrowable(
        () => options.createPersistence(docId, doc),
        toSyncClientError,
      )()
      if (persistenceResult.isErr()) {
        doc.destroy()
        return err(persistenceResult.error)
      }

      const providerResult = Result.fromThrowable(
        () => options.createWebsocketProvider(createWebsocketUrl(), docId, doc),
        toSyncClientError,
      )()
      if (providerResult.isErr()) {
        doc.destroy()
        return err(providerResult.error)
      }

      return Result.fromThrowable(
        () =>
          makeSyncDocument(doc, persistenceResult.value, providerResult.value),
        toSyncClientError,
      )().mapErr((error) => {
        providerResult.value.destroy()
        doc.destroy()
        return error
      })
    },
  )

class SyncClient implements SyncClientApi {
  private readonly documents = new Map<string, SyncDocument>()
  private readonly listeners = new Set<() => void>()
  private started = false
  private destroyed = false
  private syncError: SyncClientError | undefined
  private accessRequired = false
  private connectionEpoch = 0
  private authenticationCheckEpoch: number | undefined

  private constructor(
    private readonly options: SyncClientOptions,
    private readonly index: SyncDocument,
  ) {
    this.documents.set(ARTICLE_INDEX_DOC_ID, index)
    this.subscribeToDocument(index)
    this.index.doc.on('update', () => {
      this.emitChange()
      if (!this.started || this.destroyed) return
      const result = this.openIndexedArticles()
      this.syncError = result.isErr() ? result.error : undefined
      this.emitChange()
    })
  }

  static create(options: SyncClientOptions) {
    return buildSyncDocument(options, ARTICLE_INDEX_DOC_ID).andThen((index) =>
      Result.fromThrowable(
        () => new SyncClient(options, index),
        toSyncClientError,
      )(),
    )
  }

  start() {
    return ResultAsync.fromPromise(
      waitForLocalPersistence(this.index.persistence),
      toSyncClientError,
    ).andThen(() => {
      if (this.destroyed) return err(this.destroyedError())
      this.started = true
      const result = this.openIndexedArticles()
      this.syncError = result.isErr() ? result.error : undefined
      this.emitChange()
      return result
    })
  }

  openDocument(docId: string) {
    if (this.destroyed) return err(this.destroyedError())

    const existing = this.documents.get(docId)
    if (existing) return ok(existing.doc)

    return buildSyncDocument(this.options, docId).andThen((document) =>
      Result.fromThrowable(() => {
        this.subscribeToDocument(document)
        this.documents.set(docId, document)
        this.emitChange()
        return document.doc
      }, toSyncClientError)(),
    )
  }

  createArticle() {
    return Result.fromThrowable(
      () => ({
        id: this.options.createArticleId(),
        createdAt: this.options.now(),
      }),
      toSyncClientError,
    )().andThen((article) =>
      this.openDocument(article.id).andThen(() =>
        Result.fromThrowable(() => {
          const entry = new Y.Map<unknown>()
          entry.set('createdAt', article.createdAt)
          this.index.doc
            .getMap<Y.Map<unknown>>('articles')
            .set(article.id, entry)
          this.emitChange()
          return article
        }, toSyncClientError)(),
      ),
    )
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

  getError() {
    return this.syncError
  }

  requiresAuthentication() {
    return this.accessRequired
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
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

  private subscribeToDocument(document: SyncDocument) {
    document.subscribe((event) => {
      if (event === 'connection-close') {
        this.emitChange()
        this.checkAuthentication()
        return
      }

      if (event === 'connected') {
        this.connectionEpoch += 1
        this.accessRequired = false
      }

      this.emitChange()
    })
  }

  private checkAuthentication() {
    if (this.authenticationCheckEpoch === this.connectionEpoch) return
    const currentEpoch = this.connectionEpoch
    const check = this.options.checkAccessRedirect ?? checkAccessRedirect
    this.authenticationCheckEpoch = currentEpoch
    void ResultAsync.fromPromise(
      Promise.resolve().then(check),
      toSyncClientError,
    )
      .match(
        (result) => {
          if (this.destroyed || currentEpoch !== this.connectionEpoch) return
          if (result === 'redirected') this.accessRequired = true
          if (result === 'reachable') this.accessRequired = false
          this.emitChange()
        },
        () => undefined,
      )
      .finally(() => {
        if (this.authenticationCheckEpoch === currentEpoch) {
          this.authenticationCheckEpoch = undefined
        }
      })
  }

  private openIndexedArticles() {
    let firstError: SyncClientError | undefined
    for (const article of this.listArticles()) {
      const result = this.openDocument(article.id)
      if (result.isErr() && firstError === undefined) firstError = result.error
    }
    return firstError === undefined ? ok(undefined) : err(firstError)
  }

  private destroyedError() {
    return new SyncClientError(
      'The sync client has been destroyed',
      new Error('The sync client has been destroyed'),
    )
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
  let isSynced = provider.synced
  let connectionHasFailed = false
  const listeners = new Set<(event: SyncDocumentEvent) => void>()

  const emit = (event: SyncDocumentEvent) => {
    for (const listener of listeners) listener(event)
  }

  const setStatus = (next: SyncState) => {
    if (status === next) return
    status = next
    emit('status')
  }

  const refreshStatus = () => {
    if (!localReady) {
      setStatus('saved')
      return
    }
    if (connectionStatus === 'connecting') {
      setStatus(connectionHasFailed ? 'unsynced' : 'syncing')
      return
    }
    if (connectionStatus === 'connected') {
      setStatus(isSynced ? 'synced' : 'syncing')
      return
    }
    setStatus('unsynced')
  }

  persistence.on('synced', () => {
    localReady = true
    refreshStatus()
  })
  provider.onStatus(({ status: next }) => {
    connectionStatus = next
    if (next === 'connected') emit('connected')
    refreshStatus()
  })
  provider.onConnectionClose(() => {
    connectionStatus = 'disconnected'
    connectionHasFailed = true
    refreshStatus()
    emit('connection-close')
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
