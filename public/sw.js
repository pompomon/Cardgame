const CACHE_VERSION = 'v10'
const RUNTIME_ASSET_VERSION = 'v2'
const MANAGED_CACHE_PREFIXES = [
  'cardgame-shell-',
  'cardgame-build-assets-',
  'cardgame-runtime-assets-',
  'cardgame-assets-',
]

function normalizeBasePath(value) {
  if (!value || value === '/') {
    return '/'
  }
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

const workerUrl = new URL(self.location.href)
const requestedBuildId = workerUrl.searchParams.get('build') ?? ''
const BUILD_ID = /^[A-Za-z0-9._-]{1,128}$/.test(requestedBuildId) ? requestedBuildId : 'legacy'
const BUILD_CACHE_VERSION = `${CACHE_VERSION}-${BUILD_ID}`
const APP_SHELL_CACHE = `cardgame-shell-${BUILD_CACHE_VERSION}`
const BUILD_ASSET_CACHE = `cardgame-build-assets-${BUILD_CACHE_VERSION}`
const RUNTIME_ASSET_CACHE = `cardgame-runtime-assets-${RUNTIME_ASSET_VERSION}`
const LEGACY_RUNTIME_ASSET_CACHES = new Map([
  ['cardgame-runtime-assets-v1', '/boards/'],
])
const BASE_PATH = normalizeBasePath(workerUrl.searchParams.get('base') ?? '/')
const BASE_PATH_NO_TRAILING = BASE_PATH === '/' ? '/' : BASE_PATH.slice(0, -1)
const INDEX_URL = `${BASE_PATH}index.html`
const FALLBACK_URL = `${BASE_PATH}404.html`
const ASSET_MANIFEST_URL = `${BASE_PATH}asset-manifest.json`
const MAX_MANIFEST_ENTRIES = 1000
const MAX_MANIFEST_ASSETS = 5000
const MAX_MIGRATION_CACHE_ENTRIES = 10000
const REQUIRED_MANIFEST_ENTRIES = ['index.html', 'src/renderers/three/index.ts']
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
const CORE = [
  BASE_PATH,
  INDEX_URL,
  ...[...STATIC_FILE_PATHS].map((path) => `${BASE_PATH}${path.slice(1)}`),
]

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

function assetPathsFromManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid asset manifest')
  }
  if (!REQUIRED_MANIFEST_ENTRIES.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error('Asset manifest is incomplete')
  }
  const entries = Object.values(value)
  if (entries.length > MAX_MANIFEST_ENTRIES) {
    throw new Error('Asset manifest is too large')
  }
  const paths = new Set()
  const addPath = (path) => {
    if (typeof path !== 'string' || path.length > 512
      || !/^assets\/[A-Za-z0-9._/-]+$/.test(path) || path.includes('..')) {
      throw new Error('Invalid asset path')
    }
    paths.add(`${BASE_PATH}${path}`)
    if (paths.size > MAX_MANIFEST_ASSETS) {
      throw new Error('Asset manifest contains too many files')
    }
  }
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Invalid asset manifest entry')
    }
    addPath(entry.file)
    for (const field of ['css', 'assets']) {
      if (entry[field] === undefined) continue
      if (!Array.isArray(entry[field])) {
        throw new Error('Invalid asset manifest entry')
      }
      for (const path of entry[field]) addPath(path)
    }
  }
  const indexEntry = value['index.html']
  return {
    all: [...paths],
    index: [
      indexEntry.file,
      ...(indexEntry.css ?? []),
      ...(indexEntry.assets ?? []),
    ].map((path) => `${BASE_PATH}${path}`),
  }
}

function isRuntimeAssetPath(path) {
  return path.startsWith('/cards/') || path.startsWith('/boards/')
}

