// Retains both battlefield backdrops, labels, and the active drop zone while
// producing card descriptors for CardViewRegistry.
import type Phaser from 'phaser'
import type { GameUiState } from '../../app/types'
import type { BattlefieldTargetsController } from './battlefield-targets'
import type { CardViewDescriptor } from './card-view'
import type { EffectController } from './effect-controller'
import type { BattlefieldCardPlacement } from './effect-anchoring'
import { xForCardInBoardColumn, type SceneLayout } from './layout'
import { buildBattlefieldBackdrop } from './visual-primitives'
import {
  COLOR_BATTLEFIELD_ACTIVE_STROKE,
  COLOR_BATTLEFIELD_NON_ACTIVE_STROKE,
  COLOR_ERROR_TEXT,
  COLOR_SUCCESS_TEXT,
} from './theme'
import { DEFAULT_BATTLEFIELD_HEADER_BAND } from './scene-config'

export interface BattlefieldViewContext {
  scene: Phaser.Scene
  getLayout: () => SceneLayout
  getRootContainer: () => Phaser.GameObjects.Container | null
  effectController: EffectController
  battlefieldTargets: BattlefieldTargetsController
  setBattlefieldDropZone: (zone: Phaser.GameObjects.Zone | null) => void
}

export class BattlefieldView {
  readonly rootChild: Phaser.GameObjects.Container

  private readonly ctx: BattlefieldViewContext
  private readonly nonActiveLabel: Phaser.GameObjects.Text
  private readonly activeLabel: Phaser.GameObjects.Text
  private readonly dropZone: Phaser.GameObjects.Zone
  private nonActiveBackdrop: Phaser.GameObjects.Container | null = null
  private activeBackdrop: Phaser.GameObjects.Container | null = null
  private chromeSignature: string | null = null
  private destroyed = false

  constructor(ctx: BattlefieldViewContext) {
    this.ctx = ctx
    this.rootChild = ctx.scene.add.container(0, 0)
    this.nonActiveLabel = ctx.scene.add.text(0, 0, '', {
      color: COLOR_ERROR_TEXT,
      fontSize: ctx.getLayout().smallFontSize,
    })
    this.activeLabel = ctx.scene.add.text(0, 0, '', {
      color: COLOR_SUCCESS_TEXT,
      fontSize: ctx.getLayout().smallFontSize,
    })
    this.dropZone = ctx.scene.add.zone(0, 0, 1, 1)
    this.dropZone.setRectangleDropZone(1, 1)
    this.rootChild.add([this.nonActiveLabel, this.activeLabel, this.dropZone])
  }

  sync(
    game: GameUiState,
    presentedActor = game.actor,
    enableShadows = true,
  ): CardViewDescriptor[] {
    if (this.destroyed) return []
    this.attachToRoot()
    this.rootChild.setVisible(true)

    const { effectController, battlefieldTargets } = this.ctx
    const layout = this.ctx.getLayout()
    const activeIndex = presentedActor
    const nonActiveIndex = activeIndex === 0 ? 1 : 0
    const cards: CardViewDescriptor[] = []
    effectController.beginBattlefieldRenderPass()
    this.syncChrome(layout, activeIndex, nonActiveIndex, enableShadows)

    const nonActiveBattlefield = game.players[nonActiveIndex].battlefield
    const battlefieldHeaderBand = Math.min(
      DEFAULT_BATTLEFIELD_HEADER_BAND,
      Math.max(0, layout.nonActiveBattlefieldHeight - layout.cardHeight),
    )
    const nonActiveCardY = layout.nonActiveBattlefieldY
      + battlefieldHeaderBand
      + Math.max(0, layout.nonActiveBattlefieldHeight - battlefieldHeaderBand) / 2
    for (let index = 0; index < nonActiveBattlefield.length; index += 1) {
      const card = nonActiveBattlefield[index]
      const targetEntry = battlefieldTargets.findBattlefieldTargetEntry('non-active', card.instanceId)
      const cardX = xForCardInBoardColumn(layout, index, nonActiveBattlefield.length)
      const placement: BattlefieldCardPlacement = {
        x: cardX,
        y: nonActiveCardY,
        width: layout.cardWidth,
        height: layout.cardHeight,
        playerIndex: nonActiveIndex,
        cardIndex: index,
        cardCount: nonActiveBattlefield.length,
      }
      effectController.recordCardPosition(card.instanceId, placement)
      cards.push({
        cardId: card.cardId,
        instanceId: card.instanceId,
        playerIndex: nonActiveIndex,
        zone: 'battlefield',
        name: card.name,
        x: cardX,
        y: nonActiveCardY,
        width: layout.cardWidth,
        height: layout.cardHeight,
        highlight: targetEntry !== null,
        draggable: false,
        preview: targetEntry === null,
        onClick: targetEntry?.onSelect,
        interactionKey: targetEntry
          ? `target:${game.phase}:non-active:${card.instanceId}:${battlefieldTargets.getPendingPlayLandTargetSelection()?.cardId ?? ''}`
          : `preview:battlefield:${card.cardId}:${card.name}`,
      })
    }

    const activeBattlefield = game.players[activeIndex].battlefield
    const activeHeaderBand = Math.min(
      DEFAULT_BATTLEFIELD_HEADER_BAND,
      Math.max(0, layout.activeBattlefieldHeight - layout.cardHeight),
    )
    const activeCardY = layout.activeBattlefieldY
      + activeHeaderBand
      + Math.max(0, layout.activeBattlefieldHeight - activeHeaderBand) / 2
    for (let index = 0; index < activeBattlefield.length; index += 1) {
      const card = activeBattlefield[index]
      const targetEntry = battlefieldTargets.findBattlefieldTargetEntry('active', card.instanceId)
      const cardX = xForCardInBoardColumn(layout, index, activeBattlefield.length)
      const placement: BattlefieldCardPlacement = {
        x: cardX,
        y: activeCardY,
        width: layout.cardWidth,
        height: layout.cardHeight,
        playerIndex: activeIndex,
        cardIndex: index,
        cardCount: activeBattlefield.length,
      }
      effectController.recordCardPosition(card.instanceId, placement)
      cards.push({
        cardId: card.cardId,
        instanceId: card.instanceId,
        playerIndex: activeIndex,
        zone: 'battlefield',
        name: card.name,
        x: cardX,
        y: activeCardY,
        width: layout.cardWidth,
        height: layout.cardHeight,
        highlight: targetEntry !== null,
        draggable: false,
        preview: targetEntry === null,
        onClick: targetEntry?.onSelect,
        interactionKey: targetEntry
          ? `target:${game.phase}:active:${card.instanceId}:${battlefieldTargets.getPendingPlayLandTargetSelection()?.cardId ?? ''}`
          : `preview:battlefield:${card.cardId}:${card.name}`,
      })
    }
    this.ctx.setBattlefieldDropZone(this.dropZone)
    return cards
  }

