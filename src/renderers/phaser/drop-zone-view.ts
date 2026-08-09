import type Phaser from 'phaser'
import type { GameUiState } from '../../app/types'
import type { VisualEffectDescriptor } from '../../app/visual-effects'
import type { CardViewDescriptor } from './card-view'
import { DEPTH_EFFECT_OVERLAY, DEPTH_GAMEPLAY } from './depth'
import { type DragStatePhase } from './drag-state'
import {
  dropFeedbackState,
  effectFeedbackForDescriptor,
  type DropFeedbackState,
  type EffectFeedback,
} from './interaction-feedback'
import type { SceneLayout } from './layout'
import { COLOR_CARD_HIGHLIGHT_STROKE } from './theme'

const DROP_ZONE_FILL = 0x183f30
const DROP_ZONE_INVALID = 0x8a2937
const TARGET_RING_TINT = COLOR_CARD_HIGHLIGHT_STROKE
const DROP_LABEL_SUCCESS = '#d6ffd9'
const DROP_LABEL_ERROR = '#ffd0d8'
const DROP_LABEL_TARGET = '#f3f6ff'
const DROP_ZONE_STROKE_SUCCESS = 0xd6ffd9
const DROP_ZONE_STROKE_ERROR = 0xffd0d8

interface TargetRing {
  readonly ring: Phaser.GameObjects.Rectangle
  readonly label: Phaser.GameObjects.Text
}

export interface DropZoneViewSyncOptions {
  readonly game: GameUiState
  readonly layout: SceneLayout
  readonly cards: readonly CardViewDescriptor[]
  readonly dragCardId: string | null
  readonly dragPhase: DragStatePhase
  readonly effect: VisualEffectDescriptor | null
}

function isPointInsideActiveBattlefield(layout: SceneLayout, x: number, y: number): boolean {
  return x >= layout.boardColumnLeft
    && x <= layout.boardColumnLeft + layout.boardColumnWidth
    && y >= layout.activeBattlefieldY
    && y <= layout.activeBattlefieldY + layout.activeBattlefieldHeight
}

function legalDropFor(game: GameUiState, cardId: string | null): boolean {
  return game.canInput
    && game.phase === 'main'
    && cardId !== null
    && game.legal.playLandByCard[cardId] !== undefined
}

