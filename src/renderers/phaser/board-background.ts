import { durationMsForSpeed } from '../../app/animation-settings'
import { BOARD_BACKGROUND_VARIANTS } from '../../app/board-assets'
import { BOARD_THEMES, type BoardTheme } from '../../app/board-theme'
import type { RenderQualityPreference } from '../../app/render-quality'
import type { AnimationSpeed } from '../../app/types'
import type Phaser from 'phaser'
import {
  AMBIENCE_ATLAS_FRAMES,
  boardAmbienceTextureKey,
  boardBackgroundTextureKey,
  buildPhaserBoardAssetManifest,
  resolveLoadedBoardBackgroundTextureKey,
} from './asset-manifest'
import { DEPTH_BOARD_AMBIENCE, DEPTH_BOARD_BACKGROUND } from './depth'
import { clamp } from './layout'
import {
  MAX_BOARD_AMBIENCE_SPRITES,
  resolveBoardAmbienceSpriteCount,
} from './quality'
import { computeCoverCrop } from './rounded-cover'

const SCENE_UPDATE_EVENT = 'update'
const VISIBILITY_CHANGE_EVENT = 'visibilitychange'
const DETACHED_TEXTURE_KEY = '__WHITE'

const FALLBACK_COLORS: Readonly<Record<BoardTheme, number>> = Object.freeze({
  classic: 0x2c1f38,
  moonlit: 0x111d3b,
  verdant: 0x173629,
})

interface AmbiencePoint {
  readonly xRatio: number
  readonly yRatio: number
  readonly phase: number
  readonly speed: number
  readonly scale: number
}

const AMBIENCE_POINTS: readonly AmbiencePoint[] = Object.freeze([
  { xRatio: 0.08, yRatio: 0.18, phase: 0.2, speed: 0.44, scale: 0.62 },
  { xRatio: 0.22, yRatio: 0.78, phase: 1.1, speed: 0.31, scale: 0.48 },
  { xRatio: 0.37, yRatio: 0.31, phase: 2.4, speed: 0.38, scale: 0.56 },
  { xRatio: 0.51, yRatio: 0.67, phase: 3.2, speed: 0.29, scale: 0.7 },
  { xRatio: 0.66, yRatio: 0.15, phase: 4.5, speed: 0.4, scale: 0.52 },
  { xRatio: 0.82, yRatio: 0.72, phase: 5.3, speed: 0.34, scale: 0.64 },
  { xRatio: 0.93, yRatio: 0.36, phase: 0.8, speed: 0.27, scale: 0.46 },
  { xRatio: 0.14, yRatio: 0.51, phase: 2, speed: 0.36, scale: 0.58 },
  { xRatio: 0.73, yRatio: 0.49, phase: 3.9, speed: 0.32, scale: 0.5 },
  { xRatio: 0.44, yRatio: 0.9, phase: 5.8, speed: 0.25, scale: 0.66 },
])

interface VisibilityDocument {
  readonly hidden: boolean
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

interface BackgroundTransition {
  readonly fromIndex: number
  readonly toIndex: number
  readonly fromTextureKey: string
  readonly toTextureKey: string
  readonly durationMs: number
  elapsedMs: number
}

export interface BoardBackgroundSyncState {
  readonly width: number
  readonly height: number
  readonly theme: BoardTheme
  readonly quality: RenderQualityPreference
  readonly animationSpeed: AnimationSpeed
  readonly reducedMotion: boolean
}

export interface BoardBackgroundFit {
  readonly sourceX: number
  readonly sourceY: number
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly scale: number
  readonly centerX: number
  readonly centerY: number
}

export interface BoardBackgroundViewOptions {
  readonly visibilityDocument?: VisibilityDocument | null
}

function positiveDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

export function computeBoardBackgroundFit(
  sourceWidth: number,
  sourceHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): BoardBackgroundFit {
  const safeSourceWidth = positiveDimension(sourceWidth)
  const safeSourceHeight = positiveDimension(sourceHeight)
  const safeViewportWidth = positiveDimension(viewportWidth)
  const safeViewportHeight = positiveDimension(viewportHeight)
  const crop = computeCoverCrop(
    safeSourceWidth,
    safeSourceHeight,
    safeViewportWidth,
    safeViewportHeight,
  )
  return {
    ...crop,
    scale: safeViewportWidth / crop.sourceWidth,
    centerX: safeViewportWidth / 2,
    centerY: safeViewportHeight / 2,
  }
}

function browserVisibilityDocument(): VisibilityDocument | null {
  if (typeof document === 'undefined') {
    return null
  }
  return document as unknown as VisibilityDocument
}

export class BoardBackgroundView {
  private readonly scene: Phaser.Scene
  private readonly visibilityDocument: VisibilityDocument | null
  private readonly placeholder: Phaser.GameObjects.Rectangle
  private readonly backgroundLayers: Phaser.GameObjects.Image[] = []
  private readonly ambienceSprites: Phaser.GameObjects.Image[] = []
  private activeLayerIndex = 0
  private activeTextureKey: string | null = null
  private transition: BackgroundTransition | null = null
  private width = 1
  private height = 1
  private theme: BoardTheme | null = null
  private quality: RenderQualityPreference = 'low'
  private animationSpeed: AnimationSpeed = 'off'
  private reducedMotion = true
  private pageVisible = true
  private activeAmbienceCount = 0
  private ambienceElapsedMs = 0
  private destroyed = false