async function migrateRuntimeAssets(targetCache) {
  const sourceNames = (await caches.keys())
    .filter((name) => LEGACY_RUNTIME_ASSET_CACHES.has(name))
    .reverse()
  let scannedEntries = 0
  for (const sourceName of sourceNames) {
    const sourceCache = await caches.open(sourceName)
    const compatiblePathPrefix = LEGACY_RUNTIME_ASSET_CACHES.get(sourceName)
    for (const request of await sourceCache.keys()) {
      scannedEntries++
      if (scannedEntries > MAX_MIGRATION_CACHE_ENTRIES) {
        throw new Error('Previous asset caches contain too many entries')
      }
      const url = new URL(request.url)
      const relativePath = url.origin === self.location.origin
        ? toBaseRelativePath(url.pathname)
        : null
      if (!relativePath || !relativePath.startsWith(compatiblePathPrefix)) continue
      if (!await targetCache.match(request)) {
        const response = await sourceCache.match(request)
        if (!response) continue
        await targetCache.put(request, response)
      }
    }
  }
}

function validateIndexAssets(html, manifestAssets) {
  const allAssets = new Set(manifestAssets.all)
  for (const expected of manifestAssets.index) {
    if (!html.includes(expected)) {
      throw new Error('Index shell does not match asset manifest')
    }
  }
  const attributePattern = /\b(?:src|href)=["']([^"']+)["']/g
  for (const match of html.matchAll(attributePattern)) {
    const url = new URL(match[1], `${self.location.origin}${INDEX_URL}`)
    const relativePath = url.origin === self.location.origin
      ? toBaseRelativePath(url.pathname)
      : null
    if (relativePath?.startsWith('/assets/') && !allAssets.has(url.pathname)) {
      throw new Error('Index shell references an unknown build asset')
    }
  }
}

async function fetchFresh(path) {
  const response = await fetch(path, { cache: 'reload' })
  if (!response.ok) {
    throw new Error(`Shell resource unavailable: ${path}`)
  }
  return response
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const manifestResponse = await fetch(ASSET_MANIFEST_URL, { cache: 'no-store' })
      if (!manifestResponse.ok) {
        throw new Error('Asset manifest unavailable')
      }
      const manifestAssets = assetPathsFromManifest(await manifestResponse.json())
      const coreResponses = await Promise.all(CORE.map(fetchFresh))
      const indexResponse = coreResponses[CORE.indexOf(INDEX_URL)]
      validateIndexAssets(await indexResponse.clone().text(), manifestAssets)
      const shellCache = await caches.open(APP_SHELL_CACHE)
      const buildAssetCache = await caches.open(BUILD_ASSET_CACHE)
      const runtimeAssetCache = await caches.open(RUNTIME_ASSET_CACHE)
      await Promise.all([
        Promise.all(coreResponses.map((response, index) => shellCache.put(CORE[index], response))),
        buildAssetCache.addAll(manifestAssets.all),
      ])
      await migrateRuntimeAssets(runtimeAssetCache)
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => MANAGED_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)))
          .filter((key) =>
            key !== APP_SHELL_CACHE
            && key !== BUILD_ASSET_CACHE
            && key !== RUNTIME_ASSET_CACHE)
          .map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
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
    // Only installation may replace INDEX_URL after validating it against the
    // manifest. Caching navigation HTML here could pair a new shell with this
    // worker's older build assets if the next worker fails to install.
    event.respondWith(
      fetch(event.request)
        .catch(async () => {
          const fallback = await caches.match(INDEX_URL)
          return fallback ?? Response.error()
        }),
    )
    return
  }

  // Public art paths are intentionally unhashed, so they use network-first
  // refresh with cache fallback. Vite's content-hashed /assets/* stay
  // cache-first below.
  const isRuntimeAsset = isRuntimeAssetPath(relativePath)
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
          return caches.open(RUNTIME_ASSET_CACHE).then((cache) => cache.put(event.request, response.clone()))
        })
        .catch(() => {
          // Cache persistence is best-effort. A failed network request falls back
          // through respondWith(), while storage failures are ignored here.
        }),
    )
    event.respondWith(
      networkResponse
        .catch(async () => {
          const cached = await caches.match(event.request)
          return cached ?? Response.error()
        }),
    )
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
        void caches.open(BUILD_ASSET_CACHE).then((cache) => cache.put(event.request, clone))
      }
      return response
    }),
  )
})
