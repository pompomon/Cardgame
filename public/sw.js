const CACHE_VERSION = 'v3'
const APP_SHELL_CACHE = `cardgame-shell-${CACHE_VERSION}`
const ASSET_CACHE = `cardgame-assets-${CACHE_VERSION}`

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
const INDEX_URL = `${BASE_PATH}index.html`
const CORE = [BASE_PATH, INDEX_URL]
const STATIC_DIR_PREFIXES = [`${BASE_PATH}assets/`]
const STATIC_FILE_PATHS = new Set([`${BASE_PATH}icons.svg`, `${BASE_PATH}favicon.svg`, `${BASE_PATH}sw.js`])

function isWithinBasePath(pathname) {
  if (BASE_PATH === '/') {
    return true
  }
  return pathname === BASE_PATH_NO_TRAILING || pathname.startsWith(BASE_PATH)
}

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
  if (!isWithinBasePath(url.pathname)) {
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone()
            void caches.open(APP_SHELL_CACHE).then((cache) => cache.put(INDEX_URL, clone))
          }
          return response
        })
        .catch(async () => {
          const fallback = await caches.match(INDEX_URL)
          return fallback ?? Response.error()
        }),
    )
    return
  }

  const isStaticAsset =
    STATIC_DIR_PREFIXES.some((path) => url.pathname.startsWith(path)) || STATIC_FILE_PATHS.has(url.pathname)
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