  private readonly onUpdate = (_time: number, delta: number): void => {
    if (this.destroyed) {
      return
    }
    this.advanceTransition(delta)
    this.advanceAmbience(delta)
  }

  private readonly onVisibilityChange = (): void => {
    this.pageVisible = !(this.visibilityDocument?.hidden ?? false)
    if (!this.motionAllowed() && this.transition) {
      this.applyImmediateTexture(this.transition.toTextureKey)
    }
    this.syncAmbience()
  }

  constructor(scene: Phaser.Scene, options: BoardBackgroundViewOptions = {}) {
    this.scene = scene
    this.visibilityDocument = options.visibilityDocument === undefined
      ? browserVisibilityDocument()
      : options.visibilityDocument
    this.pageVisible = !(this.visibilityDocument?.hidden ?? false)
    this.placeholder = scene.add
      .rectangle(0, 0, 1, 1, FALLBACK_COLORS.classic, 1)
      .setOrigin(0.5)
      .setDepth(DEPTH_BOARD_BACKGROUND)
    this.scene.events.on(SCENE_UPDATE_EVENT, this.onUpdate)
    this.visibilityDocument?.addEventListener(
      VISIBILITY_CHANGE_EVENT,
      this.onVisibilityChange,
    )
  }

  sync(state: BoardBackgroundSyncState): void {
    if (this.destroyed) {
      return
    }

    const width = positiveDimension(state.width)
    const height = positiveDimension(state.height)
    const layoutChanged = width !== this.width || height !== this.height
    const assetSelectionChanged = state.theme !== this.theme
      || state.quality !== this.quality
      || this.activeTextureKey === null

    this.width = width
    this.height = height
    this.theme = state.theme
    this.quality = state.quality
    this.animationSpeed = state.animationSpeed
    this.reducedMotion = state.reducedMotion
    this.placeholder
      .setPosition(width / 2, height / 2)
      .setDisplaySize(width, height)
      .setFillStyle(FALLBACK_COLORS[state.theme], 1)

    if (layoutChanged) {
      this.applyFitToBackgroundLayers()
    }

    if (assetSelectionChanged) {
      const manifest = buildPhaserBoardAssetManifest(state.theme, state.quality)
      const textureKey = resolveLoadedBoardBackgroundTextureKey(
        manifest,
        (key) => this.scene.textures.exists(key),
      )
      this.setBackgroundTexture(textureKey)
    } else if (!this.motionAllowed() && this.transition) {
      this.applyImmediateTexture(this.transition.toTextureKey)
    }

    this.syncAmbience()
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    this.scene.events.off(SCENE_UPDATE_EVENT, this.onUpdate)
    this.visibilityDocument?.removeEventListener(
      VISIBILITY_CHANGE_EVENT,
      this.onVisibilityChange,
    )
    this.transition = null
    for (const sprite of this.ambienceSprites) {
      sprite.destroy()
    }
    this.ambienceSprites.length = 0
    for (const layer of this.backgroundLayers) {
      layer.destroy()
    }
    this.backgroundLayers.length = 0
    this.placeholder.destroy()
    this.evictUnusedBackgroundTextures(new Set())
    this.activeTextureKey = null
    this.activeAmbienceCount = 0
  }

  private motionAllowed(): boolean {
    return this.pageVisible
      && !this.reducedMotion
      && this.animationSpeed !== 'off'
      && this.quality !== 'low'
  }

