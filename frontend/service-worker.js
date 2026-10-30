/* global caches, fetch, self -- This file runs in the service worker global scope. */

const CACHE_NAME = '__CACHE_NAME__'
const PRECACHE_URLS = '__PRECACHE_URLS__'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter(
              (cacheName) =>
                cacheName.startsWith('blog-writer-app-shell-') &&
                cacheName !== CACHE_NAME,
            )
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response.ok || response.redirected) return response
          return caches
            .open(CACHE_NAME)
            .then((cache) =>
              cache.put('/index.html', response.clone()).then(() => response),
            )
        })
        .catch(() => caches.match('/index.html')),
    )
    return
  }

  if (
    !url.pathname.startsWith('/assets/') &&
    !url.pathname.startsWith('/icons/') &&
    url.pathname !== '/manifest.webmanifest' &&
    url.pathname !== '/apple-touch-icon.png'
  ) {
    return
  }

  event.respondWith(fetch(request).catch(() => caches.match(request)))
})
