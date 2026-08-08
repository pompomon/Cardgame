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

  describe('unhashed public asset network-first caching', () => {
    it('uses the network response when a cached card also exists', async () => {
      const harness = loadServiceWorker()
      const request = makeRequest('/Cardgame/cards/hd/Forest.png')
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
      const request = makeRequest('/Cardgame/cards/monochrome/Island.png')
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

    it('keeps the response pending until the runtime cache write finishes', async () => {
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
      expect(responseSettled).toBe(false)

      cacheWriteControl.finish?.()
      const response = await responsePromise
      expect(response).toBe(network)
      expect(responseSettled).toBe(true)
    })

    it('uses a cached sprite atlas when offline', async () => {
      const harness = loadServiceWorker()
      const request = makeRequest('/Cardgame/sprites/board-ui-atlas.json')
      const cached = makeResponse('cached atlas')
      harness.cachedResponses.set(request.url, cached)
      harness.fetchMock.mockRejectedValue(new Error('offline'))

      const response = await dispatchFetch(harness, request)

      expect(response).toBe(cached)
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
