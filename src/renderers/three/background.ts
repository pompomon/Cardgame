import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three'
import type { BoardTheme } from '../../app/board-theme'
import { computeCoverFitCrop } from '../phaser/board-background'
import { clamp } from '../phaser/layout'
import type { TextureLease, ThreeAssets } from './assets'
import type { ThreeQualityProfile } from './quality'

export interface ThreeBackgroundOptions {
  readonly theme: BoardTheme
  readonly profile: ThreeQualityProfile
  readonly width: number
  readonly height: number
}

type BackgroundAssets = Pick<ThreeAssets, 'acquireBoard'> & Partial<Pick<ThreeAssets, 'acquireAmbience'>>

interface BackgroundLease {
  readonly key: string
  readonly theme: BoardTheme
  readonly lease: TextureLease
}

/** Keeps at most a displayed board and its replacement; UVs belong to this view, not shared textures. */
export class ThreeBackground {
  readonly group = new Group()
  private readonly assets: BackgroundAssets
  private readonly invalidate: () => void
  private readonly geometry = new PlaneGeometry(1, 1)
  private readonly material = new MeshBasicMaterial()
  private readonly background = new Mesh(this.geometry, this.material)
  private readonly moteGeometry = new PlaneGeometry(1, 1)
  private readonly moteMaterial = new MeshBasicMaterial({
    transparent: true, opacity: 0.18, blending: AdditiveBlending, depthWrite: false,
  })
  private readonly motes: Mesh<PlaneGeometry, MeshBasicMaterial>[] = []
  private current: BackgroundLease | null = null
  private candidate: BackgroundLease | null = null
  private ambience: { theme: BoardTheme; lease: TextureLease } | null = null
  private options: ThreeBackgroundOptions | null = null
  private elapsed = 0
  private disposed = false

  constructor(assets: BackgroundAssets, invalidate: () => void) {
    this.assets = assets
    this.invalidate = invalidate
    this.group.add(this.background)
    this.background.position.z = -0.1
  }

  sync(options: ThreeBackgroundOptions): void {
    if (this.disposed) return
    this.options = {
      theme: options.theme,
      profile: options.profile,
      width: Number.isFinite(options.width) ? Math.max(1, options.width) : 1,
      height: Number.isFinite(options.height) ? Math.max(1, options.height) : 1,
    }
    const key = `${options.theme}:${options.profile.backgroundVariant}`
    if (this.candidate && this.candidate.key !== key) {
      this.candidate.lease.release()
      this.candidate = null
    }
    if (this.current?.key !== key && !this.candidate) {
      this.candidate = { key, theme: options.theme, lease: this.assets.acquireBoard(options.theme, options.profile.backgroundVariant) }
    }
    this.adoptReady()
    this.layoutBackground()
    this.syncAmbience()
    this.positionMotes()
  }

  get animating(): boolean {
    return !this.disposed && this.group.visible && this.motes.length > 0 && this.options?.profile.motion === true
  }

  advance(deltaMs: number): void {
    if (this.disposed) return
    this.adoptReady()
    this.syncAmbience()
    if (this.animating) {
      this.elapsed = (this.elapsed + (Number.isFinite(deltaMs) ? clamp(deltaMs, 0, 100) : 0)) % 600000
      this.positionMotes()
    }
  }

  private adoptReady(): void {
    // A first board has a procedural surface immediately. Later switches wait
    // for raster readiness, including when all network fallbacks have failed.
    if (!this.candidate || (this.current && this.candidate.lease.ready === false)) return
    const previous = this.current
    this.current = this.candidate
    this.candidate = null
    this.material.map = this.current.lease.texture
    this.material.needsUpdate = true
    previous?.lease.release()
    this.layoutBackground()
    this.invalidate()
  }

  private layoutBackground(): void {
    if (!this.options || !this.current) return
    const { width, height } = this.options
    const image = this.current.lease.texture.image as { width?: number; height?: number } | undefined
    const sourceWidth = image?.width && Number.isFinite(image.width) && image.width > 0 ? image.width : 16
    const sourceHeight = image?.height && Number.isFinite(image.height) && image.height > 0 ? image.height : 9
    const crop = computeCoverFitCrop(sourceWidth, sourceHeight, width, height)
    const left = crop.x / sourceWidth
    const right = (crop.x + crop.width) / sourceWidth
    const top = 1 - crop.y / sourceHeight
    const bottom = 1 - (crop.y + crop.height) / sourceHeight
    const uv = this.geometry.attributes.uv
    uv.setXY(0, left, top)
    uv.setXY(1, right, top)
    uv.setXY(2, left, bottom)
    uv.setXY(3, right, bottom)
    uv.needsUpdate = true
    this.background.position.set(width / 2, -height / 2, -0.1)
    this.background.scale.set(width, height, 1)
  }

  private syncAmbience(): void {
    const profile = this.options?.profile
    const requestedCount = profile?.motion && profile.tier !== 'low' && Number.isFinite(profile.ambienceParticles)
      ? clamp(Math.floor(profile.ambienceParticles), 0, 8) : 0
    const theme = this.current?.theme
    if (!requestedCount || !theme || this.current?.lease.ready === false || !this.assets.acquireAmbience) {
      this.clearAmbience()
      return
    }
    if (this.ambience?.theme !== theme) {
      this.clearAmbience()
      this.ambience = { theme, lease: this.assets.acquireAmbience(theme) }
    }
    const count = this.ambience.lease.ready === false ? 0 : requestedCount
    this.moteMaterial.map = count ? this.ambience.lease.texture : null
    this.moteMaterial.opacity = profile?.tier === 'high' ? 0.26 : 0.18
    const previousCount = this.motes.length
    while (this.motes.length > count) this.group.remove(this.motes.pop()!)
    while (this.motes.length < count) {
      const mote = new Mesh(this.moteGeometry, this.moteMaterial)
      this.motes.push(mote)
      this.group.add(mote)
    }
    if (previousCount !== count) {
      this.moteMaterial.needsUpdate = true
      this.positionMotes()
      this.invalidate()
    }
  }

  private positionMotes(): void {
    if (!this.options) return
    const { width, height, profile } = this.options
    for (let index = 0; index < this.motes.length; index++) {
      const phase = this.elapsed / 2800 + index * 1.7
      const mote = this.motes[index]
      mote.position.set(
        width * (index + 1) / (this.motes.length + 1) + Math.sin(phase) * Math.min(12, width * 0.02),
        -height * (0.16 + (index % 4) * 0.18) + Math.cos(phase * 0.7) * 9,
        0.02,
      )
      const size = (profile.tier === 'high' ? 54 : 40) * (0.9 + Math.sin(phase) * 0.1)
      mote.scale.set(size, size, 1)
    }
  }

  private clearAmbience(): void {
    for (const mote of this.motes) this.group.remove(mote)
    this.motes.length = 0
    this.moteMaterial.map = null
    this.ambience?.lease.release()
    this.ambience = null
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearAmbience()
    this.material.map = null
    this.current?.lease.release()
    this.candidate?.lease.release()
    this.current = null
    this.candidate = null
    this.options = null
    this.group.removeFromParent()
    this.group.clear()
    this.geometry.dispose()
    this.material.dispose()
    this.moteGeometry.dispose()
    this.moteMaterial.dispose()
  }
}