  reset(): void {
    if (this.destroyed) return
    this.rootChild.setVisible(false)
    this.ctx.effectController.beginBattlefieldRenderPass()
    this.ctx.setBattlefieldDropZone(null)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.ctx.setBattlefieldDropZone(null)
    this.rootChild.destroy(true)
  }

  private attachToRoot(): void {
    const root = this.ctx.getRootContainer()
    if (!root || this.rootChild.parentContainer === root) return
    this.rootChild.parentContainer?.remove(this.rootChild, false)
    root.addAt(this.rootChild, 0)
  }

  private syncChrome(
    layout: SceneLayout,
    activeIndex: number,
    nonActiveIndex: number,
    enableShadows: boolean,
  ): void {
    const signature = [
      layout.boardColumnLeft,
      layout.boardColumnWidth,
      layout.nonActiveBattlefieldY,
      layout.nonActiveBattlefieldHeight,
      layout.activeBattlefieldY,
      layout.activeBattlefieldHeight,
      layout.smallFontSize,
      enableShadows,
    ].join(':')
    if (signature !== this.chromeSignature) {
      this.chromeSignature = signature
      this.nonActiveBackdrop?.destroy(true)
      this.activeBackdrop?.destroy(true)
      this.nonActiveBackdrop = buildBattlefieldBackdrop(
        this.ctx.scene,
        layout.boardColumnLeft + layout.boardColumnWidth / 2,
        layout.nonActiveBattlefieldY + layout.nonActiveBattlefieldHeight / 2,
        {
          width: layout.boardColumnWidth,
          height: layout.nonActiveBattlefieldHeight,
          kind: 'non-active',
          stroke: COLOR_BATTLEFIELD_NON_ACTIVE_STROKE,
          shadow: enableShadows,
        },
      )
      this.activeBackdrop = buildBattlefieldBackdrop(
        this.ctx.scene,
        layout.boardColumnLeft + layout.boardColumnWidth / 2,
        layout.activeBattlefieldY + layout.activeBattlefieldHeight / 2,
        {
          width: layout.boardColumnWidth,
          height: layout.activeBattlefieldHeight,
          kind: 'active',
          stroke: COLOR_BATTLEFIELD_ACTIVE_STROKE,
          shadow: enableShadows,
        },
      )
      this.rootChild.addAt(this.activeBackdrop, 0)
      this.rootChild.addAt(this.nonActiveBackdrop, 0)
      this.nonActiveLabel
        .setPosition(layout.boardColumnLeft + 8, layout.nonActiveBattlefieldY + 4)
        .setFontSize(layout.smallFontSize)
      this.activeLabel
        .setPosition(layout.boardColumnLeft + 8, layout.activeBattlefieldY + 4)
        .setFontSize(layout.smallFontSize)
      this.dropZone
        .setPosition(
          layout.boardColumnLeft + layout.boardColumnWidth / 2,
          layout.activeBattlefieldY + layout.activeBattlefieldHeight / 2,
        )
        .setRectangleDropZone(layout.boardColumnWidth, layout.activeBattlefieldHeight)
    }
    this.nonActiveLabel.setText(`Player ${nonActiveIndex + 1} Battlefield`)
    this.activeLabel.setText(`Player ${activeIndex + 1} Battlefield (drop card here)`)
  }
}
