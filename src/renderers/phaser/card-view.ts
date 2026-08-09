import type Phaser from 'phaser'
import { durationMsForSpeed } from '../../app/animation-settings'
import { CARD_BACK_KEY } from '../../app/card-art'
import type { AnimationSpeed, CardVisualStyle } from '../../app/types'
import { HIDDEN_HAND_CARD_NAME } from '../../app/types'
import { isBasicLand } from '../../game/types'
import { renderStaticCard } from './card-factory'
import { resolveRasterCardArtTextureKey } from './card-rendering'
import { DEPTH_GAMEPLAY } from './depth'
import type { SceneLayout } from './layout'

export type CardViewZone = 'hand' | 'battlefield'

export interface CardViewDescriptor {
  readonly cardId: string
  readonly instanceId: string | null
  readonly playerIndex: number
  readonly zone: CardViewZone
  readonly name: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly highlight: boolean
  readonly draggable: boolean
  readonly preview: boolean
  readonly onClick?: () => void
  readonly interactionKey: string
}

export interface CardViewSyncOptions extends CardViewDescriptor {
  readonly layout: SceneLayout
  readonly visualStyle: CardVisualStyle
  readonly animationSpeed: AnimationSpeed
}

export interface CardViewContext {
  readonly scene: Phaser.Scene
  readonly renderCard?: typeof renderStaticCard
  readonly bindPreview?: (
    card: Phaser.GameObjects.Container,
    label: string,
    dimensions: { width: number; height: number },
  ) => void
}

const MAX_CARD_MOVE_DURATION_MS = 400
const PROCEDURAL_CARD_FACE = 'procedural-card-face'
const PROCEDURAL_CARD_BACK = 'procedural-card-back'

export function cardMoveDurationMs(speed: AnimationSpeed): number {
  return Math.min(durationMsForSpeed(speed), MAX_CARD_MOVE_DURATION_MS)
}

export function cardFaceTextureSignature(
  label: string,
  visualStyle: CardVisualStyle,
  textureExists: (key: string) => boolean,
): string {
  if (label === HIDDEN_HAND_CARD_NAME) {
    return textureExists(CARD_BACK_KEY) ? CARD_BACK_KEY : PROCEDURAL_CARD_BACK
  }
  if (!isBasicLand(label)) {
    return PROCEDURAL_CARD_FACE
  }
  return resolveRasterCardArtTextureKey(label, visualStyle, textureExists)
    ?? PROCEDURAL_CARD_FACE
}

export class CardView {
  readonly container: Phaser.GameObjects.Container

  private readonly scene: Phaser.Scene
  private readonly renderCard: typeof renderStaticCard
  private readonly bindPreview: CardViewContext['bindPreview']
  private appearanceSignature: string | null = null
  private interactionSignature: string | null = null
  private assignedCardId: string | null = null
  private targetX = 0
  private targetY = 0
  private moveTween: Phaser.Tweens.Tween | null = null
  private destroyed = false

  constructor(ctx: CardViewContext) {
    this.scene = ctx.scene
    this.renderCard = ctx.renderCard ?? renderStaticCard
    this.bindPreview = ctx.bindPreview
    this.container = this.scene.add.container(0, 0)
    this.container.setVisible(false)
  }

  get cardId(): string | null {
    return this.assignedCardId
  }

