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
const STATIC_FILE_PATHS = new Set(['/icons.svg', '/favicon.svg', '/sw.js'])

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
  const relativePath = toBaseRelativePath(url.pathname)
  if (relativePath === null) {
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

  const isStaticAsset = relativePath.startsWith('/assets/') || STATIC_FILE_PATHS.has(relativePath)
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
