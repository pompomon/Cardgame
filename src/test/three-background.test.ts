import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasTexture, Mesh, type MeshBasicMaterial, type PlaneGeometry } from 'three'
import type { BoardBackgroundVariant } from '../app/board-assets'
import type { BoardTheme } from '../app/board-theme'
import { ThreeBackground } from '../renderers/three/background'
import { threeQualityProfile } from '../renderers/three/quality'

function lease(width = 1920, height = 1080) {
  const texture = new CanvasTexture({ width, height } as HTMLCanvasElement)
  return { texture, ready: false, failed: false, release: vi.fn(() => texture.dispose()) }
}

const profile = threeQualityProfile({ preference: 'high', width: 1440, height: 900 })
const low = threeQualityProfile({ preference: 'low', width: 1440, height: 900 })

describe('Three.js retained board background and ambience', () => {
  let backgrounds: Array<{ theme: BoardTheme; variant: BoardBackgroundVariant; lease: ReturnType<typeof lease> }>
  let atlases: Array<{ theme: BoardTheme; lease: ReturnType<typeof lease> }>
  let background: ThreeBackground
  let invalidate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    backgrounds = []
    atlases = []
    invalidate = vi.fn()
    background = new ThreeBackground({
      acquireBoard: (theme, variant) => {
        const entry = { theme, variant, lease: lease() }
        backgrounds.push(entry)
        return entry.lease
      },
      acquireAmbience: (theme) => {
        const entry = { theme, lease: lease(64, 64) }
        atlases.push(entry)
        return entry.lease
      },
    }, invalidate)
  })
  afterEach(() => background.dispose())

  function sync(theme: BoardTheme = 'classic', width = 1440, height = 900): void {
    background.sync({ theme, profile, width, height })
  }

  function plane(): Mesh<PlaneGeometry, MeshBasicMaterial> {
    const object = background.group.children[0]
    expect(object).toBeInstanceOf(Mesh)
    return object as Mesh<PlaneGeometry, MeshBasicMaterial>
  }

  it('shows an immediate fallback but keeps the previous board until a replacement is ready', () => {
    sync()
    expect(plane().material.map).toBe(backgrounds[0].lease.texture)
    backgrounds[0].lease.ready = true
    sync('moonlit')
    expect(plane().material.map).toBe(backgrounds[0].lease.texture)
    expect(backgrounds[0].lease.release).not.toHaveBeenCalled()
    backgrounds[1].lease.failed = true
    background.advance(16)
    expect(plane().material.map).toBe(backgrounds[0].lease.texture)
    backgrounds[1].lease.failed = false
    backgrounds[1].lease.ready = true
    background.advance(16)
    expect(plane().material.map).toBe(backgrounds[1].lease.texture)
    expect(backgrounds[0].lease.release).toHaveBeenCalledOnce()
    expect(atlases.at(-1)?.theme).toBe('moonlit')
  })

  it('releases stale candidates and ignores their late success through rapid theme and tier changes', () => {
    sync()
    backgrounds[0].lease.ready = true
    sync('moonlit')
    sync('verdant')
    expect(backgrounds[1].lease.release).toHaveBeenCalledOnce()
    backgrounds[1].lease.ready = true
    background.advance(16)
    expect(plane().material.map).toBe(backgrounds[0].lease.texture)
    background.sync({ theme: 'verdant', profile: low, width: 1440, height: 900 })
    expect(backgrounds[2].lease.release).toHaveBeenCalledOnce()
    backgrounds[2].lease.ready = true
    background.advance(16)
    expect(plane().material.map).toBe(backgrounds[0].lease.texture)
    backgrounds[3].lease.ready = true
    background.advance(16)
    expect(plane().material.map).toBe(backgrounds[3].lease.texture)
    expect(backgrounds[3].variant).toBe('low')
  })

  it('returning to the active background cancels pending work without reacquiring', () => {
    sync()
    backgrounds[0].lease.ready = true
    sync('moonlit')
    sync()
    expect(backgrounds).toHaveLength(2)
    expect(backgrounds[1].lease.release).toHaveBeenCalledOnce()
    expect(backgrounds[0].lease.release).not.toHaveBeenCalled()
    expect(plane().material.map).toBe(backgrounds[0].lease.texture)
  })

  it.each([[390, 844], [844, 390], [2400, 600], [1440, 900]])(
    'cover-crops through owner-local UVs without stretching at %sx%s',
    (width, height) => {
      sync('classic', width, height)
      const mesh = plane()
      const uv = mesh.geometry.attributes.uv
      const croppedWidth = (uv.getX(1) - uv.getX(0)) * 1920
      const croppedHeight = (uv.getY(0) - uv.getY(2)) * 1080
      expect(croppedWidth / croppedHeight).toBeCloseTo(width / height, 4)
      expect(mesh.scale.x).toBe(width)
      expect(mesh.scale.y).toBe(height)
      expect(mesh.position.x).toBe(width / 2)
      expect(mesh.position.y).toBe(-height / 2)
      expect(backgrounds[0].lease.texture.repeat.toArray()).toEqual([1, 1])
      expect(backgrounds[0].lease.texture.offset.toArray()).toEqual([0, 0])
    },
  )

  it('recalculates the crop on orientation change without reacquiring the shared image', () => {
    sync('classic', 390, 844)
    const uv = plane().geometry.attributes.uv
    const portrait = uv.getX(1) - uv.getX(0)
    sync('classic', 844, 390)
    expect(uv.getX(1) - uv.getX(0)).toBeGreaterThan(portrait)
    expect(backgrounds).toHaveLength(1)
  })

  it('supports legacy board leases without readiness or ambience methods', () => {
    background.dispose()
    const original = lease()
    background = new ThreeBackground({
      acquireBoard: () => ({ texture: original.texture, release: original.release }),
    }, invalidate)
    sync()
    sync('verdant')
    expect(plane().material.map).toBe(original.texture)
    expect(background.animating).toBe(false)
  })

  it('does not request ambience until the current board is ready, and animates only a bounded ready atlas', () => {
    sync()
    expect(atlases).toHaveLength(0)
    expect(background.animating).toBe(false)
    backgrounds[0].lease.ready = true
    background.advance(16)
    expect(atlases).toHaveLength(1)
    expect(background.group.children).toHaveLength(1)
    expect(background.animating).toBe(false)
    atlases[0].lease.ready = true
    background.advance(16)
    expect(background.group.children).toHaveLength(9)
    expect(background.animating).toBe(true)
    const mote = background.group.children[1]
    const before = mote.position.clone()
    background.advance(100)
    expect(mote.position.equals(before)).toBe(false)
    background.sync({ theme: 'classic', profile: { ...profile, ambienceParticles: 9999 }, width: 1440, height: 900 })
    expect(background.group.children).toHaveLength(9)
  })

  it.each([
    { preference: 'low' as const },
    { preference: 'high' as const, animationSpeed: 'off' as const },
    { preference: 'high' as const, reducedMotion: true },
    { preference: 'high' as const, hidden: true },
  ])('suppresses and releases ambience for %j then recovers', (settings) => {
    sync()
    backgrounds[0].lease.ready = true
    background.advance(0)
    atlases[0].lease.ready = true
    background.advance(0)
    expect(background.animating).toBe(true)
    const suppressed = threeQualityProfile({ ...settings, width: 1440, height: 900 })
    background.sync({ theme: 'classic', profile: suppressed, width: 1440, height: 900 })
    expect(background.animating).toBe(false)
    expect(background.group.children).toHaveLength(1)
    expect(atlases[0].lease.release).toHaveBeenCalledOnce()
    background.advance(100)
    expect(atlases).toHaveLength(1)
    sync()
    expect(atlases).toHaveLength(2)
    atlases[1].lease.ready = true
    background.advance(0)
    expect(background.animating).toBe(true)
  })

  it('replaces atlas ownership with the displayed theme and ignores a stale atlas completing late', () => {
    sync()
    backgrounds[0].lease.ready = true
    background.advance(0)
    sync('verdant')
    backgrounds[1].lease.ready = true
    background.advance(0)
    expect(atlases[0].lease.release).toHaveBeenCalledOnce()
    expect(atlases[1].theme).toBe('verdant')
    atlases[0].lease.ready = true
    background.advance(0)
    expect(background.animating).toBe(false)
    atlases[1].lease.ready = true
    background.advance(0)
    const mote = background.group.children[1] as Mesh<PlaneGeometry, MeshBasicMaterial>
    expect(mote.material.map).toBe(atlases[1].lease.texture)
  })

  it('normalizes invalid sizes and animation deltas to finite retained geometry', () => {
    sync('classic', NaN, Infinity)
    backgrounds[0].lease.ready = true
    background.advance(0)
    atlases[0].lease.ready = true
    background.advance(NaN)
    background.advance(Infinity)
    for (const child of background.group.children) {
      expect(child.position.toArray().every(Number.isFinite)).toBe(true)
      expect(child.scale.toArray().every(Number.isFinite)).toBe(true)
    }
  })

  it('releases the current and candidate, atlas and GPU geometry exactly once on disposal', () => {
    sync()
    backgrounds[0].lease.ready = true
    background.advance(0)
    atlases[0].lease.ready = true
    background.advance(0)
    const mesh = plane()
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose')
    const materialDispose = vi.spyOn(mesh.material, 'dispose')
    const mote = background.group.children[1] as Mesh<PlaneGeometry, MeshBasicMaterial>
    const moteGeometryDispose = vi.spyOn(mote.geometry, 'dispose')
    const moteMaterialDispose = vi.spyOn(mote.material, 'dispose')
    sync('verdant')
    invalidate.mockClear()
    background.dispose()
    background.dispose()
    backgrounds[1].lease.ready = true
    background.advance(16)
    sync('moonlit')
    expect(backgrounds).toHaveLength(2)
    for (const entry of backgrounds) expect(entry.lease.release).toHaveBeenCalledOnce()
    expect(atlases[0].lease.release).toHaveBeenCalledOnce()
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
    expect(moteGeometryDispose).toHaveBeenCalledOnce()
    expect(moteMaterialDispose).toHaveBeenCalledOnce()
    expect(background.animating).toBe(false)
    expect(background.group.children).toHaveLength(0)
    expect(invalidate).not.toHaveBeenCalled()
  })
})
