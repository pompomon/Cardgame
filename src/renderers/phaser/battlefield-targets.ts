// Battlefield target *state*: tracks the pending "play land needs a target"
// selection, computes which battlefield cards are currently eligible click
// targets, and exposes their a11y labels. Pure state/derivation — no Phaser
// rendering here (the modal popup UI lives in target-picker.ts). Extracted
// from target-selection.ts so the game-state predicates can be unit tested
// without a Phaser scene.
import {
  resolvePlainsReuseTargetSelectionMode,
  resolvePlayLandTargetSelectionMode,
  resolveTargetedPlayLandAction,
} from '../../app/action-resolution'
import type { GameUiState } from '../../app/types'
import type { GameAction } from '../../game/types'

export type BattlefieldTargetOwner = 'active' | 'non-active'

export type BattlefieldTargetEntry = {
  owner: BattlefieldTargetOwner
  effectTargetId: string
  cardName: string
  onSelect: () => void
}

export type PendingPlayLandTargetSelection = {
  cardId: string
  options: Array<{ effectTargetId?: string; label: string }>
} | null

export type A11yEntry = { key: string; label: string; onSelect: () => void }

// Pure computation: given the current game state, the pending play-land
// target selection (if any), whether the menu overlay is open, and a
// submit callback, returns the list of battlefield cards that should be
// rendered as highlighted/clickable targets right now. Exported directly so
// it can be unit tested with a fabricated GameUiState fixture and a spy
// submit function, independent of any Phaser rendering.
export function computeBattlefieldTargetEntries(
  game: GameUiState,
  pending: PendingPlayLandTargetSelection,
  menuOpen: boolean,
  submitAction: (action: GameAction) => void,
  onPlayLandTargetResolved: () => void,
): BattlefieldTargetEntry[] {
  const entries: BattlefieldTargetEntry[] = []
  if (!game.canInput || menuOpen) {
    return entries
  }

  if (game.phase === 'main' && pending) {
    const { cardId, options } = pending
    if (resolvePlayLandTargetSelectionMode(game, cardId) !== 'battlefield_highlight') {
      return entries
    }
    const actor = game.actor
    const enemy = actor === 0 ? 1 : 0
    const sourceCard = game.players[actor].handCards.find((card) => card.id === cardId)
    const owner: BattlefieldTargetOwner = sourceCard?.name === 'Mountain' ? 'non-active' : 'active'
    const lookupPlayer = owner === 'active' ? actor : enemy
    for (const option of options) {
      if (!option.effectTargetId) {
        continue
      }
      const action = resolveTargetedPlayLandAction(game, cardId, option.effectTargetId)
      if (!action) {
        continue
      }
      const targetName = game.players[lookupPlayer].battlefield.find((entry) => entry.instanceId === option.effectTargetId)?.name ?? 'Target'
      entries.push({
        owner,
        effectTargetId: option.effectTargetId,
        cardName: targetName,
        onSelect: () => {
          onPlayLandTargetResolved()
          submitAction(action)
        },
      })
    }
    return entries
  }

  if (game.phase === 'plains_target' && resolvePlainsReuseTargetSelectionMode(game) === 'battlefield_highlight') {
    const owner: BattlefieldTargetOwner = game.pendingPlainsReuseName === 'Mountain' ? 'non-active' : 'active'
    const actor = game.actor
    const enemy = actor === 0 ? 1 : 0
    const lookupPlayer = owner === 'active' ? actor : enemy
    for (const option of game.legal.plainsReuseOptions) {
      const targetId = option.action.effectTargetId
      if (!targetId) {
        continue
      }
      const targetName = game.players[lookupPlayer].battlefield.find((entry) => entry.instanceId === targetId)?.name ?? 'Target'
      entries.push({
        owner,
        effectTargetId: targetId,
        cardName: targetName,
        onSelect: () => {
          submitAction(option.action)
        },
      })
    }
  }
  return entries
}

