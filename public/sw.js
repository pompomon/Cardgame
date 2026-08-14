const CACHE_VERSION = 'v8'

function normalizeBasePath(value) {
  if (!value || value === '/') {
    return '/'
  }
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

const workerUrl = new URL(self.location.href)
const BASE_PATH = normalizeBasePath(workerUrl.searchParams.get('base') ?? '/')
const BASE_PATH_NO_TRAILING = BASE_PATH === '/' ? '/' : BASE_PATH.slice(0, -1)
const CACHE_NAMESPACE = `cardgame-${encodeURIComponent(BASE_PATH)}-`
const LEGACY_CACHE_NAME = /^cardgame-(?:shell|assets)-v\d+$/
const APP_SHELL_CACHE = `${CACHE_NAMESPACE}shell-${CACHE_VERSION}`
const ASSET_CACHE = `${CACHE_NAMESPACE}assets-${CACHE_VERSION}`
const INDEX_URL = `${BASE_PATH}index.html`
const FALLBACK_URL = `${BASE_PATH}404.html`
const CORE = [BASE_PATH, INDEX_URL, FALLBACK_URL]
const STATIC_FILE_PATHS = new Set([
  '/icons.svg',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/apple-touch-icon.png',
  '/pwa-192.png',
  '/pwa-512.png',
  '/pwa-maskable-512.png',
  '/404.html',
])

function toBaseRelativePath(pathname) {
  if (BASE_PATH === '/') {
    return pathname
  }
  if (pathname === BASE_PATH_NO_TRAILING) {
    return '/'
  }
  if (pathname.startsWith(BASE_PATH)) {
    return `/${pathname.slice(BASE_PATH.length)}`
  }
  return null
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(CORE)),
      self.skipWaiting(),
    ]),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) =>
              (
                key.startsWith(CACHE_NAMESPACE)
                && key !== APP_SHELL_CACHE
                && key !== ASSET_CACHE
              )
              || LEGACY_CACHE_NAME.test(key),
            )
            .map((key) => caches.delete(key)),
        ),
      ),
      self.clients.claim(),
    ]),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) {
    return
  }
  const relativePath = toBaseRelativePath(url.pathname)
  if (relativePath === null) {
    return
  }

  if (event.request.mode === 'navigate') {
    // Only treat the base / index.html navigations as the canonical SPA shell.
    // Other navigations (e.g. ${BASE_PATH}404.html) must not overwrite the
    // cached app shell under INDEX_URL, since 404.html performs a redirect
    // and is not a valid offline fallback document.
    const isIndexNavigation = relativePath === '/' || relativePath === '/index.html'
    let cacheWrite = Promise.resolve()
    const responsePromise = fetch(event.request)
      .then((response) => {
        if (response.ok && isIndexNavigation) {
          const clone = response.clone()
          cacheWrite = caches.open(APP_SHELL_CACHE)
            .then((cache) => cache.put(INDEX_URL, clone))
            .catch(() => {
              // A valid navigation response must still win when storage fails.
            })
        }
        return response
      })
      .catch(async () => {
        const cache = await caches.open(APP_SHELL_CACHE)
        const fallback = await cache.match(INDEX_URL)
        return fallback ?? Response.error()
      })
    event.waitUntil(
      responsePromise.then(() => cacheWrite).catch(() => {
        // Fetch failures are handled by the response fallback above.
      }),
    )
    event.respondWith(
      responsePromise,
    )
    return
  }

  // Public art paths are intentionally unhashed, so they use network-first
  // refresh with cache fallback. Vite's content-hashed /assets/* stay
  // cache-first below.
  const isRuntimeAsset = relativePath.startsWith('/cards/')
    || relativePath.startsWith('/boards/')
    || relativePath.startsWith('/sprites/')
  const isStaticAsset = relativePath.startsWith('/assets/') || STATIC_FILE_PATHS.has(relativePath)
  if (!isStaticAsset && !isRuntimeAsset) {
    return
  }

  if (isRuntimeAsset) {
    const networkResponse = fetch(event.request)
    event.waitUntil(
      networkResponse
        .then((response) => {
          if (!response.ok) {
            return
          }
          return caches.open(ASSET_CACHE).then((cache) => cache.put(event.request, response.clone()))
        })
        .catch(() => {
          // Cache persistence is best-effort. A failed network request falls back
          // through respondWith(), while storage failures are ignored here.
        }),
    )
    event.respondWith(
      networkResponse
        .catch(async () => {
          const cache = await caches.open(ASSET_CACHE)
          const cached = await cache.match(event.request)
          return cached ?? Response.error()
        }),
    )
    return
  }

  let cacheWrite = Promise.resolve()
  const responsePromise = caches.open(ASSET_CACHE).then((cache) =>
    cache.match(event.request),
  ).then(async (cached) => {
      if (cached) {
        return cached
      }
      const response = await fetch(event.request)
      if (response.ok) {
        const clone = response.clone()
        cacheWrite = caches.open(ASSET_CACHE)
          .then((cache) => cache.put(event.request, clone))
          .catch(() => {
            // Return the valid network response even when storage is full.
          })
      }
      return response
    })
  event.waitUntil(
    responsePromise.then(() => cacheWrite).catch(() => {
      // The response promise carries network failures to respondWith().
    }),
  )
  event.respondWith(responsePromise)
})
