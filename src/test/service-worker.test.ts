import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const REPO_ROOT = resolve(__dirname, '..', '..')
const SERVICE_WORKER_PATH = resolve(REPO_ROOT, 'public/sw.js')
const ORIGIN = 'https://example.test'
const BASE_PATH = '/Cardgame/'

type FetchListener = (event: FetchEventStub) => void

type FetchEventStub = {
  request: Request
  respondWith: (response: Promise<Response>) => void
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
}

function cacheKey(key: Request | string): string {
  return typeof key === 'string' ? key : key.url
}

function makeRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, init)
}

function makeResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, ...init })
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function loadServiceWorker(): ServiceWorkerHarness {
  const listeners = new Map<string, EventListener>()
  const cachedResponses = new Map<string, Response>()
  const cachePutCalls: CachePutCall[] = []
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
    location: new URL(`${ORIGIN}${BASE_PATH}sw.js?base=${BASE_PATH}`),
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
  }
}

function dispatchFetch(harness: ServiceWorkerHarness, request: Request): Promise<Response> | null {
  let responsePromise: Promise<Response> | null = null
  harness.fetchListener({
    request,
    respondWith: (response) => {
      responsePromise = response
    },
  })
  return responsePromise
}

describe('service worker fetch handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('/cards/* network-first caching', () => {
    it('uses the network response when a cached card also exists', async () => {
      const harness = loadServiceWorker()
      const request = makeRequest('/Cardgame/cards/hd/Forest.png')
      const cached = makeResponse('cached card')
      const network = makeResponse('network card')
      harness.cachedResponses.set(request.url, cached)
      harness.fetchMock.mockResolvedValue(network)

      const response = await dispatchFetch(harness, request)
      await flushPromises()

      expect(response).toBe(network)
      expect(harness.fetchMock).toHaveBeenCalledWith(request)
      expect(harness.cachesMatch).not.toHaveBeenCalled()
      expect(harness.cachePutCalls).toEqual([{ key: request, response: network }])
    })

    it('caches successful network card responses', async () => {
      const harness = loadServiceWorker()
      const request = makeRequest('/Cardgame/cards/monochrome/Island.png')
      const network = makeResponse('network card')
      harness.fetchMock.mockResolvedValue(network)

      const response = await dispatchFetch(harness, request)
      await flushPromises()

      expect(response).toBe(network)
      expect(harness.cachePutCalls).toEqual([{ key: request, response: network }])
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
      const request = makeRequest('/Cardgame/cards/hd/Swamp.png')
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
      const request = makeRequest('/Cardgame/cards/hd/Plains.png')
      harness.fetchMock.mockRejectedValue(new Error('offline'))

      const response = await dispatchFetch(harness, request)

      expect(response?.type).toBe('error')
      expect(response?.ok).toBe(false)
      expect(response?.status).toBe(0)
      expect(harness.cachesMatch).toHaveBeenCalledWith(request)
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
      harness.fetchMock.mockResolvedValue(network)

      const response = await dispatchFetch(harness, request)
      await flushPromises()

      expect(response).toBe(network)
      expect(harness.cachesMatch).toHaveBeenCalledWith(request)
      expect(harness.fetchMock).toHaveBeenCalledWith(request)
      expect(harness.cachePutCalls).toEqual([{ key: request, response: network }])
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
      const request = makeRequest('/Cardgame/cards/hd/Forest.png', { method: 'POST' })

      expect(dispatchFetch(harness, request)).toBeNull()
      expect(harness.fetchMock).not.toHaveBeenCalled()
    })

    it('ignores cross-origin requests', () => {
      const harness = loadServiceWorker()
      const request = new Request('https://cdn.example.test/Cardgame/cards/hd/Forest.png')

      expect(dispatchFetch(harness, request)).toBeNull()
      expect(harness.fetchMock).not.toHaveBeenCalled()
    })

    it('ignores same-origin requests outside the configured base path', () => {
      const harness = loadServiceWorker()
      const request = makeRequest('/Other/cards/hd/Forest.png')

      expect(dispatchFetch(harness, request)).toBeNull()
      expect(harness.fetchMock).not.toHaveBeenCalled()
    })
  })
})
