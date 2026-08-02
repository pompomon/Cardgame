// Pure helper — no Phaser imports. Computes the EffectAnchor for an
// EffectDescriptor, preferring card-level anchors for effect kinds that
// can resolve to a specific card on the battlefield (play_land,
// plains_reuse). Falls back to battlefield-row-center for all other kinds
// or when the card is no longer in the registry.
//
// Extracted from CardgameScene.computeEffectAnchor so that index.ts stays
// under its 3004-line budget (see src/test/phaser-menu-overlay.test.ts).

import type { AppViewModel } from '../../app/types'
import type { EffectAnchor, EffectDescriptor } from './effects'
import { xForCardInBoardColumn, type SceneLayout } from './layout'
import { DEFAULT_BATTLEFIELD_HEADER_BAND } from './scene-config'

export interface BattlefieldCardPlacement extends EffectAnchor {
  playerIndex: number
  cardIndex: number
  cardCount: number
}

function cardYForRow(layout: SceneLayout, useNonActive: boolean): number {
  const rowY = useNonActive ? layout.nonActiveBattlefieldY : layout.activeBattlefieldY
  const rowHeight = useNonActive ? layout.nonActiveBattlefieldHeight : layout.activeBattlefieldHeight
  const headerBand = Math.min(
    DEFAULT_BATTLEFIELD_HEADER_BAND,
    Math.max(0, rowHeight - layout.cardHeight),
  )
  return rowY + headerBand + Math.max(0, rowHeight - headerBand) / 2
}

export function projectBattlefieldCardPlacement(
  placement: BattlefieldCardPlacement,
  layout: SceneLayout,
  activeIndex: number,
): EffectAnchor {
  return {
    x: xForCardInBoardColumn(layout, placement.cardIndex, placement.cardCount),
    y: cardYForRow(layout, placement.playerIndex !== activeIndex),
    width: layout.cardWidth,
    height: layout.cardHeight,
  }
}

function projectedRecord(
  record: BattlefieldCardPlacement | undefined,
  layout: SceneLayout,
  activeIndex: number,
): EffectAnchor | undefined {
  return record ? projectBattlefieldCardPlacement(record, layout, activeIndex) : undefined
}

// Compute the anchor rectangle for the given descriptor, consulting
// `registry` for card-specific positions when applicable.
//
// `registry` maps instanceId → BattlefieldCardPlacement and is populated
// (and cleared) by CardgameScene.renderBattlefields on every render pass.
export function computeEffectAnchorFromLayout(
  view: AppViewModel,
  descriptor: EffectDescriptor,
  layout: SceneLayout,
  registry: ReadonlyMap<string, BattlefieldCardPlacement>,
  previousRegistry: ReadonlyMap<string, BattlefieldCardPlacement> = registry,
): EffectAnchor {
  const game = view.game
  const activeIndex = game?.actor ?? 0
  const nonActiveIndex = activeIndex === 0 ? 1 : 0

  const anchorOwner = descriptor.targetActor ?? descriptor.actor
  const useNonActive = anchorOwner === nonActiveIndex

  // Row-center fallback dimensions.
  const rowCenterX = layout.boardColumnLeft + layout.boardColumnWidth / 2
  const rowHeight = useNonActive ? layout.nonActiveBattlefieldHeight : layout.activeBattlefieldHeight
  const rowCenterY = useNonActive
    ? layout.nonActiveBattlefieldY + layout.nonActiveBattlefieldHeight / 2
    : layout.activeBattlefieldY + layout.activeBattlefieldHeight / 2
  const anchorWidth = Math.max(80, Math.min(layout.boardColumnWidth - 24, layout.cardWidth * 2.4))
  const anchorHeight = Math.max(60, Math.min(rowHeight - 12, layout.cardHeight + 16))
  const rowCenter: EffectAnchor = { x: rowCenterX, y: rowCenterY, width: anchorWidth, height: anchorHeight }

  if (descriptor.targetInstanceId) {
    const target = registry.get(descriptor.targetInstanceId)
    const historicalTarget = descriptor.targetPlacement
      ?? previousRegistry.get(descriptor.targetInstanceId)
    if (target) {
      return target
    }
    const projectedTarget = projectedRecord(historicalTarget, layout, activeIndex)
    if (projectedTarget) {
      return projectedTarget
    }
  }

  if (descriptor.sourceInstanceId && descriptor.targetActor === undefined) {
    const source = registry.get(descriptor.sourceInstanceId)
      ?? previousRegistry.get(descriptor.sourceInstanceId)
    if (source) {
      return source
    }
  }

  return rowCenter
}

export function computeEffectSourceAnchor(
  descriptor: EffectDescriptor,
  layout: SceneLayout,
  activeIndex: number,
  registry: ReadonlyMap<string, BattlefieldCardPlacement>,
  previousRegistry: ReadonlyMap<string, BattlefieldCardPlacement> = registry,
): EffectAnchor | undefined {
  if (!descriptor.sourceInstanceId) {
    return undefined
  }
  return registry.get(descriptor.sourceInstanceId)
    ?? projectedRecord(
      descriptor.sourcePlacement ?? previousRegistry.get(descriptor.sourceInstanceId),
      layout,
      activeIndex,
    )
}