  private setBackgroundTexture(textureKey: string | null): void {
    if (textureKey === null) {
      this.clearBackgroundTexture()
      return
    }
    if (this.transition?.toTextureKey === textureKey || this.activeTextureKey === textureKey) {
      return
    }
    this.ensureBackgroundLayers(textureKey)
    const durationMs = this.motionAllowed()
      ? durationMsForSpeed(this.animationSpeed)
      : 0
    if (this.activeTextureKey === null || durationMs <= 0) {
      this.applyImmediateTexture(textureKey)
      return
    }
    this.startTransition(textureKey, durationMs)
  }

  private ensureBackgroundLayers(textureKey: string): void {
    if (this.backgroundLayers.length > 0) {
      return
    }
    for (let index = 0; index < 2; index += 1) {
      const layer = this.scene.add
        .image(this.width / 2, this.height / 2, textureKey)
        .setOrigin(0.5)
        .setDepth(DEPTH_BOARD_BACKGROUND)
        .setVisible(index === 0)
        .setAlpha(index === 0 ? 1 : 0)
      this.backgroundLayers.push(layer)
    }
    this.activeLayerIndex = 0
    this.activeTextureKey = textureKey
    this.applyFitToBackgroundLayers()
  }

  private clearBackgroundTexture(): void {
    this.transition = null
    for (const layer of this.backgroundLayers) {
      layer
        .setTexture(DETACHED_TEXTURE_KEY)
        .setVisible(false)
        .setAlpha(0)
    }
    this.activeTextureKey = null
    this.evictUnusedBackgroundTextures(new Set())
  }

  private applyImmediateTexture(textureKey: string): void {
    this.transition = null
    const activeLayer = this.backgroundLayers[this.activeLayerIndex]
    for (const layer of this.backgroundLayers) {
      layer.setTexture(textureKey)
      this.applyFit(layer, textureKey)
      layer.setVisible(layer === activeLayer).setAlpha(layer === activeLayer ? 1 : 0)
    }
    this.activeTextureKey = textureKey
    this.evictUnusedBackgroundTextures(new Set([textureKey]))
  }

  private startTransition(textureKey: string, durationMs: number): void {
    if (this.transition) {
      this.completeTransition()
    }
    const fromTextureKey = this.activeTextureKey
    if (fromTextureKey === null || fromTextureKey === textureKey) {
      this.applyImmediateTexture(textureKey)
      return
    }

    const fromIndex = this.activeLayerIndex
    const toIndex = fromIndex === 0 ? 1 : 0
    const fromLayer = this.backgroundLayers[fromIndex]
    const toLayer = this.backgroundLayers[toIndex]
    fromLayer.setVisible(true).setAlpha(1)
    toLayer.setTexture(textureKey).setVisible(true).setAlpha(0)
    this.applyFit(toLayer, textureKey)
    this.transition = {
      fromIndex,
      toIndex,
      fromTextureKey,
      toTextureKey: textureKey,
      durationMs,
      elapsedMs: 0,
    }
    this.evictUnusedBackgroundTextures(new Set([fromTextureKey, textureKey]))
  }

  private advanceTransition(delta: number): void {
    const transition = this.transition
    if (!transition) {
      return
    }
    const safeDelta = Number.isFinite(delta) && delta > 0 ? delta : 0
    transition.elapsedMs += safeDelta
    const progress = clamp(
      transition.elapsedMs / transition.durationMs,
      0,
      1,
    )
    this.backgroundLayers[transition.fromIndex].setAlpha(1 - progress)
    this.backgroundLayers[transition.toIndex].setAlpha(progress)
    if (progress >= 1) {
      this.completeTransition()
    }
  }

  private completeTransition(): void {
    const transition = this.transition
    if (!transition) {
      return
    }
    const fromLayer = this.backgroundLayers[transition.fromIndex]
    const toLayer = this.backgroundLayers[transition.toIndex]
    toLayer.setVisible(true).setAlpha(1)
    fromLayer
      .setTexture(transition.toTextureKey)
      .setVisible(false)
      .setAlpha(0)
    this.activeLayerIndex = transition.toIndex
    this.activeTextureKey = transition.toTextureKey
    this.transition = null
    this.evictUnusedBackgroundTextures(new Set([transition.toTextureKey]))
  }

