import '#index.css'

import { ResultAsync } from 'neverthrow'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '#App'

const runBestEffort = (operation: Promise<unknown>, message: string) => {
  void ResultAsync.fromPromise(
    operation,
    (cause) => new Error(message, { cause }),
  ).match(
    () => undefined,
    (error) => {
      console.warn(error)
    },
  )
}

const requestPersistentStorage = () => {
  if (
    !('storage' in navigator) ||
    typeof navigator.storage.persist !== 'function'
  ) {
    return
  }

  runBestEffort(
    navigator.storage.persist(),
    'Failed to request persistent storage',
  )
}

const registerServiceWorker = () => {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

  runBestEffort(
    navigator.serviceWorker.register('/sw.js'),
    'Failed to register the service worker',
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
