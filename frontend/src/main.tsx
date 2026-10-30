import '#index.css'

import { ResultAsync } from 'neverthrow'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '#App'

const requestPersistentStorage = () => {
  if (
    !('storage' in navigator) ||
    typeof navigator.storage.persist !== 'function'
  ) {
    return
  }

  void ResultAsync.fromPromise(
    navigator.storage.persist(),
    (cause) => new Error('Failed to request persistent storage', { cause }),
  ).match(
    () => undefined,
    () => undefined,
  )
}

const registerServiceWorker = () => {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

  void ResultAsync.fromPromise(
    navigator.serviceWorker.register('/sw.js'),
    (cause) => new Error('Failed to register the service worker', { cause }),
  ).match(
    () => undefined,
    () => undefined,
  )
}

requestPersistentStorage()
registerServiceWorker()

const rootElement = document.getElementById('root')

if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
