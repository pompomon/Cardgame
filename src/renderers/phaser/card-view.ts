import type Phaser from 'phaser'
import type { AppViewModel } from '../../app/types'
import { DEPTH_GAMEPLAY } from './depth'
import type { SceneLayout } from './layout'

const MOVE_TWEEN_DURATION_MS = 140

export interface CardViewRenderCardOptions {
  readonly scene: Phaser.Scene
  readonly layout: SceneLayout
  readonly label: string
  readonly visualStyle: AppViewModel['cardVisualStyle']
  readonly highlight: boolean
  readonly dimensions: { width: number; height: number }
}

export type CardViewRenderCard = (options: CardViewRenderCardOptions) => Phaser.GameObjects.Container

export interface CardViewSyncOptions {
  readonly cardId: string
  readonly instanceId?: string
  readonly zone: 'hand' | 'battlefield'
  readonly label: string
  readonly layout: SceneLayout
  readonly visualStyle: AppViewModel['cardVisualStyle']
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly highlight?: boolean
  readonly draggable?: boolean
  readonly animate?: boolean
  readonly onClick?: () => void
  readonly bindPreview?: (
    card: Phaser.GameObjects.Container,
    label: string,
    dimensions: { width: number; height: number },
  ) => void
}

function resetData(container: Phaser.GameObjects.Container): void {
  const dataManager = (container as { data?: { reset?: () => void } }).data
  dataManager?.reset?.()
}

export class CardView {
  readonly container: Phaser.GameObjects.Container

  private readonly scene: Phaser.Scene
  private readonly renderCard: CardViewRenderCard
  private content: Phaser.GameObjects.Container | null = null
  private renderSignature: string | null = null
  private activeTween: Phaser.Tweens.Tween | null = null
  private targetX: number | null = null
  private targetY: number | null = null
  private hasSyncedPosition = false

  constructor(scene: Phaser.Scene, renderCard: CardViewRenderCard) {
    this.scene = scene
    this.renderCard = renderCard
    this.container = scene.add.container(0, 0)
    this.container.setDepth(DEPTH_GAMEPLAY)
  }

  sync(options: CardViewSyncOptions): Phaser.GameObjects.Container {
    const highlight = options.highlight ?? false
    const signature = [
      options.label,
      options.visualStyle,
      highlight ? 'highlight' : 'normal',
      options.width,
      options.height,
    ].join('|')

    if (signature !== this.renderSignature) {
      this.content?.destroy(true)
      this.content = this.renderCard({
        scene: this.scene,
        layout: options.layout,
        label: options.label,
        visualStyle: options.visualStyle,
        highlight,
        dimensions: { width: options.width, height: options.height },
      })
      this.container.removeAll(true)
      this.container.add(this.content)
      this.renderSignature = signature
    }

    this.resetInteractions()
    this.container
      .setSize(options.width, options.height)
      .setVisible(true)
      .setAlpha(1)
      .setScale(1)
      .setRotation(0)
      .setDepth(DEPTH_GAMEPLAY)
    this.container.setData('cardId', options.cardId)
    this.container.setData('zone', options.zone)
    this.container.setData('originX', options.x)
    this.container.setData('originY', options.y)
    if (options.instanceId) {
      this.container.setData('instanceId', options.instanceId)
    }

    this.moveTo(options.x, options.y, options.animate === true)

    if (options.draggable || options.onClick || options.bindPreview) {
      this.container.setInteractive({
        draggable: options.draggable === true,
        useHandCursor: true,
      })
    }
    if (options.draggable) {
      this.scene.input.setDraggable(this.container)
    }
    if (options.onClick) {
      this.container.on('pointerup', options.onClick)
    }
    options.bindPreview?.(this.container, options.label, {
      width: options.width,
      height: options.height,
    })
    return this.container
  }

  resetForPool(): void {
    this.stopTween()
    this.resetInteractions()
    this.container.removeAll(true)
    resetData(this.container)
    this.content = null
    this.renderSignature = null
    this.targetX = null
    this.targetY = null
    this.hasSyncedPosition = false
    this.container
      .setPosition(0, 0)
      .setSize(0, 0)
      .setVisible(false)
      .setAlpha(1)
      .setScale(1)
      .setRotation(0)
      .setDepth(DEPTH_GAMEPLAY)
  }

  destroy(): void {
    this.stopTween()
    this.resetInteractions()
    this.container.destroy(true)
    this.content = null
    this.renderSignature = null
  }

  private moveTo(x: number, y: number, animate: boolean): void {
    const targetUnchanged = this.targetX === x && this.targetY === y
    this.targetX = x
    this.targetY = y

    if (!this.hasSyncedPosition) {
      this.container.setPosition(x, y)
      this.hasSyncedPosition = true
      return
    }
    if (targetUnchanged) {
      return
    }

    this.stopTween()
    if (!animate) {
      this.container.setPosition(x, y)
      return
    }

    this.activeTween = this.scene.tweens.add({
      targets: this.container,
      x,
      y,
      duration: MOVE_TWEEN_DURATION_MS,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.container.setPosition(x, y)
        this.activeTween = null
      },
    })
  }

  private resetInteractions(): void {
    this.container.removeAllListeners()
    if (this.container.input) {
      this.scene.input.setDraggable(this.container, false)
      this.container.disableInteractive()
    }
  }

  private stopTween(): void {
    this.activeTween?.remove()
    this.activeTween = null
  }
}
