import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const REPO_ROOT = resolve(__dirname, '..', '..')
const SERVICE_WORKER_PATH = resolve(REPO_ROOT, 'public/sw.js')
const ORIGIN = 'https://example.test'
const BASE_PATH = '/Cardgame/'

type FetchListener = (event: FetchEventStub) => void
type LifecycleListener = (event: LifecycleEventStub) => void

type LifecycleEventStub = {
  waitUntil: (promise: Promise<unknown>) => void
}

type FetchEventStub = {
  request: Request
  respondWith: (response: Promise<Response>) => void
  waitUntil: (promise: Promise<unknown>) => void
}

type CachePutCall = {
  key: Request | string
  response: Response
}

type ServiceWorkerHarness = {
  cachePutCalls: CachePutCall[]
  cachedResponses: Map<string, Response>
  cachesMatch: ReturnType<typeof vi.fn>
  cachePut: ReturnType<typeof vi.fn>
  fetchListener: FetchListener
  fetchMock: ReturnType<typeof vi.fn>
  waitUntilPromises: Promise<unknown>[]
}

type LifecycleHarness = {
  activateListener: LifecycleListener
  cacheAddAll: ReturnType<typeof vi.fn>
  cacheAddAllCalls: Array<{ cacheName: string; paths: string[] }>
  cacheEntries: Map<string, Map<string, Response>>
  cachesDelete: ReturnType<typeof vi.fn>
  cachesOpen: ReturnType<typeof vi.fn>
  fetchMock: ReturnType<typeof vi.fn>
  installListener: LifecycleListener
  skipWaiting: ReturnType<typeof vi.fn>
}

function cacheKey(key: Request | string): string {
  return typeof key === 'string' ? key : key.url
}

function makeRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, init)
}

function makeNavigationRequest(path: string): Request {
  const request = makeRequest(path)
  Object.defineProperty(request, 'mode', { value: 'navigate' })
  return request
}

function makeResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, ...init })
}

function expectSingleCachePut(
  harness: ServiceWorkerHarness,
  request: Request,
  response: Response,
): void {
  expect(harness.cachePut).toHaveBeenCalledTimes(1)
  expect(harness.cachePutCalls).toHaveLength(1)
  const [{ key, response: cachedResponse }] = harness.cachePutCalls
  expect(key).toBe(request)
  expect(cacheKey(key)).toBe(request.url)
  expect(cachedResponse).toBe(response)
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function loadServiceWorker(): ServiceWorkerHarness {
  const listeners = new Map<string, EventListener>()
  const cachedResponses = new Map<string, Response>()
  const cachePutCalls: CachePutCall[] = []
  const waitUntilPromises: Promise<unknown>[] = []
  const cachePut = vi.fn(async (key: Request | string, response: Response) => {
    cachePutCalls.push({ key, response })
  })
  const cache = {
    addAll: vi.fn(async () => undefined),
    put: cachePut,
  }
  const cachesOpen = vi.fn(async () => cache)
  const cachesMatch = vi.fn(async (key: Request | string) => cachedResponses.get(cacheKey(key)))
  const caches = {
    delete: vi.fn(async () => true),
    keys: vi.fn(async () => []),
    match: cachesMatch,
    open: cachesOpen,
  }
  const self = {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, listener)
    }),
    clients: { claim: vi.fn() },
    location: new URL(`${ORIGIN}${BASE_PATH}sw.js?base=${BASE_PATH}&build=index-build123.js`),
    skipWaiting: vi.fn(),
  }
  const fetchMock = vi.fn()
  const source = readFileSync(SERVICE_WORKER_PATH, 'utf8')

  new Function('self', 'caches', 'fetch', 'Response', 'URL', source)(
    self,
    caches,
    fetchMock,
    Response,
    URL,
  )

  const fetchListener = listeners.get('fetch')
  expect(fetchListener, 'expected service worker to register a fetch listener').toBeDefined()

  return {
    cachePut,
    cachePutCalls,
    cachedResponses,
    cachesMatch,
    fetchListener: fetchListener as unknown as FetchListener,
    fetchMock,
    waitUntilPromises,
  }
}

