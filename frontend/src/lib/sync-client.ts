import { err, ok, Result, ResultAsync } from 'neverthrow'
import { v7 } from 'uuid'
import * as Y from 'yjs'

import {
  buildSyncDocument,
  createLocalPersistence,
  createWebsocketConnection,
  type LocalPersistence,
  type SyncDocument,
  type WebsocketConnection,
} from '#lib/sync-client-document'
import { SyncClientError, toSyncClientError } from '#lib/sync-client-errors'

const ARTICLE_INDEX_DOC_ID = 'article-index'
const DEFAULT_ARTICLE_TITLE = 'Untitled article'

export type SyncState = 'saved' | 'unsynced' | 'syncing' | 'synced'
type AccessCheckResult = 'redirected' | 'reachable' | 'unreachable'

export type Article = {
  id: string
  createdAt: number
  title: string
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
  updateArticleTitle(id: string, title: string): Result<void, SyncClientError>
  listArticles(): Article[]
  getStatus(docId: string): SyncState | undefined
  getError(): SyncClientError | undefined
  requiresAuthentication(): boolean
  subscribe(listener: () => void): () => void
  destroy(): void
}

const defaultOptions: SyncClientOptions = {
  createDoc: () => new Y.Doc(),
  createPersistence: createLocalPersistence,
  createWebsocketProvider: createWebsocketConnection,
  createArticleId: v7,
  now: Date.now,
}

const checkAccessRedirect = () => {
  const pageUrl =
    typeof window === 'undefined' ? 'http://localhost/' : window.location.href
  return ResultAsync.fromPromise(
    fetch(new URL('/', pageUrl), { cache: 'no-store', redirect: 'manual' }),
    toSyncClientError,
  ).match(
    (response) =>
      response.type === 'opaqueredirect' ? 'redirected' : 'reachable',
    () => 'unreachable',
  )
}

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
      if (result.isErr()) this.syncError = result.error
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
      Promise.resolve(),
      toSyncClientError,
    ).andThen(() => {
      if (this.destroyed) return err(this.destroyedError())
      this.started = true
      const result = this.openIndexedArticles()
      if (result.isErr()) this.syncError = result.error
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
        title: DEFAULT_ARTICLE_TITLE,
      }),
      toSyncClientError,
    )().andThen((article) =>
      this.openDocument(article.id).andThen(() =>
        Result.fromThrowable(() => {
          const entry = new Y.Map<unknown>()
          entry.set('createdAt', article.createdAt)
          entry.set('title', article.title)
          this.index.doc
            .getMap<Y.Map<unknown>>('articles')
            .set(article.id, entry)
          this.emitChange()
          return article
        }, toSyncClientError)(),
      ),
    )
  }

  updateArticleTitle(id: string, title: string) {
    const entry = this.index.doc.getMap<Y.Map<unknown>>('articles').get(id)
    if (!entry)
      return err(new SyncClientError('Article not found', new Error(id)))
    return Result.fromThrowable(() => {
      entry.set('title', title)
    }, toSyncClientError)()
  }

  listArticles(): Article[] {
    return [...this.index.doc.getMap<Y.Map<unknown>>('articles')]
      .map(([id, entry]) => {
        const createdAt = entry.get('createdAt')
        const title = entry.get('title')
        return {
          id,
          createdAt: typeof createdAt === 'number' ? createdAt : 0,
          title: typeof title === 'string' ? title : DEFAULT_ARTICLE_TITLE,
        }
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
      document.destroy()
    }
    this.documents.clear()
    this.listeners.clear()
  }

  private emitChange() {
    for (const listener of this.listeners) listener()
  }

  private subscribeToDocument(document: SyncDocument) {
    document.subscribe((event, error) => {
      if (event === 'error') {
        this.syncError = error
        this.emitChange()
        return
      }

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
          this.accessRequired = result === 'redirected'
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

export const createSyncClient = (
  options: SyncClientOptions = defaultOptions,
): Result<SyncClientApi, SyncClientError> => SyncClient.create(options)
