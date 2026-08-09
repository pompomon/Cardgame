// Renders both battlefields (non-active on top, active below with the land
// drop zone), registering each card's on-screen position with the
// EffectController and highlighting cards flagged by BattlefieldTargetsController
// as eligible click targets. Extracted from gameplay-presenter.ts.
import type Phaser from 'phaser'
import type { GameUiState } from '../../app/types'
import type { BattlefieldTargetsController } from './battlefield-targets'
import type { CardViewDescriptor } from './card-view'
import type { EffectController } from './effect-controller'
import type { BattlefieldCardPlacement } from './effect-anchoring'
import { xForCardInBoardColumn, type SceneLayout } from './layout'
import { buildBattlefieldBackdrop } from './visual-primitives'
import { COLOR_BATTLEFIELD_ACTIVE_STROKE, COLOR_BATTLEFIELD_NON_ACTIVE_STROKE, COLOR_ERROR_TEXT, COLOR_SUCCESS_TEXT } from './theme'
import { DEFAULT_BATTLEFIELD_HEADER_BAND } from './scene-config'

export interface BattlefieldViewContext {
  scene: Phaser.Scene
  getLayout: () => SceneLayout
  getRootContainer: () => Phaser.GameObjects.Container | null
  effectController: EffectController
  battlefieldTargets: BattlefieldTargetsController
  setBattlefieldDropZone: (zone: Phaser.GameObjects.Zone | null) => void
}

export function renderBattlefields(
  ctx: BattlefieldViewContext,
  game: GameUiState,
  presentedActor = game.actor,
): CardViewDescriptor[] {
  const scene = ctx.scene
  const layout = ctx.getLayout()
  const rootContainer = ctx.getRootContainer()
  const { effectController, battlefieldTargets } = ctx
  const activeIndex = presentedActor
  const nonActiveIndex = activeIndex === 0 ? 1 : 0
  const cards: CardViewDescriptor[] = []
  // Clear stale positions from the previous render pass so cards from a
  // previous game or rematch don't leave ghost anchors in the registry.
  effectController.beginBattlefieldRenderPass()

  // Non-active battlefield (top, no drop zone, parchment with crimson tint).
  const nonActiveX = layout.boardColumnLeft + layout.boardColumnWidth / 2
  const nonActiveY = layout.nonActiveBattlefieldY + layout.nonActiveBattlefieldHeight / 2
  const nonActiveBg = buildBattlefieldBackdrop(scene, nonActiveX, nonActiveY, {
    width: layout.boardColumnWidth,
    height: layout.nonActiveBattlefieldHeight,
    kind: 'non-active',
    stroke: COLOR_BATTLEFIELD_NON_ACTIVE_STROKE,
  })
  rootContainer?.add(nonActiveBg)
  rootContainer?.add(scene.add.text(
    layout.boardColumnLeft + 8,
    layout.nonActiveBattlefieldY + 4,
    `Player ${nonActiveIndex + 1} Battlefield`,
    {
      color: COLOR_ERROR_TEXT,
      fontSize: layout.smallFontSize,
    },
  ))

  const nonActiveBattlefield = game.players[nonActiveIndex].battlefield
  // Reserve a small header band at the top of the battlefield panel so the
  // "Player N Battlefield" label doesn't overlap the top edge of the cards
  // rendered inside the panel.
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
      x: cardX, y: nonActiveCardY, width: layout.cardWidth, height: layout.cardHeight,
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

  // Active battlefield (below non-active, drop zone enabled, parchment with green tint).
  const activeX = layout.boardColumnLeft + layout.boardColumnWidth / 2
  const activeY = layout.activeBattlefieldY + layout.activeBattlefieldHeight / 2
  const activeBg = buildBattlefieldBackdrop(scene, activeX, activeY, {
    width: layout.boardColumnWidth,
    height: layout.activeBattlefieldHeight,
    kind: 'active',
    stroke: COLOR_BATTLEFIELD_ACTIVE_STROKE,
  })
  rootContainer?.add(activeBg)
  rootContainer?.add(scene.add.text(
    layout.boardColumnLeft + 8,
    layout.activeBattlefieldY + 4,
    `Player ${activeIndex + 1} Battlefield (drop card here)`,
    {
      color: COLOR_SUCCESS_TEXT,
      fontSize: layout.smallFontSize,
    },
  ))

  const dropZone = scene.add.zone(activeX, activeY, layout.boardColumnWidth, layout.activeBattlefieldHeight)
  dropZone.setRectangleDropZone(layout.boardColumnWidth, layout.activeBattlefieldHeight)
  ctx.setBattlefieldDropZone(dropZone)
  rootContainer?.add(dropZone)

  const activeBattlefield = game.players[activeIndex].battlefield
  // Reserve the same header band as the non-active row so the active title
  // sits in its own padding instead of overlapping the rendered cards.
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
      x: cardX, y: activeCardY, width: layout.cardWidth, height: layout.cardHeight,
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
  return cards
}
