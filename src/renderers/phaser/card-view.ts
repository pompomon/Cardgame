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
  // Adaptive quality policy (see quality.ts). When false, positions snap
  // instead of tweening — used for the low tier, reduced motion, and hidden
  // tabs. Defaults to enabled so existing call sites keep their behaviour.
  readonly enableMoveTweens?: boolean
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

export interface CardViewDragSource {
  readonly cardId: string
  readonly name: string
  readonly width: number
  readonly height: number
  readonly container: Phaser.GameObjects.Container
}

const MAX_CARD_MOVE_DURATION_MS = 400
const DRAG_SOURCE_ALPHA = 0.35
const PROCEDURAL_CARD_FACE = 'procedural-card-face'
const PROCEDURAL_CARD_BACK = 'procedural-card-back'
const CARD_VIEW_INTERACTION_EVENTS = [
  'pointerdown',
  'pointerup',
  'pointerover',
  'pointerout',
  'dragstart',
  'dragend',
] as const

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
  private assignedName: string | null = null
  private assignedWidth = 0
  private assignedHeight = 0
  private targetX = 0
  private targetY = 0
  private moveDurationMs = 0
  private moveTween: Phaser.Tweens.Tween | null = null
  private dragging = false
  private draggable = false
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

  getDragSource(): CardViewDragSource | null {
    if (
      this.destroyed
      || !this.draggable
      || this.assignedCardId === null
      || this.assignedName === null
    ) {
      return null
    }
    return {
      cardId: this.assignedCardId,
      name: this.assignedName,
      width: this.assignedWidth,
      height: this.assignedHeight,
      container: this.container,
    }
  }

  sync(options: CardViewSyncOptions): void {
    if (this.destroyed) {
      return
    }

    const wasAssigned = this.assignedCardId !== null
    this.assignedCardId = options.cardId
    this.assignedName = options.name
    this.assignedWidth = options.width
    this.assignedHeight = options.height
    this.container
      .setVisible(true)
      .setAlpha(this.dragging ? DRAG_SOURCE_ALPHA : 1)
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
    this.draggable = options.draggable

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

  beginDrag(): boolean {
    if (
      this.destroyed
      || this.dragging
      || !this.draggable
      || this.assignedCardId === null
    ) {
      return false
    }
    this.cancelMoveTween()
    this.dragging = true
    this.container.setAlpha(DRAG_SOURCE_ALPHA)
    this.container.emit('dragstart')
    return true
  }

  endDrag(animateToTarget: boolean): void {
    if (!this.dragging) {
      return
    }
    this.dragging = false
    this.container.setAlpha(1)
    this.container.emit('dragend')
    if (animateToTarget) {
      this.moveToTarget()
    } else {
      this.cancelMoveTween()
      this.container.setPosition(this.targetX, this.targetY)
    }
  }

  cancelDrag(): void {
    if (!this.dragging) {
      return
    }
    this.endDrag(false)
  }

  resetForPool(): void {
    if (this.destroyed) {
      return
    }
    this.cancelDrag()
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
    this.resizeHitArea(0, 0)
    this.appearanceSignature = null
    this.interactionSignature = null
    this.assignedCardId = null
    this.assignedName = null
    this.assignedWidth = 0
    this.assignedHeight = 0
    this.targetX = 0
    this.targetY = 0
    this.moveDurationMs = 0
    this.dragging = false
    this.draggable = false
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
      if (this.container.input) {
        this.container.setInteractive()
      } else {
        this.container.setInteractive({ useHandCursor: true })
      }
      this.resizeHitArea(options.width, options.height)
    }
    if (options.onClick) {
      let pointerDown = false
      let pointerId: number | null = null
      const clearPointer = (): void => {
        pointerDown = false
        pointerId = null
      }
      this.container.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        pointerDown = true
        pointerId = Number.isInteger(pointer?.id) ? pointer.id : null
      })
      this.container.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        const releasedPointerId = Number.isInteger(pointer?.id) ? pointer.id : null
        const matchesPointer = pointerDown
          && pointer.wasCanceled !== true
          && (pointerId === null || releasedPointerId === null || pointerId === releasedPointerId)
        clearPointer()
        if (matchesPointer) {
          options.onClick?.()
        }
      })
      this.container.on('pointerout', clearPointer)
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
      this.container.disableInteractive(true)
    }
    for (const event of CARD_VIEW_INTERACTION_EVENTS) {
      this.container.removeAllListeners(event)
    }
  }

  private resizeHitArea(width: number, height: number): void {
    const hitArea = this.container.input?.hitArea
    if (hitArea && typeof hitArea.setSize === 'function') {
      hitArea.setSize(width, height)
    }
  }

  private syncPosition(options: CardViewSyncOptions, wasAssigned: boolean): void {
    const positionChanged = options.x !== this.targetX || options.y !== this.targetY
    this.targetX = options.x
    this.targetY = options.y
    this.moveDurationMs = options.enableMoveTweens === false
      ? 0
      : cardMoveDurationMs(options.animationSpeed)

    if (!wasAssigned) {
      this.cancelMoveTween()
      this.container.setPosition(options.x, options.y)
      return
    }

    if (this.dragging) {
      return
    }

    if (!positionChanged) {
      if (this.moveDurationMs === 0 && this.moveTween) {
        this.cancelMoveTween()
        this.container.setPosition(options.x, options.y)
      } else if (
        !this.moveTween
        && (this.container.x !== this.targetX || this.container.y !== this.targetY)
      ) {
        this.container.setPosition(this.targetX, this.targetY)
      }
      return
    }

    this.moveToTarget()
  }

  private moveToTarget(): void {
    this.cancelMoveTween()
    if (
      this.moveDurationMs === 0
      || (this.container.x === this.targetX && this.container.y === this.targetY)
    ) {
      this.container.setPosition(this.targetX, this.targetY)
      return
    }

    const tween = this.scene.tweens.add({
      targets: this.container,
      x: this.targetX,
      y: this.targetY,
      duration: this.moveDurationMs,
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