function loadServiceWorkerLifecycle(
  cacheKeys: string[] = [],
  seededEntries: Record<string, Array<[string, Response]>> = {},
): LifecycleHarness {
  const listeners = new Map<string, EventListener>()
  const cacheEntries = new Map(
    Object.entries(seededEntries).map(([name, entries]) => [name, new Map(entries)]),
  )
  const cacheAddAllCalls: Array<{ cacheName: string; paths: string[] }> = []
  const cacheAddAll = vi.fn(async (cacheName: string, paths: string[]) => {
    cacheAddAllCalls.push({ cacheName, paths: [...paths] })
  })
  const cachesOpen = vi.fn(async (cacheName: string) => {
    const entries = cacheEntries.get(cacheName) ?? new Map<string, Response>()
    cacheEntries.set(cacheName, entries)
    return {
      addAll: (paths: string[]) => cacheAddAll(cacheName, paths),
      delete: async (key: Request | string) => entries.delete(cacheKey(key)),
      keys: async () => [...entries.keys()].map((url) => new Request(url)),
      match: async (key: Request | string) => entries.get(cacheKey(key)),
      put: async (key: Request | string, response: Response) => {
        entries.set(cacheKey(key), response)
      },
    }
  })
  const cachesDelete = vi.fn(async (cacheName: string) => cacheEntries.delete(cacheName))
  const caches = {
    delete: cachesDelete,
    keys: vi.fn(async () => [...new Set([...cacheKeys, ...cacheEntries.keys()])]),
    match: vi.fn(),
    open: cachesOpen,
  }
  const skipWaiting = vi.fn(async () => undefined)
  const self = {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, listener)
    }),
    clients: { claim: vi.fn() },
    location: new URL(`${ORIGIN}${BASE_PATH}sw.js?base=${BASE_PATH}&build=index-build123.js`),
    skipWaiting,
  }
  const fetchMock = vi.fn()
  const source = readFileSync(SERVICE_WORKER_PATH, 'utf8')

  new Function('self', 'caches', 'fetch', 'Response', 'URL', source)(
    self,
    caches,
    fetchMock,
    Response,
    URL,
  )

  const installListener = listeners.get('install')
  const activateListener = listeners.get('activate')
  expect(installListener, 'expected service worker to register an install listener').toBeDefined()
  expect(activateListener, 'expected service worker to register an activate listener').toBeDefined()
  return {
    activateListener: activateListener as unknown as LifecycleListener,
    cacheAddAll,
    cacheAddAllCalls,
    cacheEntries,
    cachesDelete,
    cachesOpen,
    fetchMock,
    installListener: installListener as unknown as LifecycleListener,
    skipWaiting,
  }
}

function dispatchLifecycle(listener: LifecycleListener): Promise<unknown> {
  const pending: { value: Promise<unknown> | null } = { value: null }
  listener({
    waitUntil: (promise) => {
      pending.value = promise
    },
  })
  expect(pending.value, 'expected lifecycle listener to extend the event lifetime').not.toBeNull()
  if (!pending.value) {
    throw new Error('Lifecycle listener did not extend the event lifetime')
  }
  return pending.value
}

type BuildManifestFixture = Record<string, {
  file: string
  css?: string[]
  assets?: string[]
  imports?: string[]
}>

function mockInstallFetch(
  harness: LifecycleHarness,
  manifest: BuildManifestFixture,
  indexHtml?: string,
): void {
  const indexEntry = manifest['index.html']
  const html = indexHtml ?? [
    `<script src="${BASE_PATH}${indexEntry.file}"></script>`,
    ...(indexEntry.css ?? []).map((path) => `<link href="${BASE_PATH}${path}" rel="stylesheet">`),
    ...(indexEntry.assets ?? []).map((path) => `<link href="${BASE_PATH}${path}">`),
  ].join('')
  harness.fetchMock.mockImplementation(async (path: string) => {
    if (path === `${BASE_PATH}asset-manifest.json`) {
      return makeResponse(JSON.stringify(manifest))
    }
    if (path === BASE_PATH || path === `${BASE_PATH}index.html`) {
      return makeResponse(html)
    }
    return makeResponse(`shell:${path}`)
  })
}

function dispatchFetch(harness: ServiceWorkerHarness, request: Request): Promise<Response> | null {
  let responsePromise: Promise<Response> | null = null
  harness.fetchListener({
    request,
    respondWith: (response) => {
      responsePromise = response
    },
    waitUntil: (promise) => {
      harness.waitUntilPromises.push(promise)
    },
  })
  return responsePromise
}

