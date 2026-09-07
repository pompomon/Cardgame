import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinearFilter, NearestFilter } from 'three'
import { HIDDEN_HAND_CARD_NAME } from '../app/types'
import { ThreeAssets, boardAssetCandidates, boardTextureDimensions, cardAssetCandidates, parseAmbienceFrame } from '../renderers/three/assets'
import { installFakeTimerHooks } from './helpers/timers'

class FakeImage {
  static images: FakeImage[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  width = 1024
  height = 1024
  src = ''
  constructor() { FakeImage.images.push(this) }
  removeAttribute(): void {}
}

function ambienceMetadata(): object {
  return {
    frames: { 'ambient-mote': { frame: { x: 0, y: 0, w: 64, h: 64 }, rotated: false, trimmed: false } },
    meta: { size: { w: 128, h: 64 }, image: 'https://untrusted.invalid/ignored.png' },
  }
}

function metadataResponse(metadata: unknown = ambienceMetadata()): Response {
  return new Response(JSON.stringify(metadata))
}

describe('Three.js shared HD texture leases', () => {
  installFakeTimerHooks()
  let assets: ThreeAssets
  let online: EventTarget
  let contexts: Array<{
    drawImage: ReturnType<typeof vi.fn>
    fillText: ReturnType<typeof vi.fn>
    fillRect: ReturnType<typeof vi.fn>
    imageSmoothingEnabled: boolean
  }>
  let invalidate: ReturnType<typeof vi.fn>
  beforeEach(() => {
    online = new EventTarget()
    contexts = []
    FakeImage.images = []
    vi.stubGlobal('window', online)
    vi.stubGlobal('Image', FakeImage)
    vi.stubGlobal('document', {
      createElement: () => {
        const context = {
          drawImage: vi.fn(), fillText: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), clearRect: vi.fn(),
          imageSmoothingEnabled: true,
          createRadialGradient: () => ({ addColorStop: vi.fn() }),
        }
        contexts.push(context)
        return { width: 0, height: 0, getContext: () => context }
      },
    })
    invalidate = vi.fn()
    assets = new ThreeAssets(invalidate, 1)
    online.dispatchEvent(new Event('online'))
  })
  afterEach(() => {
    assets.dispose()
    vi.unstubAllGlobals()
  })

  it('uses shared base-path helpers and HD → geometric → procedural routing', () => {
    expect(cardAssetCandidates('Forest', 'hd')).toEqual(['/cards/hd/Forest.png', '/cards/hd-fallback/Forest.png'])
    expect(cardAssetCandidates('Forest', 'classic')).toEqual([])
    expect(cardAssetCandidates('unknown', 'hd')).toEqual([])
    expect(boardAssetCandidates('verdant', 'balanced')).toEqual([
      '/boards/verdant/background-balanced.png', '/boards/verdant/background-low.png', '/boards/verdant/background-fallback.png',
    ])
    const lease = assets.acquireCard('Forest', 'hd')
    const version = lease.texture.version
    expect(contexts[0].fillText).toHaveBeenCalledWith('Forest', 256, 664, 456)
    const first = FakeImage.images[0]
    const lateSuccess = first.onload!
    first.onerror!()
    expect(FakeImage.images[1].src).toBe('/cards/hd-fallback/Forest.png')
    lateSuccess()
    expect(lease.texture.version).toBe(version)
    FakeImage.images[1].onload!()
    expect(contexts[0].drawImage).toHaveBeenCalledTimes(1)
    expect(lease.texture.version).toBeGreaterThan(version)
    expect(invalidate).toHaveBeenCalledOnce()
  })

  it('cover-fits raster art across the full face with only a compact readable name strip', () => {
    const lease = assets.acquireCard('Island', 'hd')
    expect(lease.texture.minFilter).toBe(NearestFilter)
    expect(lease.texture.magFilter).toBe(NearestFilter)
    expect(contexts[0].imageSmoothingEnabled).toBe(false)
    FakeImage.images[0].onload!()
    const call = contexts[0].drawImage.mock.calls[0]
    expect(call).toHaveLength(9)
    expect(call.slice(5)).toEqual([16, 16, 480, 672])
    expect(call[3] / call[4]).toBeCloseTo(480 / 672)
    expect(contexts[0].fillRect).toHaveBeenCalledWith(16, 588, 480, 100)
    expect(contexts[0].fillText.mock.calls.every(([text]) => text === 'Island')).toBe(true)
    expect(lease.texture.minFilter).toBe(LinearFilter)
    expect(lease.texture.magFilter).toBe(LinearFilter)
    expect(contexts[0].imageSmoothingEnabled).toBe(true)
    expect(lease.texture.generateMipmaps).toBe(false)
  })

  it('keeps geometric raster fallbacks smooth and failed raster procedural art crisp', () => {
    const forest = assets.acquireCard('Forest', 'hd')
    FakeImage.images[0].onerror!()
    expect(forest.texture.magFilter).toBe(NearestFilter)
    FakeImage.images[1].onload!()
    expect(forest.texture.magFilter).toBe(LinearFilter)
    const swamp = assets.acquireCard('Swamp', 'hd')
    FakeImage.images[2].onerror!()
    FakeImage.images[3].onerror!()
    expect(swamp.texture.magFilter).toBe(NearestFilter)
    expect(swamp.failed).toBe(true)
    expect(swamp.ready).toBe(false)
  })

  it('restores a readable crisp procedural surface if raster drawing fails', () => {
    const forest = assets.acquireCard('Forest', 'hd')
    contexts[0].drawImage.mockImplementation(() => { throw new Error('Unusable raster') })
    FakeImage.images[0].onload!()
    FakeImage.images[1].onload!()
    expect(forest.ready).toBe(false)
    expect(forest.failed).toBe(true)
    expect(forest.texture.magFilter).toBe(NearestFilter)
    expect(contexts[0].fillText).toHaveBeenLastCalledWith('Forest', 256, 664, 456)
  })

  it.each([
    ['hd', 1920, 1080], ['balanced', 1280, 720], ['low', 960, 540], ['fallback', 640, 360],
  ] as const)('bounds the %s board canvas to %sx%s with asynchronous readiness', (variant, width, height) => {
    const lease = assets.acquireBoard('verdant', variant)
    expect(boardTextureDimensions(variant)).toEqual({ width, height })
    expect(lease.texture.image).toMatchObject({ width, height })
    expect(lease.ready).toBe(false)
    expect(lease.failed).toBe(false)
    FakeImage.images[0].width = 1920
    FakeImage.images[0].height = 1080
    FakeImage.images[0].onload!()
    expect(lease.ready).toBe(true)
    expect(lease.texture.image).toMatchObject({ width, height })
    expect(contexts[0].drawImage).toHaveBeenCalledWith(FakeImage.images[0], 0, 0, 1920, 1080, 0, 0, width, height)
  })

  it('evicts released large backgrounds immediately while preserving shared active leases', () => {
    const first = assets.acquireBoard('verdant', 'hd')
    const second = assets.acquireBoard('verdant', 'hd')
    const dispose = vi.spyOn(first.texture, 'dispose')
    const stale = FakeImage.images[0].onload!
    expect(first.texture).toBe(second.texture)
    first.release()
    expect(dispose).not.toHaveBeenCalled()
    second.release()
    expect(dispose).toHaveBeenCalledOnce()
    expect(assets.size).toBe(0)
    expect(FakeImage.images[0].onload).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    stale()
    expect(invalidate).not.toHaveBeenCalled()
    for (let index = 0; index < 12; index++) assets.acquireBoard('classic', 'balanced').release()
    expect(assets.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports exhausted board fallbacks as not ready and retries after online recovery', () => {
    const lease = assets.acquireBoard('moonlit', 'balanced')
    for (let index = 0; index < 3; index++) FakeImage.images[index].onerror!()
    expect(lease.ready).toBe(false)
    expect(lease.failed).toBe(true)
    online.dispatchEvent(new Event('online'))
    expect(FakeImage.images[3].src).toBe('/boards/moonlit/background-balanced.png')
    FakeImage.images[3].onload!()
    expect(lease.ready).toBe(true)
    expect(lease.failed).toBe(false)
    online.dispatchEvent(new Event('online'))
    expect(FakeImage.images).toHaveLength(4)
  })

  it('loads shared per-theme ambience only from trusted helper URLs and crops the validated mote frame', async () => {
    const fetch = vi.fn().mockResolvedValue(metadataResponse())
    vi.stubGlobal('fetch', fetch)
    const first = assets.acquireAmbience('verdant')
    const second = assets.acquireAmbience('verdant')
    const dispose = vi.spyOn(first.texture, 'dispose')
    expect(first.ready).toBe(false)
    expect(first.texture).toBe(second.texture)
    await vi.waitFor(() => expect(FakeImage.images).toHaveLength(1))
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0][0]).toBe('/boards/verdant/ambience-atlas.json')
    const image = FakeImage.images[0]
    expect(image.src).toBe('/boards/verdant/ambience-atlas.png')
    image.width = 128
    image.height = 64
    image.onload!()
    expect(first.ready).toBe(true)
    expect(contexts[0].drawImage).toHaveBeenCalledWith(image, 0, 0, 64, 64, 0, 0, 64, 64)
    first.release()
    expect(dispose).not.toHaveBeenCalled()
    second.release()
    expect(dispose).toHaveBeenCalledOnce()
    expect(assets.size).toBe(0)
  })

