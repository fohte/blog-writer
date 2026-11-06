import { err, ok, Result } from 'neverthrow'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'

import { observeMoveConflicts } from '#article/move-conflicts'
import type { SyncClientOptions } from '#lib/sync-client'
import { SyncClientError, toSyncClientError } from '#lib/sync-client-errors'

const ARTICLE_INDEX_DOC_ID = 'article-index'

export interface LocalPersistence {
  synced: boolean
  on(event: 'synced', listener: () => void): void
}

export interface WebsocketConnection {
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

type SyncDocumentEvent = 'status' | 'connection-close' | 'connected' | 'error'

export type SyncDocument = {
  doc: Y.Doc
  persistence: LocalPersistence
  status: SyncState
  connectProvider: () => Result<void, SyncClientError>
  notifyError: (error: SyncClientError) => void
  destroy: () => void
  subscribe: (
    listener: (event: SyncDocumentEvent, error?: SyncClientError) => void,
  ) => () => void
}

type SyncState = 'saved' | 'unsynced' | 'syncing' | 'synced'

const createWebsocketUrl = () => {
  const pageUrl =
    typeof window === 'undefined' ? 'http://localhost/' : window.location.href
  const url = new URL('/api/sync', pageUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export const createLocalPersistence = (docId: string, doc: Y.Doc) =>
  new IndexeddbPersistence(docId, doc)

export const createWebsocketConnection = (
  url: string,
  docId: string,
  doc: Y.Doc,
): WebsocketConnection => {
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
    onConnectionClose: (listener) => provider.on('connection-close', listener),
    onStatus: (listener) => provider.on('status', listener),
    onSync: (listener) => provider.on('sync', listener),
    destroy: () => {
      provider.destroy()
    },
  }
}

export const buildSyncDocument = (options: SyncClientOptions, docId: string) =>
  Result.fromThrowable(() => options.createDoc(), toSyncClientError)().andThen(
    (doc) => {
      const observerResult = Result.fromThrowable(
        () =>
          docId === ARTICLE_INDEX_DOC_ID ? () => {} : observeMoveConflicts(doc),
        toSyncClientError,
      )()
      if (observerResult.isErr()) {
        doc.destroy()
        return err(observerResult.error)
      }
      const stopObservingMoveConflicts = observerResult.value

      const persistenceResult = Result.fromThrowable(
        () => options.createPersistence(docId, doc),
        toSyncClientError,
      )()
      if (persistenceResult.isErr()) {
        stopObservingMoveConflicts()
        doc.destroy()
        return err(persistenceResult.error)
      }

      const documentResult = Result.fromThrowable(
        () =>
          makeSyncDocument(
            doc,
            persistenceResult.value,
            () =>
              options.createWebsocketProvider(createWebsocketUrl(), docId, doc),
            stopObservingMoveConflicts,
          ),
        toSyncClientError,
      )()
      if (documentResult.isErr()) {
        stopObservingMoveConflicts()
        doc.destroy()
        return err(documentResult.error)
      }
      const document = documentResult.value
      if (persistenceResult.value.synced) {
        const providerResult = document.connectProvider()
        if (providerResult.isErr()) {
          document.destroy()
          return err(providerResult.error)
        }
      } else {
        persistenceResult.value.on('synced', () => {
          document.connectProvider().match(
            () => undefined,
            (error) => {
              document.notifyError(error)
            },
          )
        })
      }
      return ok(document)
    },
  )

export const waitForLocalPersistence = (persistence: LocalPersistence) =>
  persistence.synced
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        persistence.on('synced', resolve)
      })

const makeSyncDocument = (
  doc: Y.Doc,
  persistence: LocalPersistence,
  createProvider: () => WebsocketConnection,
  stopObservingMoveConflicts: () => void,
): SyncDocument => {
  let status: SyncState = 'saved'
  let localReady = persistence.synced
  let provider: WebsocketConnection | undefined
  let connectionStatus: 'connected' | 'connecting' | 'disconnected' =
    'disconnected'
  let isSynced = false
  let connectionHasFailed = false
  let destroyed = false
  const listeners = new Set<
    (event: SyncDocumentEvent, error?: SyncClientError) => void
  >()

  const emit = (event: SyncDocumentEvent, error?: SyncClientError) => {
    for (const listener of listeners) listener(event, error)
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

  return {
    doc,
    persistence,
    get status() {
      return status
    },
    connectProvider() {
      if (destroyed || provider) return ok(undefined)
      return Result.fromThrowable(createProvider, toSyncClientError)().andThen(
        (nextProvider) =>
          Result.fromThrowable(() => {
            provider = nextProvider
            connectionStatus = nextProvider.wsconnected
              ? 'connected'
              : nextProvider.wsconnecting
                ? 'connecting'
                : 'disconnected'
            isSynced = nextProvider.synced
            nextProvider.onStatus(({ status: next }) => {
              connectionStatus = next
              if (next === 'connected') emit('connected')
              refreshStatus()
            })
            nextProvider.onConnectionClose(() => {
              connectionStatus = 'disconnected'
              connectionHasFailed = true
              refreshStatus()
              emit('connection-close')
            })
            nextProvider.onSync((synced) => {
              isSynced = synced
              refreshStatus()
            })
            refreshStatus()
          }, toSyncClientError)().mapErr((error) => {
            nextProvider.destroy()
            return error
          }),
      )
    },
    notifyError(error) {
      emit('error', error)
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      provider?.destroy()
      stopObservingMoveConflicts()
      doc.destroy()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