describe('service worker lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('pre-caches the complete current Vite asset graph before activating', async () => {
    const harness = loadServiceWorkerLifecycle()
    mockInstallFetch(harness, {
      'index.html': {
        file: 'assets/index-abc123.js',
        css: ['assets/index-def456.css'],
      },
      'src/renderers/three/index.ts': {
        file: 'assets/three-abc123.js',
        css: ['assets/three-def456.css'],
        imports: ['index.html'],
      },
    })

    await dispatchLifecycle(harness.installListener)

    expect(harness.fetchMock).toHaveBeenCalledWith('/Cardgame/asset-manifest.json', { cache: 'no-store' })
    expect(harness.fetchMock).toHaveBeenCalledWith('/Cardgame/index.html', { cache: 'reload' })
    expect(harness.cacheAddAllCalls).toEqual([
      {
        cacheName: 'cardgame-build-assets-v9-index-build123.js',
        paths: [
          '/Cardgame/assets/index-abc123.js',
          '/Cardgame/assets/index-def456.css',
          '/Cardgame/assets/three-abc123.js',
          '/Cardgame/assets/three-def456.css',
        ],
      },
    ])
    expect([...harness.cacheEntries.get('cardgame-shell-v9-index-build123.js')!.keys()]).toEqual([
      '/Cardgame/',
      '/Cardgame/index.html',
      '/Cardgame/icons.svg',
      '/Cardgame/favicon.svg',
      '/Cardgame/manifest.webmanifest',
      '/Cardgame/apple-touch-icon.png',
      '/Cardgame/pwa-192.png',
      '/Cardgame/pwa-512.png',
      '/Cardgame/pwa-maskable-512.png',
      '/Cardgame/404.html',
    ])
    expect(harness.skipWaiting).toHaveBeenCalledOnce()
  })

  it('keeps the previous worker active when the new asset graph cannot be cached', async () => {
    const harness = loadServiceWorkerLifecycle()
    mockInstallFetch(harness, {
      'index.html': { file: 'assets/index-abc123.js' },
      'src/renderers/three/index.ts': { file: 'assets/three-abc123.js' },
    })
    harness.cacheAddAll.mockRejectedValueOnce(new Error('offline'))

    await expect(dispatchLifecycle(harness.installListener)).rejects.toThrow('offline')

    expect(harness.skipWaiting).not.toHaveBeenCalled()
  })

  it('rejects a fresh manifest paired with a stale index shell', async () => {
    const harness = loadServiceWorkerLifecycle()
    mockInstallFetch(
      harness,
      {
        'index.html': { file: 'assets/index-current.js' },
        'src/renderers/three/index.ts': { file: 'assets/three-current.js' },
      },
      '<script src="/Cardgame/assets/index-stale.js"></script>',
    )

    await expect(dispatchLifecycle(harness.installListener))
      .rejects.toThrow('Index shell does not match asset manifest')

    expect(harness.cachesOpen).not.toHaveBeenCalled()
    expect(harness.skipWaiting).not.toHaveBeenCalled()
  })

  it('rejects manifest paths outside the built asset directory', async () => {
    const harness = loadServiceWorkerLifecycle()
    harness.fetchMock.mockResolvedValue(makeResponse(JSON.stringify({
      'index.html': { file: '../outside.js' },
      'src/renderers/three/index.ts': { file: 'assets/three-abc123.js' },
    })))

    await expect(dispatchLifecycle(harness.installListener)).rejects.toThrow('Invalid asset path')

    expect(harness.cachesOpen).not.toHaveBeenCalled()
    expect(harness.skipWaiting).not.toHaveBeenCalled()
  })

  it('starts the bumped artwork cache empty and retires obsolete runtime assets', async () => {
    const cardUrl = `${ORIGIN}${BASE_PATH}cards/hd/gravebloom-dryad.png`
    const boardUrl = `${ORIGIN}${BASE_PATH}boards/classic/background-hd.png`
    const card = makeResponse('cached card')
    const board = makeResponse('cached board')
    const harness = loadServiceWorkerLifecycle(
      ['cardgame-assets-v8', 'cardgame-runtime-assets-v1'],
      {
        'cardgame-runtime-assets-v1': [
          [cardUrl, card],
          [boardUrl, board],
        ],
      },
    )
    mockInstallFetch(harness, {
      'index.html': { file: 'assets/index-abc123.js' },
      'src/renderers/three/index.ts': { file: 'assets/three-abc123.js' },
    })

    await dispatchLifecycle(harness.installListener)

    const currentAssets = harness.cacheEntries.get('cardgame-runtime-assets-v2')
    expect(currentAssets?.size).toBe(0)
    expect(harness.cacheEntries.get('cardgame-runtime-assets-v1')?.get(cardUrl)).toBe(card)
    expect(harness.cacheEntries.get('cardgame-runtime-assets-v1')?.get(boardUrl)).toBe(board)

    await dispatchLifecycle(harness.activateListener)

    expect(harness.cacheEntries.has('cardgame-assets-v8')).toBe(false)
    expect(harness.cacheEntries.has('cardgame-runtime-assets-v1')).toBe(false)
    expect(harness.cacheEntries.get('cardgame-runtime-assets-v2')?.size).toBe(0)
  })

  it('deletes only obsolete Cardgame caches during activation', async () => {
    const harness = loadServiceWorkerLifecycle([
      'cardgame-shell-v8',
      'cardgame-assets-v8',
      'cardgame-shell-v9-index-previous.js',
      'cardgame-build-assets-v9-index-previous.js',
      'cardgame-runtime-assets-v0',
      'cardgame-shell-v9-index-build123.js',
      'cardgame-build-assets-v9-index-build123.js',
      'cardgame-runtime-assets-v1',
      'cardgame-runtime-assets-v2',
      'another-pages-app-v3',
    ])

    await dispatchLifecycle(harness.activateListener)

    expect(harness.cachesDelete.mock.calls.map(([cacheName]) => cacheName)).toEqual([
      'cardgame-shell-v8',
      'cardgame-assets-v8',
      'cardgame-shell-v9-index-previous.js',
      'cardgame-build-assets-v9-index-previous.js',
      'cardgame-runtime-assets-v0',
      'cardgame-runtime-assets-v1',
    ])
  })
})

