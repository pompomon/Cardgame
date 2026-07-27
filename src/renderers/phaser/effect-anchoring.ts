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
import type { SceneLayout } from './layout'

// Compute the anchor rectangle for the given descriptor, consulting
// `registry` for card-specific positions when applicable.
//
// `registry` maps instanceId → EffectAnchor and is populated (and cleared)
// by CardgameScene.renderBattlefields on every render pass.
export function computeEffectAnchorFromLayout(
  view: AppViewModel,
  descriptor: EffectDescriptor,
  layout: SceneLayout,
  registry: ReadonlyMap<string, EffectAnchor>,
): EffectAnchor {
  const game = view.game
  const activeIndex = game?.actor ?? 0
  const nonActiveIndex = activeIndex === 0 ? 1 : 0

  // Determine whether the visual effect targets the non-active row.
  const targetsNonActive = descriptor.kind === 'mountain_destroy'
    || descriptor.kind === 'swamp_discard'
    || descriptor.kind === 'counter_resolved'
  const useNonActive = targetsNonActive
    ? descriptor.actor === activeIndex
    : descriptor.actor === nonActiveIndex

  // Row-center fallback dimensions.
  const rowCenterX = layout.boardColumnLeft + layout.boardColumnWidth / 2
  const rowHeight = useNonActive ? layout.nonActiveBattlefieldHeight : layout.activeBattlefieldHeight
  const rowCenterY = useNonActive
    ? layout.nonActiveBattlefieldY + layout.nonActiveBattlefieldHeight / 2
    : layout.activeBattlefieldY + layout.activeBattlefieldHeight / 2
  const anchorWidth = Math.max(80, Math.min(layout.boardColumnWidth - 24, layout.cardWidth * 2.4))
  const anchorHeight = Math.max(60, Math.min(rowHeight - 12, layout.cardHeight + 16))
  const rowCenter: EffectAnchor = { x: rowCenterX, y: rowCenterY, width: anchorWidth, height: anchorHeight }

  // Card-level anchoring for play_land (last matching card in actor's
  // battlefield — the one just played) and plains_reuse (first matching
  // card — already on the battlefield).
  if (!game || !descriptor.cardName) {
    return rowCenter
  }

  let cardAnchor: EffectAnchor | null = null
  if (descriptor.kind === 'play_land' || descriptor.kind === 'plains_reuse') {
    const battlefield = game.players[descriptor.actor]?.battlefield ?? []
    const matchingCards = battlefield.filter(c => c.name === descriptor.cardName)
    // play_land → most recently played card (last match)
    // plains_reuse → first matching card (already on board)
    const targetCard = descriptor.kind === 'play_land'
      ? matchingCards[matchingCards.length - 1]
      : matchingCards[0]
    if (targetCard) {
      const registered = registry.get(targetCard.instanceId)
      if (registered) {
        cardAnchor = registered
      }
    }
  }

  return cardAnchor ?? rowCenter
}
