import type Phaser from 'phaser'
import type { BoardTheme } from '../../app/board-theme'
import { DEPTH_BACKGROUND } from './depth'
import type { SceneLayout } from './layout'
import type { PhaserQualityProfile } from './quality'

export interface CoverFitCrop {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface BoardAmbiencePolicy {
  readonly spriteCount: number
  readonly alpha: number
  readonly tweenDurationMs: number
}

export interface BoardBackgroundSyncOptions {
  readonly layout: SceneLayout
  readonly theme: BoardTheme
  readonly profile: PhaserQualityProfile
  readonly backgroundTextureKey: string | null
  readonly backgroundCandidateKeys: readonly string[]
}

export interface BoardBackgroundViewContext {
  readonly scene: Phaser.Scene
}

const AMBIENCE_FRAME = 'ambient-mote'
const THEME_FALLBACK_COLORS: Record<BoardTheme, number> = {
  classic: 0x1b1148,
  moonlit: 0x0d1638,
  verdant: 0x12351f,
}

function positiveFinite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

export function computeCoverFitCrop(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): CoverFitCrop {
  const srcWidth = positiveFinite(sourceWidth)
  const srcHeight = positiveFinite(sourceHeight)
  const dstWidth = positiveFinite(targetWidth)
  const dstHeight = positiveFinite(targetHeight)
  const sourceAspect = srcWidth / srcHeight
  const targetAspect = dstWidth / dstHeight

  if (sourceAspect > targetAspect) {
    const width = srcHeight * targetAspect
    return {
      x: (srcWidth - width) / 2,
      y: 0,
      width,
      height: srcHeight,
    }
  }

  const height = srcWidth / targetAspect
  return {
    x: 0,
    y: (srcHeight - height) / 2,
    width: srcWidth,
    height,
  }
}

// Ambience is a pure projection of the resolved quality profile: the profile
// already folds in reduced motion, animation speed, page visibility, viewport
// size, and the user's render-quality preference.
export function resolveBoardAmbiencePolicy(profile: PhaserQualityProfile): BoardAmbiencePolicy {
  if (profile.ambience === 'off' || profile.maxParticles <= 0) {
    return { spriteCount: 0, alpha: 0, tweenDurationMs: 0 }
  }
  const full = profile.ambience === 'full'
  return {
    spriteCount: profile.maxParticles,
    alpha: full ? 0.28 : 0.18,
    tweenDurationMs: full ? 2600 : 3600,
  }
}

export class BoardBackgroundView {
  private readonly scene: Phaser.Scene
  private container: Phaser.GameObjects.Container | null = null
  private fallback: Phaser.GameObjects.Rectangle | null = null
  private background: Phaser.GameObjects.Image | null = null
  private currentTextureKey: string | null = null
  private readonly knownBackgroundKeys = new Set<string>()
  private readonly ambienceSprites: Phaser.GameObjects.Sprite[] = []
  private readonly ambienceTweens: Phaser.Tweens.Tween[] = []
  private ambienceTweenSignature: string | null = null

  constructor(ctx: BoardBackgroundViewContext) {
    this.scene = ctx.scene
  }

  sync(options: BoardBackgroundSyncOptions): void {
    const container = this.ensureContainer()
    this.syncFallback(container, options)
    this.syncBackground(container, options)
    this.syncAmbience(container, options)
    this.evictUnusedBackgroundTextures(options.backgroundTextureKey, options.backgroundCandidateKeys)
  }

  destroy(): void {
    this.clearAmbienceTweens()
    this.container?.destroy(true)
    for (const key of this.knownBackgroundKeys) {
      if (this.scene.textures.exists(key)) {
        this.scene.textures.remove(key)
      }
    }
    this.container = null
    this.fallback = null
    this.background = null
    this.currentTextureKey = null
    this.knownBackgroundKeys.clear()
    this.ambienceSprites.length = 0
    this.ambienceTweenSignature = null
  }

  private ensureContainer(): Phaser.GameObjects.Container {
    if (!this.container) {
      this.container = this.scene.add.container(0, 0)
      this.container.setDepth(DEPTH_BACKGROUND)
    }
    return this.container
  }

  private syncFallback(
    container: Phaser.GameObjects.Container,
    options: BoardBackgroundSyncOptions,
  ): void {
    if (!this.fallback) {
      this.fallback = this.scene.add.rectangle(0, 0, options.layout.width, options.layout.height, THEME_FALLBACK_COLORS[options.theme])
      this.fallback.setOrigin(0, 0)
      container.add(this.fallback)
    }
    this.fallback
      .setPosition(0, 0)
      .setSize(options.layout.width, options.layout.height)
      .setFillStyle(THEME_FALLBACK_COLORS[options.theme])
      .setVisible(true)
  }

