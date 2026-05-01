const APP_SHELL_CACHE = 'cardgame-shell-v2'
const ASSET_CACHE = 'cardgame-assets-v2'
const CORE = ['/', '/index.html']
const STATIC_PATHS = ['/assets/', '/icons.svg', '/favicon.svg', '/sw.js']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(CORE)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== APP_SHELL_CACHE && key !== ASSET_CACHE)
          .map((key) => caches.delete(key)),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) {
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone()
            void caches.open(APP_SHELL_CACHE).then((cache) => cache.put('/index.html', clone))
          }
          return response
        })
        .catch(async () => {
          const fallback = await caches.match('/index.html')
          return fallback ?? Response.error()
        }),
    )
    return
  }

  const isStaticAsset = STATIC_PATHS.some((path) => url.pathname.includes(path))
  if (!isStaticAsset) {
    return
  }

  event.respondWith(
    caches.match(event.request).then(async (cached) => {
      if (cached) {
        return cached
      }
      const response = await fetch(event.request)
      if (response.ok) {
        const clone = response.clone()
        void caches.open(ASSET_CACHE).then((cache) => cache.put(event.request, clone))
      }
      return response
    }),
  )
})