  sync(options: CardViewSyncOptions): void {
    if (this.destroyed) {
      return
    }

    const wasAssigned = this.assignedCardId !== null
    this.assignedCardId = options.cardId
    this.container
      .setVisible(true)
      .setAlpha(1)
      .setDepth(DEPTH_GAMEPLAY)
      .setScale(1)
      .setRotation(0)
      .setSize(options.width, options.height)
    this.container.setData('cardId', options.cardId)
    this.container.setData('instanceId', options.instanceId)
    this.container.setData('playerIndex', options.playerIndex)
    this.container.setData('zone', options.zone)
    this.container.setData('originX', options.x)
    this.container.setData('originY', options.y)

    const textureSignature = cardFaceTextureSignature(
      options.name,
      options.visualStyle,
      (key) => this.scene.textures?.exists(key) ?? false,
    )
    const appearanceSignature = [
      options.name,
      options.visualStyle,
      textureSignature,
      options.width,
      options.height,
      options.layout.bodyFontSize,
      options.layout.titleFontSize,
      options.highlight ? 1 : 0,
    ].join(':')
    if (appearanceSignature !== this.appearanceSignature) {
      this.container.removeAll(true)
      const face = this.renderCard(
        this.scene,
        options.layout,
        0,
        0,
        options.name,
        {
          highlight: options.highlight,
          dimensions: { width: options.width, height: options.height },
        },
        options.visualStyle,
      )
      face.setPosition(0, 0)
      this.container.add(face)
      this.appearanceSignature = appearanceSignature
    }

    this.syncInteraction(options)
    this.syncPosition(options, wasAssigned)
  }

  resetForPool(): void {
    if (this.destroyed) {
      return
    }
    this.cancelMoveTween()
    this.clearInteraction()
    this.container.removeAll(true)
    this.container.data?.reset()
    this.container
      .setVisible(false)
      .setAlpha(1)
      .setDepth(DEPTH_GAMEPLAY)
      .setScale(1)
      .setRotation(0)
      .setPosition(0, 0)
      .setSize(0, 0)
    this.appearanceSignature = null
    this.interactionSignature = null
    this.assignedCardId = null
    this.targetX = 0
    this.targetY = 0
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.resetForPool()
    this.destroyed = true
    this.container.destroy(true)
  }

  private syncInteraction(options: CardViewSyncOptions): void {
    const signature = [
      options.interactionKey,
      options.draggable ? 1 : 0,
      options.preview ? 1 : 0,
      options.onClick ? 1 : 0,
      options.width,
      options.height,
    ].join(':')
    if (signature === this.interactionSignature) {
      return
    }

    this.clearInteraction()
    if (options.draggable || options.preview || options.onClick) {
      this.container.setInteractive({ useHandCursor: true })
    }
    if (options.draggable) {
      this.scene.input.setDraggable(this.container)
    }
    if (options.onClick) {
      this.container.on('pointerup', options.onClick)
    }
    if (options.preview) {
      this.bindPreview?.(
        this.container,
        options.name,
        { width: options.width, height: options.height },
      )
    }
    this.interactionSignature = signature
  }

  private clearInteraction(): void {
    if (this.container.input) {
      this.scene.input.setDraggable(this.container, false)
    }
    this.container.disableInteractive()
    this.container.removeAllListeners()
  }

  private syncPosition(options: CardViewSyncOptions, wasAssigned: boolean): void {
    const positionChanged = options.x !== this.targetX || options.y !== this.targetY
    this.targetX = options.x
    this.targetY = options.y

    if (!wasAssigned) {
      this.cancelMoveTween()
      this.container.setPosition(options.x, options.y)
      return
    }

    const duration = cardMoveDurationMs(options.animationSpeed)
    if (!positionChanged) {
      if (duration === 0 && this.moveTween) {
        this.cancelMoveTween()
        this.container.setPosition(options.x, options.y)
      }
      return
    }

    this.cancelMoveTween()
    if (duration === 0) {
      this.container.setPosition(options.x, options.y)
      return
    }

    const tween = this.scene.tweens.add({
      targets: this.container,
      x: options.x,
      y: options.y,
      duration,
      ease: 'Cubic.Out',
      onComplete: () => {
        if (this.moveTween !== tween) {
          return
        }
        this.container.setPosition(this.targetX, this.targetY)
        this.moveTween = null
      },
    })
    this.moveTween = tween
  }

  private cancelMoveTween(): void {
    this.moveTween?.remove()
    this.moveTween = null
  }
}
