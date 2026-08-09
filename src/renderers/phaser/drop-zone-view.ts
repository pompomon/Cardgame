import type Phaser from 'phaser'
import type { DragStatePhase } from './drag-state'
import { DEPTH_INTERACTION_FEEDBACK } from './depth'
import {
  interactionFeedbackStyle,
  type InteractionFeedbackArea,
  type InteractionFeedbackMarker,
  type InteractionFeedbackModel,
  type InteractionFeedbackState,
  type InteractionMarkerKind,
} from './interaction-feedback'
import type { SceneLayout } from './layout'

export const BOARD_UI_ATLAS_TEXTURE_KEY = 'board-atlas:board-ui'

const MAX_POOLED_MARKERS = 32
const MARKER_PADDING = 10

type AreaVisual = {
  readonly fill: Phaser.GameObjects.Rectangle
  readonly outline: Phaser.GameObjects.Image | null
}

type MarkerVisual = {
  readonly container: Phaser.GameObjects.Container
  readonly fill: Phaser.GameObjects.Rectangle
  readonly sprite: Phaser.GameObjects.Image | null
  descriptor: InteractionFeedbackMarker | null
}

export interface DropZoneViewContext {
  readonly scene: Phaser.Scene
}

function markerFrame(kind: InteractionMarkerKind): string {
  switch (kind) {
    case 'target':
    case 'action':
      return 'target-ring'
    case 'playable-card':
    default:
      return 'selection-glow'
  }
}

function contains(
  area: InteractionFeedbackArea,
  x: number,
  y: number,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return false
  }
  const { bounds } = area
  return x >= bounds.x - bounds.width / 2
    && x <= bounds.x + bounds.width / 2
    && y >= bounds.y - bounds.height / 2
    && y <= bounds.y + bounds.height / 2
}

export class DropZoneView {
  readonly layer: Phaser.GameObjects.Container
  readonly dropZone: Phaser.GameObjects.Zone

  private readonly scene: Phaser.Scene
  private readonly battlefield: AreaVisual
  private readonly hand: AreaVisual
  private readonly label: Phaser.GameObjects.Text
  private readonly activeMarkers = new Map<string, MarkerVisual>()
  private readonly markerPool: MarkerVisual[] = []
  private model: InteractionFeedbackModel | null = null
  private dragPhase: DragStatePhase = 'idle'
  private draggedCardId: string | null = null
  private pointerX = 0
  private pointerY = 0
  private blocked = false
  private destroyed = false

  constructor(ctx: DropZoneViewContext) {
    this.scene = ctx.scene
    this.layer = this.scene.add.container(0, 0).setDepth(DEPTH_INTERACTION_FEEDBACK)
    this.battlefield = this.createAreaVisual('zone-outline')
    this.hand = this.createAreaVisual('zone-outline')
    this.label = this.scene.add.text(0, 0, '', {
      color: '#d6ffd9',
      fontSize: '14px',
      align: 'center',
    }).setOrigin(0.5)
    this.dropZone = this.scene.add.zone(0, 0, 1, 1).setActive(false)
    this.layer.add([
      this.battlefield.fill,
      ...(this.battlefield.outline ? [this.battlefield.outline] : []),
      this.hand.fill,
      ...(this.hand.outline ? [this.hand.outline] : []),
      this.label,
      this.dropZone,
    ])
    this.layer.setVisible(false)
  }

  get activeMarkerCount(): number {
    return this.activeMarkers.size
  }

  get pooledMarkerCount(): number {
    return this.markerPool.length
  }

  getMarkerContainer(key: string): Phaser.GameObjects.Container | null {
    return this.activeMarkers.get(key)?.container ?? null
  }