// Pure derivation of the a11y nav labels for the current battlefield target
// entries, deduplicating repeated card names with "(n/total)" suffixes so
// e.g. two highlighted Forests read as "Target Forest (1/2)"/"(2/2)".
// Exported directly for focused unit testing.
export function battlefieldTargetA11yEntries(entries: readonly BattlefieldTargetEntry[]): A11yEntry[] {
  const totalByName = new Map<string, number>()
  for (const entry of entries) {
    totalByName.set(entry.cardName, (totalByName.get(entry.cardName) ?? 0) + 1)
  }
  const seenByName = new Map<string, number>()
  return entries.map((entry) => {
    const seen = (seenByName.get(entry.cardName) ?? 0) + 1
    seenByName.set(entry.cardName, seen)
    const total = totalByName.get(entry.cardName) ?? 1
    return {
      key: `battlefield-target:${entry.owner}:${entry.effectTargetId}`,
      label: total > 1 ? `Target ${entry.cardName} (${seen}/${total})` : `Target ${entry.cardName}`,
      onSelect: entry.onSelect,
    }
  })
}

export interface BattlefieldTargetsContext {
  submitAction: (action: GameAction) => void
  isMenuOpen: () => boolean
}

export class BattlefieldTargetsController {
  private readonly ctx: BattlefieldTargetsContext
  private pendingPlayLandTargetSelection: PendingPlayLandTargetSelection = null
  private battlefieldTargetEntries: BattlefieldTargetEntry[] = []

  constructor(ctx: BattlefieldTargetsContext) {
    this.ctx = ctx
  }

  getPendingPlayLandTargetSelection(): PendingPlayLandTargetSelection {
    return this.pendingPlayLandTargetSelection
  }

  beginPlayLandTargetSelection(cardId: string, options: Array<{ effectTargetId?: string; label: string }>): void {
    this.pendingPlayLandTargetSelection = { cardId, options }
  }

  clearPendingPlayLandTargetSelection(): void {
    this.pendingPlayLandTargetSelection = null
  }

  getBattlefieldTargetEntries(): BattlefieldTargetEntry[] {
    return this.battlefieldTargetEntries
  }

  reset(): void {
    this.pendingPlayLandTargetSelection = null
    this.battlefieldTargetEntries = []
  }

  // Called from CardgameScene.clearRoot() on every render pass, after the
  // root container has already been cleared. Drops the stale entries list
  // without touching `pendingPlayLandTargetSelection`, which renderView's
  // syncPendingPlayLandTargetSelection() re-validates against the latest
  // legal actions instead.
  clearTransientEntries(): void {
    this.battlefieldTargetEntries = []
  }

  syncPendingPlayLandTargetSelection(game: GameUiState): void {
    const pending = this.pendingPlayLandTargetSelection
    if (!pending) {
      return
    }
    if (!game.canInput || game.phase !== 'main') {
      this.pendingPlayLandTargetSelection = null
      return
    }
    const legalOptions = game.legal.playLandByCard[pending.cardId]
    if (!legalOptions || legalOptions.length <= 1) {
      this.pendingPlayLandTargetSelection = null
      return
    }
    const legalTargetIds = new Set(legalOptions.map((option) => option.action.effectTargetId).filter((id): id is string => typeof id === 'string'))
    const stillValid = pending.options.filter((option) => option.effectTargetId && legalTargetIds.has(option.effectTargetId))
    if (stillValid.length === 0) {
      this.pendingPlayLandTargetSelection = null
      return
    }
    this.pendingPlayLandTargetSelection = {
      ...pending,
      options: stillValid,
    }
  }

  updateBattlefieldTargetEntries(game: GameUiState): void {
    this.battlefieldTargetEntries = computeBattlefieldTargetEntries(
      game,
      this.pendingPlayLandTargetSelection,
      this.ctx.isMenuOpen(),
      this.ctx.submitAction,
      () => { this.pendingPlayLandTargetSelection = null },
    )
  }

  findBattlefieldTargetEntry(owner: BattlefieldTargetOwner, effectTargetId: string): BattlefieldTargetEntry | null {
    return this.battlefieldTargetEntries.find((entry) => entry.owner === owner && entry.effectTargetId === effectTargetId) ?? null
  }

  getBattlefieldTargetA11yEntries(): A11yEntry[] {
    return battlefieldTargetA11yEntries(this.battlefieldTargetEntries)
  }
}
