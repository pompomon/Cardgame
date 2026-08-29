// Renders both battlefields (far side on top, presented side below), registering
// each card's on-screen position with the
// EffectController and highlighting cards flagged by BattlefieldTargetsController
// as eligible click targets. Extracted from gameplay-presenter.ts.
import type Phaser from 'phaser'
import { resolveBoardPlayerSlots } from '../../app/board-presentation'
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
  const slots = resolveBoardPlayerSlots(presentedActor, game.actor)
  const farActivity = slots.farIsActive ? 'active' : 'non-active'
  const nearActivity = slots.nearIsActive ? 'active' : 'non-active'
  const cards: CardViewDescriptor[] = []
  // Clear stale positions from the previous render pass so cards from a
  // previous game or rematch don't leave ghost anchors in the registry.
  effectController.beginBattlefieldRenderPass()

  // Far-side battlefield (top). Its activity treatment follows the real actor,
  // independently of which player remains presented on the near side.
  const farX = layout.boardColumnLeft + layout.boardColumnWidth / 2
  const farY = layout.nonActiveBattlefieldY + layout.nonActiveBattlefieldHeight / 2
  const farBg = buildBattlefieldBackdrop(scene, farX, farY, {
    width: layout.boardColumnWidth,
    height: layout.nonActiveBattlefieldHeight,
    kind: farActivity,
    stroke: slots.farIsActive ? COLOR_BATTLEFIELD_ACTIVE_STROKE : COLOR_BATTLEFIELD_NON_ACTIVE_STROKE,
  })
  rootContainer?.add(farBg)
  rootContainer?.add(scene.add.text(
    layout.boardColumnLeft + 8,
    layout.nonActiveBattlefieldY + 4,
    `Player ${slots.farIndex + 1} Battlefield${slots.farIsActive ? ' — Active' : ''}`,
    {
      color: slots.farIsActive ? COLOR_SUCCESS_TEXT : COLOR_ERROR_TEXT,
      fontSize: layout.smallFontSize,
    },
  ))

  const farBattlefield = game.players[slots.farIndex].battlefield
  // Reserve a small header band at the top of the battlefield panel so the
  // "Player N Battlefield" label doesn't overlap the top edge of the cards
  // rendered inside the panel.
  const battlefieldHeaderBand = Math.min(
    DEFAULT_BATTLEFIELD_HEADER_BAND,
    Math.max(0, layout.nonActiveBattlefieldHeight - layout.cardHeight),
  )
  const farCardY = layout.nonActiveBattlefieldY
    + battlefieldHeaderBand
    + Math.max(0, layout.nonActiveBattlefieldHeight - battlefieldHeaderBand) / 2
  for (let index = 0; index < farBattlefield.length; index += 1) {
    const card = farBattlefield[index]
    const targetEntry = battlefieldTargets.findBattlefieldTargetEntry(farActivity, card.instanceId)
    const cardX = xForCardInBoardColumn(layout, index, farBattlefield.length)
    const placement: BattlefieldCardPlacement = {
      x: cardX, y: farCardY, width: layout.cardWidth, height: layout.cardHeight,
      playerIndex: slots.farIndex,
      cardIndex: index,
      cardCount: farBattlefield.length,
    }
    effectController.recordCardPosition(card.instanceId, placement)
    cards.push({
      cardId: card.cardId,
      instanceId: card.instanceId,
      playerIndex: slots.farIndex,
      zone: 'battlefield',
      name: card.name,
      x: cardX,
      y: farCardY,
      width: layout.cardWidth,
      height: layout.cardHeight,
      highlight: targetEntry !== null,
      draggable: false,
      preview: targetEntry === null,
      onClick: targetEntry?.onSelect,
      interactionKey: targetEntry
        ? `target:${game.phase}:${farActivity}:${card.instanceId}:${battlefieldTargets.getPendingPlayLandTargetSelection()?.cardId ?? ''}`
        : `preview:battlefield:${card.cardId}:${card.name}`,
    })
  }

  // Near-side battlefield (below the far side). Only expose its drop zone when
  // the presented player is also the real actor and can accept local input.
  const nearX = layout.boardColumnLeft + layout.boardColumnWidth / 2
  const nearY = layout.activeBattlefieldY + layout.activeBattlefieldHeight / 2
  const nearBg = buildBattlefieldBackdrop(scene, nearX, nearY, {
    width: layout.boardColumnWidth,
    height: layout.activeBattlefieldHeight,
    kind: nearActivity,
    stroke: slots.nearIsActive ? COLOR_BATTLEFIELD_ACTIVE_STROKE : COLOR_BATTLEFIELD_NON_ACTIVE_STROKE,
  })
  rootContainer?.add(nearBg)
  rootContainer?.add(scene.add.text(
    layout.boardColumnLeft + 8,
    layout.activeBattlefieldY + 4,
    `Player ${slots.nearIndex + 1} Battlefield${slots.nearIsActive ? (game.canInput ? ' (drop card here)' : ' — Active') : ''}`,
    {
      color: slots.nearIsActive ? COLOR_SUCCESS_TEXT : COLOR_ERROR_TEXT,
      fontSize: layout.smallFontSize,
    },
  ))

  if (slots.nearIsActive && game.canInput) {
    const dropZone = scene.add.zone(nearX, nearY, layout.boardColumnWidth, layout.activeBattlefieldHeight)
    dropZone.setRectangleDropZone(layout.boardColumnWidth, layout.activeBattlefieldHeight)
    ctx.setBattlefieldDropZone(dropZone)
    rootContainer?.add(dropZone)
  } else {
    ctx.setBattlefieldDropZone(null)
  }

  const nearBattlefield = game.players[slots.nearIndex].battlefield
  // Reserve the same header band as the non-active row so the active title
  // sits in its own padding instead of overlapping the rendered cards.
  const nearHeaderBand = Math.min(
    DEFAULT_BATTLEFIELD_HEADER_BAND,
    Math.max(0, layout.activeBattlefieldHeight - layout.cardHeight),
  )
  const nearCardY = layout.activeBattlefieldY
    + nearHeaderBand
    + Math.max(0, layout.activeBattlefieldHeight - nearHeaderBand) / 2
  for (let index = 0; index < nearBattlefield.length; index += 1) {
    const card = nearBattlefield[index]
    const targetEntry = battlefieldTargets.findBattlefieldTargetEntry(nearActivity, card.instanceId)
    const cardX = xForCardInBoardColumn(layout, index, nearBattlefield.length)
    const placement: BattlefieldCardPlacement = {
      x: cardX, y: nearCardY, width: layout.cardWidth, height: layout.cardHeight,
      playerIndex: slots.nearIndex,
      cardIndex: index,
      cardCount: nearBattlefield.length,
    }
    effectController.recordCardPosition(card.instanceId, placement)
    cards.push({
      cardId: card.cardId,
      instanceId: card.instanceId,
      playerIndex: slots.nearIndex,
      zone: 'battlefield',
      name: card.name,
      x: cardX,
      y: nearCardY,
      width: layout.cardWidth,
      height: layout.cardHeight,
      highlight: targetEntry !== null,
      draggable: false,
      preview: targetEntry === null,
      onClick: targetEntry?.onSelect,
      interactionKey: targetEntry
        ? `target:${game.phase}:${nearActivity}:${card.instanceId}:${battlefieldTargets.getPendingPlayLandTargetSelection()?.cardId ?? ''}`
        : `preview:battlefield:${card.cardId}:${card.name}`,
    })
  }
  return cards
}