  sync(model: InteractionFeedbackModel, layout: SceneLayout): void {
    if (this.destroyed) {
      return
    }
    this.model = model
    this.syncAreaGeometry(this.battlefield, model.battlefield)
    this.syncAreaGeometry(this.hand, model.hand)
    this.label
      .setPosition(
        model.battlefield.bounds.x,
        model.battlefield.bounds.y + model.battlefield.bounds.height / 2 - 12,
      )
      .setFontSize(layout.smallFontSize)
      .setWordWrapWidth(Math.max(1, model.battlefield.bounds.width - 16))
    this.dropZone
      .setPosition(model.battlefield.bounds.x, model.battlefield.bounds.y)
      .setSize(model.battlefield.bounds.width, model.battlefield.bounds.height)

    const desiredKeys = new Set(model.markers.map((marker) => marker.key))
    for (const [key, marker] of [...this.activeMarkers]) {
      if (!desiredKeys.has(key)) {
        this.releaseMarker(key, marker)
      }
    }
    for (const descriptor of model.markers) {
      let marker = this.activeMarkers.get(descriptor.key)
      if (!marker) {
        marker = this.acquireMarker()
        this.activeMarkers.set(descriptor.key, marker)
      }
      marker.descriptor = descriptor
      marker.container
        .setPosition(descriptor.bounds.x, descriptor.bounds.y)
        .setVisible(true)
      marker.fill.setDisplaySize(
        descriptor.bounds.width + MARKER_PADDING,
        descriptor.bounds.height + MARKER_PADDING,
      )
      marker.sprite
        ?.setFrame(markerFrame(descriptor.kind))
        .setDisplaySize(
          descriptor.bounds.width + MARKER_PADDING,
          descriptor.bounds.height + MARKER_PADDING,
        )
    }
    this.applyState()
  }

  updateDrag(
    phase: DragStatePhase,
    cardId: string | null,
    x: number,
    y: number,
  ): void {
    if (this.destroyed) {
      return
    }
    this.dragPhase = phase
    this.draggedCardId = cardId
    this.pointerX = x
    this.pointerY = y
    this.applyState()
  }

  setBlocked(blocked: boolean): void {
    if (this.destroyed || this.blocked === blocked) {
      return
    }
    this.blocked = blocked
    this.applyState()
  }

  reset(): void {
    if (this.destroyed) {
      return
    }
    this.model = null
    this.dragPhase = 'idle'
    this.draggedCardId = null
    this.pointerX = 0
    this.pointerY = 0
    for (const [key, marker] of [...this.activeMarkers]) {
      this.releaseMarker(key, marker)
    }
    this.layer.setVisible(false)
    this.dropZone.setActive(false)
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.reset()
    this.destroyed = true
    for (const marker of this.markerPool) {
      marker.container.destroy(true)
    }
    this.markerPool.length = 0
    this.layer.destroy(true)
  }

  private createAreaVisual(frame: string): AreaVisual {
    const fill = this.scene.add.rectangle(0, 0, 1, 1, 0x000000, 0)
    const outline = this.hasAtlasFrame(frame)
      ? this.scene.add.image(0, 0, BOARD_UI_ATLAS_TEXTURE_KEY, frame)
      : null
    return { fill, outline }
  }

  private createMarker(): MarkerVisual {
    const fill = this.scene.add.rectangle(0, 0, 1, 1, 0x000000, 0)
    const sprite = this.hasAtlasFrame('selection-glow')
      && this.hasAtlasFrame('target-ring')
      ? this.scene.add.image(
          0,
          0,
          BOARD_UI_ATLAS_TEXTURE_KEY,
          'selection-glow',
        )
      : null
    const children: Phaser.GameObjects.GameObject[] = [fill]
    if (sprite) {
      children.push(sprite)
    }
    const container = this.scene.add.container(0, 0, children)
    this.layer.add(container)
    return { container, fill, sprite, descriptor: null }
  }

  private acquireMarker(): MarkerVisual {
    return this.markerPool.pop() ?? this.createMarker()
  }

  private releaseMarker(key: string, marker: MarkerVisual): void {
    this.activeMarkers.delete(key)
    marker.descriptor = null
    marker.container.setVisible(false).setPosition(0, 0)
    marker.fill
      .setFillStyle(0x000000, 0)
      .setStrokeStyle(0, 0x000000, 0)
    marker.sprite?.setVisible(false).setAlpha(1).setTint(0xffffff)
    if (this.markerPool.length < MAX_POOLED_MARKERS) {
      this.markerPool.push(marker)
    } else {
      marker.container.destroy(true)
    }
  }