  private syncBackground(
    container: Phaser.GameObjects.Container,
    options: BoardBackgroundSyncOptions,
  ): void {
    const textureKey = this.textureExists(options.backgroundTextureKey)
      ? options.backgroundTextureKey
      : null

    if (textureKey === null) {
      this.background?.setVisible(false)
      this.currentTextureKey = null
      return
    }

    if (!this.background) {
      this.background = this.scene.add.image(0, 0, textureKey)
      this.background.setOrigin(0.5, 0.5)
      container.add(this.background)
    } else if (this.currentTextureKey !== textureKey) {
      this.background.setTexture(textureKey)
    }

    this.currentTextureKey = textureKey
    this.knownBackgroundKeys.add(textureKey)

    const source = this.textureSize(textureKey)
    const crop = computeCoverFitCrop(source.width, source.height, options.layout.width, options.layout.height)
    this.background
      .setVisible(true)
      .setPosition(options.layout.width / 2, options.layout.height / 2)
      .setCrop(crop.x, crop.y, crop.width, crop.height)
      .setScale(
        options.layout.width / crop.width,
        options.layout.height / crop.height,
      )
  }

  private syncAmbience(
    container: Phaser.GameObjects.Container,
    options: BoardBackgroundSyncOptions,
  ): void {
    const atlasKey = `board-atlas:ambience:${options.theme}`
    const policy = resolveBoardAmbiencePolicy(options.profile)
    const availableCount = this.textureHasFrame(atlasKey, AMBIENCE_FRAME)
      ? policy.spriteCount
      : 0

    while (this.ambienceSprites.length > availableCount) {
      this.ambienceSprites.pop()?.destroy()
    }
    while (this.ambienceSprites.length < availableCount) {
      const sprite = this.scene.add.sprite(0, 0, atlasKey, AMBIENCE_FRAME)
      sprite.setBlendMode('ADD')
      container.add(sprite)
      this.ambienceSprites.push(sprite)
    }

    for (let index = 0; index < this.ambienceSprites.length; index += 1) {
      const sprite = this.ambienceSprites[index]
      const ratio = (index + 1) / (this.ambienceSprites.length + 1)
      const x = options.layout.safeAreaLeft + options.layout.safeAreaWidth * ratio
      const y = options.layout.safeAreaTop + options.layout.safeAreaHeight * (0.16 + (index % 4) * 0.18)
      sprite
        .setTexture(atlasKey, AMBIENCE_FRAME)
        .setVisible(true)
        .setPosition(x, y)
        .setScale(options.profile.ambience === 'full' ? 1.2 : 0.9)
        .setAlpha(policy.alpha)
    }

    const tweenSignature = `${options.theme}:${options.profile.tier}:${options.profile.ambience}:${availableCount}:${policy.alpha}:${policy.tweenDurationMs}`
    if (tweenSignature === this.ambienceTweenSignature) {
      return
    }
    this.clearAmbienceTweens()
    this.ambienceTweenSignature = tweenSignature
    if (availableCount === 0 || policy.tweenDurationMs <= 0) {
      return
    }
    for (let index = 0; index < this.ambienceSprites.length; index += 1) {
      this.ambienceTweens.push(this.scene.tweens.add({
        targets: this.ambienceSprites[index],
        alpha: { from: policy.alpha * 0.45, to: policy.alpha },
        duration: policy.tweenDurationMs,
        delay: index * 120,
        yoyo: true,
        repeat: -1,
      }))
    }
  }

  private clearAmbienceTweens(): void {
    for (const tween of this.ambienceTweens) {
      tween.remove()
    }
    this.ambienceTweens.length = 0
  }

  private evictUnusedBackgroundTextures(
    activeTextureKey: string | null,
    candidateKeys: readonly string[],
  ): void {
    for (const key of candidateKeys) {
      if (this.scene.textures.exists(key)) {
        this.knownBackgroundKeys.add(key)
      }
    }
    for (const key of [...this.knownBackgroundKeys]) {
      if (key === activeTextureKey) {
        continue
      }
      if (this.scene.textures.exists(key)) {
        this.scene.textures.remove(key)
      }
      this.knownBackgroundKeys.delete(key)
    }
  }

  private textureExists(key: string | null): key is string {
    return key !== null && this.scene.textures.exists(key)
  }

  private textureHasFrame(key: string, frame: string): boolean {
    return this.scene.textures.exists(key) && this.scene.textures.get(key).has(frame)
  }

  private textureSize(key: string): { width: number; height: number } {
    const texture = this.scene.textures.get(key)
    const source = texture.getSourceImage()
    return {
      width: positiveFinite(source.width),
      height: positiveFinite(source.height),
    }
  }
}