describe('service worker fetch handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('network-first navigation', () => {
    it('does not replace the manifest-validated shell with an unverified response', async () => {
      const harness = loadServiceWorker()
      const request = makeNavigationRequest('/Cardgame/')
      const network = makeResponse('new deployment')
      harness.fetchMock.mockResolvedValue(network)

      const response = await dispatchFetch(harness, request)

      expect(response).toBe(network)
      expect(harness.fetchMock).toHaveBeenCalledWith(request)
      expect(harness.cachesMatch).not.toHaveBeenCalled()
      expect(harness.cachePut).not.toHaveBeenCalled()
    })

    it('falls back to the validated shell when navigation is offline', async () => {
      const harness = loadServiceWorker()
      const request = makeNavigationRequest('/Cardgame/deep/link')
      const cached = makeResponse('validated shell')
      harness.cachedResponses.set('/Cardgame/index.html', cached)
      harness.fetchMock.mockRejectedValue(new Error('offline'))

      const response = await dispatchFetch(harness, request)

      expect(response).toBe(cached)
      expect(harness.cachesMatch).toHaveBeenCalledWith('/Cardgame/index.html')
      expect(harness.cachePut).not.toHaveBeenCalled()
    })
  })

  describe('unhashed public asset network-first caching', () => {
    it('uses the network response when a cached card also exists', async () => {
      const harness = loadServiceWorker()
      const request = makeRequest('/Cardgame/cards/hd/gravebloom-dryad.png')
      const cached = makeResponse('cached card')
      const network = makeResponse('network card')
      const networkClone = makeResponse('network card clone')
      const clone = vi.spyOn(network, 'clone').mockReturnValue(networkClone)
      harness.cachedResponses.set(request.url, cached)
      harness.fetchMock.mockResolvedValue(network)

      const response = await dispatchFetch(harness, request)
      await flushPromises()

      expect(response).toBe(network)
      expect(harness.fetchMock).toHaveBeenCalledWith(request)
      expect(harness.cachesMatch).not.toHaveBeenCalled()
      expect(clone).toHaveBeenCalledTimes(1)
      expectSingleCachePut(harness, request, networkClone)
    })

    it('caches successful network card responses', async () => {
      const harness = loadServiceWorker()
      const request = makeRequest('/Cardgame/cards/monochrome/signal-siren.png')
      const network = makeResponse('network card')
      const networkClone = makeResponse('network card clone')
      const clone = vi.spyOn(network, 'clone').mockReturnValue(networkClone)
      harness.fetchMock.mockResolvedValue(network)

      const response = await dispatchFetch(harness, request)
      await flushPromises()

      expect(response).toBe(network)
      expect(clone).toHaveBeenCalledTimes(1)
      expectSingleCachePut(harness, request, networkClone)
    })

    it('returns network 404 card responses without caching or falling back', async () => {
      const harness = loadServiceWorker()
      const request = makeRequest('/Cardgame/cards/hd/Missing.png')
      const network = makeResponse('missing card', { status: 404 })
      harness.fetchMock.mockResolvedValue(network)

      const response = await dispatchFetch(harness, request)
      await flushPromises()

      expect(response).toBe(network)
      expect(response?.status).toBe(404)
      expect(harness.cachesMatch).not.toHaveBeenCalled()
      expect(harness.cachePut).not.toHaveBeenCalled()
    })

    it('falls back to the cached card when the network rejects', async () => {
      const harness = loadServiceWorker()
      const request = makeRequest('/Cardgame/cards/hd/memory-vampire.png')
      const cached = makeResponse('cached card')
      harness.cachedResponses.set(request.url, cached)
      harness.fetchMock.mockRejectedValue(new Error('offline'))

      const response = await dispatchFetch(harness, request)

      expect(response).toBe(cached)
      expect(harness.cachesMatch).toHaveBeenCalledWith(request)
      expect(harness.cachePut).not.toHaveBeenCalled()
    })

    it('returns Response.error() when network and cached card both miss', async () => {
      const harness = loadServiceWorker()
      const request = makeRequest('/Cardgame/cards/hd/echo-doppelganger.png')
      harness.fetchMock.mockRejectedValue(new Error('offline'))

      const response = await dispatchFetch(harness, request)

      expect(response?.type).toBe('error')
      expect(response?.ok).toBe(false)
      expect(response?.status).toBe(0)
      expect(harness.cachesMatch).toHaveBeenCalledWith(request)
      expect(harness.cachePut).not.toHaveBeenCalled()
    })

    it('refreshes board backgrounds from the network before a cached copy', async () => {
      const harness = loadServiceWorker()
      const request = makeRequest('/Cardgame/boards/moonlit/background-hd.png')
      const cached = makeResponse('cached board')
      const network = makeResponse('network board')
      const networkClone = makeResponse('network board clone')
      const clone = vi.spyOn(network, 'clone').mockReturnValue(networkClone)
      harness.cachedResponses.set(request.url, cached)
      harness.fetchMock.mockResolvedValue(network)

      const response = await dispatchFetch(harness, request)
      await flushPromises()

      expect(response).toBe(network)
      expect(harness.cachesMatch).not.toHaveBeenCalled()
      expect(clone).toHaveBeenCalledTimes(1)
      expectSingleCachePut(harness, request, networkClone)
    })

    it('returns the runtime network response before a pending cache write settles', async () => {
      const harness = loadServiceWorker()
      const request = makeRequest('/Cardgame/boards/classic/background-balanced.png')
      const network = makeResponse('network board')
      const networkClone = makeResponse('network board clone')
      vi.spyOn(network, 'clone').mockReturnValue(networkClone)
      const cacheWriteControl: { finish: (() => void) | null } = { finish: null }
      harness.cachePut.mockImplementationOnce(async (key: Request | string, response: Response) => {
        harness.cachePutCalls.push({ key, response })
        await new Promise<void>((resolve) => {
          cacheWriteControl.finish = resolve
        })
      })
      harness.fetchMock.mockResolvedValue(network)

      let responseSettled = false
      const responsePromise = dispatchFetch(harness, request)
      responsePromise?.then(() => {
        responseSettled = true
      })
      await flushPromises()

      expect(harness.cachePut).toHaveBeenCalledTimes(1)
      expect(harness.waitUntilPromises).toHaveLength(1)
      const response = await responsePromise
      expect(response).toBe(network)
      expect(responseSettled).toBe(true)

      cacheWriteControl.finish?.()
      await Promise.allSettled(harness.waitUntilPromises)
    })

    it('returns a valid network response when runtime cache persistence fails', async () => {
      const harness = loadServiceWorker()
      const request = makeRequest('/Cardgame/boards/classic/ambience-atlas.png')
      const cached = makeResponse('stale atlas')
      const network = makeResponse('network atlas')
      const networkClone = makeResponse('network atlas clone')
      vi.spyOn(network, 'clone').mockReturnValue(networkClone)
      harness.cachedResponses.set(request.url, cached)
      harness.cachePut.mockRejectedValueOnce(new Error('quota exceeded'))
      harness.fetchMock.mockResolvedValue(network)

      const response = await dispatchFetch(harness, request)

      expect(response).toBe(network)
      expect(harness.cachePut).toHaveBeenCalledWith(request, networkClone)
      expect(harness.cachesMatch).not.toHaveBeenCalled()
    })

    it('does not intercept retired sprite paths', () => {
      const harness = loadServiceWorker()
      const request = makeRequest('/Cardgame/sprites/board-ui-atlas.json')

      const response = dispatchFetch(harness, request)

      expect(response).toBeNull()
      expect(harness.fetchMock).not.toHaveBeenCalled()
      expect(harness.cachesMatch).not.toHaveBeenCalled()
      expect(harness.cachePut).not.toHaveBeenCalled()
    })
  })

  describe('/assets/* cache-first caching', () => {
    it('uses a cached asset without fetching', async () => {
      const harness = loadServiceWorker()
      const request = makeRequest('/Cardgame/assets/index-abc123.js')
      const cached = makeResponse('cached asset')
      harness.cachedResponses.set(request.url, cached)

      const response = await dispatchFetch(harness, request)

      expect(response).toBe(cached)
      expect(harness.cachesMatch).toHaveBeenCalledWith(request)
      expect(harness.fetchMock).not.toHaveBeenCalled()
      expect(harness.cachePut).not.toHaveBeenCalled()
    })

    it('fetches and caches an asset when the cache misses', async () => {
      const harness = loadServiceWorker()
      const request = makeRequest('/Cardgame/assets/index-def456.css')
      const network = makeResponse('network asset')
      const networkClone = makeResponse('network asset clone')
      const clone = vi.spyOn(network, 'clone').mockReturnValue(networkClone)
      harness.fetchMock.mockResolvedValue(network)

      const response = await dispatchFetch(harness, request)
      await flushPromises()

      expect(response).toBe(network)
      expect(harness.cachesMatch).toHaveBeenCalledWith(request)
      expect(harness.fetchMock).toHaveBeenCalledWith(request)
      expect(clone).toHaveBeenCalledTimes(1)
      expectSingleCachePut(harness, request, networkClone)
    })

    it('returns non-ok network asset responses without caching them', async () => {
      const harness = loadServiceWorker()
      const request = makeRequest('/Cardgame/assets/missing.js')
      const network = makeResponse('missing asset', { status: 404 })
      harness.fetchMock.mockResolvedValue(network)

      const response = await dispatchFetch(harness, request)
      await flushPromises()

      expect(response).toBe(network)
      expect(response?.status).toBe(404)
      expect(harness.cachePut).not.toHaveBeenCalled()
    })
  })

  describe('routing guards', () => {
    it('ignores non-GET requests', () => {
      const harness = loadServiceWorker()
      const request = makeRequest('/Cardgame/cards/hd/gravebloom-dryad.png', { method: 'POST' })

      expect(dispatchFetch(harness, request)).toBeNull()
      expect(harness.fetchMock).not.toHaveBeenCalled()
    })

    it('ignores cross-origin requests', () => {
      const harness = loadServiceWorker()
      const request = new Request('https://cdn.example.test/Cardgame/cards/hd/gravebloom-dryad.png')

      expect(dispatchFetch(harness, request)).toBeNull()
      expect(harness.fetchMock).not.toHaveBeenCalled()
    })

    it('ignores same-origin requests outside the configured base path', () => {
      const harness = loadServiceWorker()
      const request = makeRequest('/Other/cards/hd/gravebloom-dryad.png')

      expect(dispatchFetch(harness, request)).toBeNull()
      expect(harness.fetchMock).not.toHaveBeenCalled()
    })
  })
})