  private syncAreaGeometry(
    visual: AreaVisual,
    area: InteractionFeedbackArea,
  ): void {
    visual.fill
      .setPosition(area.bounds.x, area.bounds.y)
      .setDisplaySize(area.bounds.width, area.bounds.height)
    visual.outline
      ?.setPosition(area.bounds.x, area.bounds.y)
      .setDisplaySize(area.bounds.width, area.bounds.height)
  }

  private applyState(): void {
    const model = this.model
    if (!model || this.blocked) {
      this.layer.setVisible(false)
      this.dropZone.setActive(false)
      return
    }

    let battlefieldState = model.battlefield.state
    let handState = model.hand.state
    let label = model.battlefield.label
    const dragActive = this.dragPhase !== 'idle' && this.draggedCardId !== null
    const legalDrag = this.draggedCardId !== null
      && model.playableCardIds.has(this.draggedCardId)
    if (dragActive) {
      if (!legalDrag || this.dragPhase === 'settling') {
        battlefieldState = 'invalid'
        handState = 'invalid'
        label = 'Invalid drop'
      } else if (this.dragPhase === 'pressed') {
        battlefieldState = 'valid'
        handState = 'selected'
        label = 'Move the card to your battlefield'
      } else {
        battlefieldState = contains(
          model.battlefield,
          this.pointerX,
          this.pointerY,
        )
          ? 'hover'
          : 'valid'
        handState = 'selected'
        label = battlefieldState === 'hover'
          ? 'Release to play on your battlefield'
          : 'Drop playable card on your battlefield'
      }
    }

    this.applyAreaState(this.battlefield, battlefieldState)
    this.applyAreaState(this.hand, handState)
    this.label
      .setText(label)
      .setColor(interactionFeedbackStyle(battlefieldState).textColor)
      .setVisible(battlefieldState !== 'hidden' && label.length > 0)

    for (const marker of this.activeMarkers.values()) {
      const descriptor = marker.descriptor
      if (!descriptor) {
        marker.container.setVisible(false)
        continue
      }
      const state = dragActive && descriptor.cardId === this.draggedCardId
        ? legalDrag ? 'selected' : 'invalid'
        : descriptor.state
      this.applyMarkerState(marker, state)
    }

    const hasVisibleArea = battlefieldState !== 'hidden'
      || handState !== 'hidden'
    let hasVisibleMarker = false
    for (const marker of this.activeMarkers.values()) {
      if (marker.container.visible) {
        hasVisibleMarker = true
        break
      }
    }
    this.layer.setVisible(hasVisibleArea || hasVisibleMarker)
    this.dropZone.setActive(
      model.playableCardIds.size > 0
      && battlefieldState !== 'hidden'
      && battlefieldState !== 'disabled',
    )
  }

  private applyAreaState(
    visual: AreaVisual,
    state: InteractionFeedbackState,
  ): void {
    const style = interactionFeedbackStyle(state)
    const visible = state !== 'hidden'
    visual.fill
      .setFillStyle(style.fillColor, style.fillAlpha)
      .setStrokeStyle(
        style.strokeWidth,
        style.strokeColor,
        style.strokeAlpha,
      )
      .setVisible(visible)
    visual.outline
      ?.setTint(style.strokeColor)
      .setAlpha(style.strokeAlpha)
      .setVisible(visible)
  }

  private applyMarkerState(
    marker: MarkerVisual,
    state: InteractionFeedbackState,
  ): void {
    const style = interactionFeedbackStyle(state)
    const visible = state !== 'hidden'
    marker.fill
      .setFillStyle(style.fillColor, style.fillAlpha)
      .setStrokeStyle(
        style.strokeWidth,
        style.strokeColor,
        style.strokeAlpha,
      )
      .setVisible(visible)
    marker.sprite
      ?.setTint(style.strokeColor)
      .setAlpha(style.strokeAlpha)
      .setVisible(visible)
    marker.container.setVisible(visible)
  }

  private hasAtlasFrame(frame: string): boolean {
    return this.scene.textures?.exists(BOARD_UI_ATLAS_TEXTURE_KEY) === true
      && this.scene.textures.get(BOARD_UI_ATLAS_TEXTURE_KEY).has(frame)
  }
}
