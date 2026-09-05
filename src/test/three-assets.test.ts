import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HIDDEN_HAND_CARD_NAME } from '../app/types'
import { ThreeAssets, boardAssetCandidates, cardAssetCandidates } from '../renderers/three/assets'
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

describe('Three.js shared HD texture leases', () => {
  installFakeTimerHooks()
  let assets: ThreeAssets
  let online: EventTarget
  let contexts: Array<{ drawImage: ReturnType<typeof vi.fn>; fillText: ReturnType<typeof vi.fn> }>
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
          drawImage: vi.fn(), fillText: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
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
    expect(contexts[0].fillText).toHaveBeenCalledWith('Forest', 256, 586, 458)
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