export class DropZoneView {
  private readonly scene: Phaser.Scene
  private readonly dropZone: Phaser.GameObjects.Rectangle
  private readonly dropLabel: Phaser.GameObjects.Text
  private readonly targetRings: TargetRing[] = []
  private layout: SceneLayout | null = null
  private dragPhase: DragStatePhase = 'idle'
  private hasLegalDrop = false
  private hasTargets = false
  private effectFeedback: EffectFeedback = { label: '', tint: 0xffffff }
  private labelFontSize = 14
  private pointerX = Number.NaN
  private pointerY = Number.NaN
  private destroyed = false

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.dropZone = scene.add.rectangle(0, 0, 1, 1, DROP_ZONE_FILL, 0)
      .setStrokeStyle(2, DROP_ZONE_STROKE_SUCCESS, 0.9)
      .setDepth(DEPTH_GAMEPLAY + 0.1)
      .setVisible(false)
    this.dropLabel = scene.add.text(0, 0, '', {
      color: '#d6ffd9',
      fontSize: '16px',
    })
      .setOrigin(0.5)
      .setDepth(DEPTH_EFFECT_OVERLAY)
      .setVisible(false)
  }

  sync(options: DropZoneViewSyncOptions): void {
    if (this.destroyed) {
      return
    }
    this.layout = options.layout
    this.dragPhase = options.dragPhase
    this.hasLegalDrop = legalDropFor(options.game, options.dragCardId)
    this.effectFeedback = effectFeedbackForDescriptor(options.effect)
    const targets = options.cards.filter((card) => card.zone === 'battlefield' && card.highlight)
    this.hasTargets = targets.length > 0
    this.dropZone.setPosition(
      options.layout.boardColumnLeft + options.layout.boardColumnWidth / 2,
      options.layout.activeBattlefieldY + options.layout.activeBattlefieldHeight / 2,
    )
    this.dropZone.setSize(options.layout.boardColumnWidth, options.layout.activeBattlefieldHeight)
    this.labelFontSize = Number.parseInt(options.layout.smallFontSize, 10) || 14
    this.dropLabel
      .setPosition(
        options.layout.boardColumnLeft + options.layout.boardColumnWidth / 2,
        options.layout.activeBattlefieldY + 18,
      )
      .setFontSize(this.labelFontSize)
    this.syncTargetRings(targets)
    this.refresh()
  }

  setDragState(game: GameUiState | null, cardId: string | null, phase: DragStatePhase): void {
    if (this.destroyed) {
      return
    }
    this.dragPhase = phase
    this.hasLegalDrop = game !== null && legalDropFor(game, cardId)
    this.refresh()
  }

  updatePointer(x: number, y: number): void {
    if (this.destroyed || !Number.isFinite(x) || !Number.isFinite(y)) {
      return
    }
    this.pointerX = x
    this.pointerY = y
    this.refresh()
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    this.dropZone.destroy()
    this.dropLabel.destroy()
    for (const target of this.targetRings) {
      target.ring.destroy()
      target.label.destroy()
    }
    this.targetRings.length = 0
  }

  private syncTargetRings(targets: readonly CardViewDescriptor[]): void {
    while (this.targetRings.length < targets.length) {
      const ring = this.scene.add.rectangle(0, 0, 1, 1, TARGET_RING_TINT, 0)
        .setStrokeStyle(3, TARGET_RING_TINT, 0.95)
        .setDepth(DEPTH_EFFECT_OVERLAY)
        .setVisible(false)
      const label = this.scene.add.text(0, 0, 'Target', {
        color: DROP_LABEL_TARGET,
        fontSize: '14px',
      })
        .setOrigin(0.5)
        .setDepth(DEPTH_EFFECT_OVERLAY)
        .setVisible(false)
      this.targetRings.push({ ring, label })
    }
    for (let index = 0; index < this.targetRings.length; index += 1) {
      const target = this.targetRings[index]
      const card = targets[index]
      if (!card) {
        target.ring.setVisible(false)
        target.label.setVisible(false)
        continue
      }
      target.ring
        .setPosition(card.x, card.y)
        .setSize(card.width + 10, card.height + 10)
        .setVisible(true)
      target.label
        .setPosition(card.x, card.y - card.height / 2 - 12)
        .setVisible(true)
    }
  }

  private refresh(): void {
    const layout = this.layout
    if (!layout) {
      return
    }
    const state = dropFeedbackState({
      dragPhase: this.dragPhase,
      hasLegalDrop: this.hasLegalDrop,
      isPointerInsideDropZone: isPointInsideActiveBattlefield(layout, this.pointerX, this.pointerY),
      hasTargets: this.hasTargets,
    })
    this.applyDropFeedback(state)
  }

  private applyDropFeedback(state: DropFeedbackState): void {
    switch (state) {
      case 'valid':
        this.dropZone.setFillStyle(DROP_ZONE_FILL, 0.22).setStrokeStyle(3, DROP_ZONE_STROKE_SUCCESS, 1).setVisible(true)
        this.dropLabel.setText('Release to play').setColor(DROP_LABEL_SUCCESS).setFontSize(this.labelFontSize).setVisible(true)
        return
      case 'invalid':
        this.dropZone.setFillStyle(DROP_ZONE_INVALID, 0.18).setStrokeStyle(2, DROP_ZONE_STROKE_ERROR, 1).setVisible(true)
        this.dropLabel.setText('Drop on your battlefield').setColor(DROP_LABEL_ERROR).setFontSize(this.labelFontSize).setVisible(true)
        return
      case 'disabled':
        this.dropZone.setFillStyle(DROP_ZONE_INVALID, 0.12).setStrokeStyle(2, DROP_ZONE_STROKE_ERROR, 0.8).setVisible(true)
        this.dropLabel.setText('This card cannot be played').setColor(DROP_LABEL_ERROR).setFontSize(this.labelFontSize).setVisible(true)
        return
      case 'target':
        this.dropZone.setVisible(false)
        this.dropLabel.setText('Choose a highlighted target').setColor(DROP_LABEL_TARGET).setFontSize(this.labelFontSize).setVisible(true)
        return
      case 'hidden':
      default:
        this.dropZone.setVisible(false)
        if (this.effectFeedback.label) {
          this.dropLabel
            .setText(this.effectFeedback.label)
            .setColor(`#${this.effectFeedback.tint.toString(16).padStart(6, '0')}`)
            .setFontSize(this.labelFontSize)
            .setVisible(true)
        } else {
          this.dropLabel.setVisible(false)
        }
    }
  }
}