  it('rejects atlas metadata oversized both by Content-Length and streamed bytes', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { headers: { 'content-length': '999999' } }))
      .mockResolvedValueOnce(new Response(' '.repeat(16385)))
    vi.stubGlobal('fetch', fetch)
    const first = assets.acquireAmbience('classic')
    await vi.waitFor(() => expect(first.failed).toBe(true))
    const second = assets.acquireAmbience('moonlit')
    await vi.waitFor(() => expect(second.failed).toBe(true))
    expect(FakeImage.images).toHaveLength(0)
    expect(first.ready).toBe(false)
    expect(second.ready).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects mismatched atlas pixels, suppresses failed reloads and recovers online', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(metadataResponse()))
    vi.stubGlobal('fetch', fetch)
    const first = assets.acquireAmbience('classic')
    await vi.waitFor(() => expect(FakeImage.images).toHaveLength(1))
    FakeImage.images[0].onload!()
    expect(first.failed).toBe(true)
    expect(first.ready).toBe(false)
    first.release()
    const second = assets.acquireAmbience('classic')
    expect(second.failed).toBe(true)
    expect(fetch).toHaveBeenCalledOnce()
    online.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect(FakeImage.images).toHaveLength(2))
    FakeImage.images[1].width = 128
    FakeImage.images[1].height = 64
    FakeImage.images[1].onload!()
    expect(second.ready).toBe(true)
  })

  it('aborts pending ambience metadata on release and ignores late completions', async () => {
    let resolve!: (response: Response) => void
    const fetch = vi.fn().mockReturnValue(new Promise<Response>((done) => { resolve = done }))
    vi.stubGlobal('fetch', fetch)
    const lease = assets.acquireAmbience('moonlit')
    const signal: AbortSignal = fetch.mock.calls[0][1].signal
    lease.release()
    expect(signal.aborted).toBe(true)
    resolve(metadataResponse())
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(FakeImage.images).toHaveLength(0)
    expect(invalidate).not.toHaveBeenCalled()
    expect(assets.size).toBe(0)
  })

  it('bounds metadata timeout even when a transport ignores abort', async () => {
    let resolve!: (response: Response) => void
    const fetch = vi.fn().mockReturnValue(new Promise<Response>((done) => { resolve = done }))
    vi.stubGlobal('fetch', fetch)
    const lease = assets.acquireAmbience('verdant')
    vi.advanceTimersByTime(15000)
    expect(lease.failed).toBe(true)
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
    resolve(metadataResponse())
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(FakeImage.images).toHaveLength(0)
    expect(lease.ready).toBe(false)
  })

  it('suppresses failed URLs across reacquisition and retries live textures when online', () => {
    const forest = assets.acquireCard('Forest', 'hd')
    FakeImage.images[0].onerror!()
    FakeImage.images[1].onerror!()
    forest.release()
    const island = assets.acquireCard('Island', 'classic')
    island.release()
    const again = assets.acquireCard('Forest', 'hd')
    expect(FakeImage.images).toHaveLength(2)
    online.dispatchEvent(new Event('online'))
    expect(FakeImage.images).toHaveLength(3)
    expect(FakeImage.images[2].src).toBe('/cards/hd/Forest.png')
    again.release()
  })

  it('upgrades a loaded raster fallback after online recovery without reloading healthy primary art', () => {
    const lease = assets.acquireCard('Plains', 'hd')
    FakeImage.images[0].onerror!()
    FakeImage.images[1].onload!()
    expect(lease.ready).toBe(true)
    online.dispatchEvent(new Event('online'))
    expect(FakeImage.images[2].src).toBe('/cards/hd/Plains.png')
    expect(lease.ready).toBe(true)
    FakeImage.images[2].onload!()
    online.dispatchEvent(new Event('online'))
    expect(FakeImage.images).toHaveLength(3)
  })

  describe('Three.js ambience metadata validation', () => {
    it('accepts the bounded unrotated shipped frame shape', () => {
      expect(parseAmbienceFrame(ambienceMetadata())).toEqual({ x: 0, y: 0, width: 64, height: 64, atlasWidth: 128, atlasHeight: 64 })
    })

    it.each([null, [], {}, { frames: [] }, { frames: { 'ambient-mote': null }, meta: { size: {} } }])('rejects malformed metadata %j', (value) => {
      expect(parseAmbienceFrame(value)).toBeNull()
    })

    it.each([
      { x: -1 }, { x: Infinity }, { y: NaN }, { w: 0 }, { w: 64.5 }, { h: 512 }, { x: 100 }, { y: 1 },
    ])('rejects invalid or out-of-bounds rectangles %j', (patch) => {
      expect(parseAmbienceFrame({
        frames: { 'ambient-mote': { frame: { x: 0, y: 0, w: 64, h: 64, ...patch }, rotated: false, trimmed: false } },
        meta: { size: { w: 128, h: 64 } },
      })).toBeNull()
    })

    it.each([{ rotated: true }, { trimmed: true }, { rotated: undefined }])('rejects unsupported transforms %j', (patch) => {
      expect(parseAmbienceFrame({
        frames: { 'ambient-mote': { frame: { x: 0, y: 0, w: 64, h: 64 }, rotated: false, trimmed: false, ...patch } },
        meta: { size: { w: 128, h: 64 } },
      })).toBeNull()
    })
  })

  it('shares cached name/style text and holds a texture until the final reference releases', () => {
    const first = assets.acquireCard('Plains', 'classic')
    const second = assets.acquireCard('Plains', 'classic')
    const dispose = vi.spyOn(first.texture, 'dispose')
    expect(first.texture).toBe(second.texture)
    expect(contexts).toHaveLength(1)
    first.release()
    first.release()
    assets.acquireCard('Island', 'classic').release()
    assets.acquireCard('Forest', 'classic').release()
    expect(dispose).not.toHaveBeenCalled()
    second.release()
    assets.acquireCard('Swamp', 'classic').release()
    expect(assets.size).toBe(1)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('renders hidden card backs without leaking a land name', () => {
    assets.acquireCard(HIDDEN_HAND_CARD_NAME, 'hd')
    expect(FakeImage.images[0].src).toBe('/cards/card-back.png')
    expect(contexts[0].fillText).toHaveBeenCalledWith('CARDGAME', 256, 368, 420)
    expect(contexts[0].fillText).not.toHaveBeenCalledWith(HIDDEN_HAND_CARD_NAME, expect.anything(), expect.anything(), expect.anything())
  })

  it('timeouts remain bounded and fall back without a new render subscription', () => {
    assets.acquireCard('Mountain', 'hd')
    vi.advanceTimersByTime(15000)
    expect(FakeImage.images).toHaveLength(2)
    vi.advanceTimersByTime(15000)
    expect(FakeImage.images).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('invalidates stale callbacks after disposal, online restart, and eviction', () => {
    const first = assets.acquireCard('Forest', 'hd')
    const beforeOnline = FakeImage.images[0].onload!
    online.dispatchEvent(new Event('online'))
    const beforeDispose = FakeImage.images[1].onload!
    beforeOnline()
    const dispose = vi.spyOn(first.texture, 'dispose')
    assets.dispose()
    assets.dispose()
    beforeDispose()
    expect(invalidate).not.toHaveBeenCalled()
    expect(FakeImage.images[1].onload).toBeNull()
    expect(dispose).toHaveBeenCalledOnce()
    expect(assets.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    online.dispatchEvent(new Event('online'))
    expect(FakeImage.images).toHaveLength(2)
    first.release()
    expect(() => assets.acquireCard('Forest', 'hd')).toThrow('disposed')
  })
})