  private applyFitToBackgroundLayers(): void {
    for (const layer of this.backgroundLayers) {
      const textureKey = layer.texture.key
      if (textureKey !== DETACHED_TEXTURE_KEY && this.scene.textures.exists(textureKey)) {
        this.applyFit(layer, textureKey)
      }
    }
  }

  private applyFit(layer: Phaser.GameObjects.Image, textureKey: string): void {
    const frame = this.scene.textures.getFrame(textureKey)
    const fit = computeBoardBackgroundFit(
      frame.realWidth,
      frame.realHeight,
      this.width,
      this.height,
    )
    layer
      .setPosition(fit.centerX, fit.centerY)
      .setScale(fit.scale)
      .setCrop(
        fit.sourceX,
        fit.sourceY,
        fit.sourceWidth,
        fit.sourceHeight,
      )
  }

  private evictUnusedBackgroundTextures(keep: ReadonlySet<string>): void {
    for (const theme of BOARD_THEMES) {
      for (const variant of BOARD_BACKGROUND_VARIANTS) {
        const key = boardBackgroundTextureKey(theme, variant)
        if (!keep.has(key) && this.scene.textures.exists(key)) {
          this.scene.textures.remove(key)
        }
      }
    }
  }

  private syncAmbience(): void {
    if (this.theme === null || this.destroyed) {
      return
    }
    const requestedCount = resolveBoardAmbienceSpriteCount({
      width: this.width,
      height: this.height,
      quality: this.quality,
      animationSpeed: this.animationSpeed,
      reducedMotion: this.reducedMotion,
      pageVisible: this.pageVisible,
    })
    const atlasKey = boardAmbienceTextureKey(this.theme)
    if (requestedCount <= 0 || !this.scene.textures.exists(atlasKey)) {
      this.activeAmbienceCount = 0
      for (const sprite of this.ambienceSprites) {
        sprite.setVisible(false)
      }
      return
    }

    this.ensureAmbienceSprites(requestedCount, atlasKey)
    const opacity = this.quality === 'high' ? 0.3 : 0.2
    for (let index = 0; index < this.ambienceSprites.length; index += 1) {
      const sprite = this.ambienceSprites[index]
      const active = index < requestedCount
      if (active) {
        sprite
          .setTexture(
            atlasKey,
            AMBIENCE_ATLAS_FRAMES[index % AMBIENCE_ATLAS_FRAMES.length],
          )
          .setAlpha(opacity * (index % 2 === 0 ? 1 : 0.72))
      }
      sprite.setVisible(active)
    }
    this.activeAmbienceCount = requestedCount
    this.positionAmbience()
  }

  private ensureAmbienceSprites(count: number, atlasKey: string): void {
    const boundedCount = Math.min(
      count,
      MAX_BOARD_AMBIENCE_SPRITES,
      AMBIENCE_POINTS.length,
    )
    while (this.ambienceSprites.length < boundedCount) {
      const index = this.ambienceSprites.length
      const sprite = this.scene.add
        .image(
          0,
          0,
          atlasKey,
          AMBIENCE_ATLAS_FRAMES[index % AMBIENCE_ATLAS_FRAMES.length],
        )
        .setOrigin(0.5)
        .setDepth(DEPTH_BOARD_AMBIENCE)
      this.ambienceSprites.push(sprite)
    }
  }

  private advanceAmbience(delta: number): void {
    if (this.activeAmbienceCount <= 0) {
      return
    }
    const safeDelta = Number.isFinite(delta) && delta > 0 ? delta : 0
    this.ambienceElapsedMs = (this.ambienceElapsedMs + safeDelta) % 600_000
    this.positionAmbience()
  }

  private positionAmbience(): void {
    const seconds = this.ambienceElapsedMs / 1_000
    const shortEdge = Math.min(this.width, this.height)
    const drift = clamp(shortEdge * 0.025, 4, 22)
    const viewportScale = clamp(shortEdge / 800, 0.45, 1.25)
    for (let index = 0; index < this.activeAmbienceCount; index += 1) {
      const point = AMBIENCE_POINTS[index]
      const sprite = this.ambienceSprites[index]
      const phase = seconds * point.speed + point.phase
      sprite
        .setPosition(
          point.xRatio * this.width + Math.sin(phase) * drift,
          point.yRatio * this.height + Math.cos(phase * 0.8) * drift,
        )
        .setScale(point.scale * viewportScale)
        .setRotation(Math.sin(phase * 0.6) * 0.08)
    }
  }
}
