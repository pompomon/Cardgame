import type { GameAction } from '../game/types'
import type { GameUiState } from './types'
import { HIDDEN_HAND_CARD_NAME } from './types'

export const HIDDEN_HAND_DISPLAY_NAME = 'Hidden card'

export type DragDropResolution =
  | { kind: 'invalid' }
  | { kind: 'single'; action: Extract<GameAction, { type: 'play_land' }> }
  | {
      kind: 'needs_target'
      options: Array<{ effectTargetId?: string; label: string }>
    }

export type TargetSelectionMode = 'popup_cards' | 'battlefield_highlight'

export type TargetSelectionContext =
  | { kind: 'play_land'; cardId: string }
  | { kind: 'plains_reuse' }

export interface GroupedCardTargetOption {
  effectTargetId?: string
  cardName: string
  count: number
  label: string
}

function sourceCardNameForContext(game: GameUiState, context: TargetSelectionContext): string | null {
  if (context.kind === 'plains_reuse') {
    return game.pendingPlainsReuseName
  }
  const actor = game.actor
  const source = game.players[actor].handCards.find((card) => card.id === context.cardId)
  return source?.name ?? null
}

function targetNameFor(
  game: GameUiState,
  sourceCardName: string,
  effectTargetId: string | undefined,
): string | null {
  if (!effectTargetId) {
    return null
  }
  const actor = game.actor
  const enemy = actor === 0 ? 1 : 0

  if (sourceCardName === 'Forest') {
    return game.players[actor].graveyardCards.find((card) => card.id === effectTargetId)?.name ?? null
  }
  if (sourceCardName === 'Swamp') {
    // Prefer the revealed real name (populated by the view model when the
    // local human is actively choosing a Swamp discard target). Fall back
    // to the projected handCards entry — which is `HIDDEN_HAND_CARD_NAME`
    // in hvai outside the decision — and finally to the display sentinel
    // so the picker keeps a stable label even in unexpected states.
    const revealed = game.revealedEnemyHandForSwamp?.find((card) => card.id === effectTargetId)?.name
    if (revealed) {
      return revealed
    }
    const name = game.players[enemy].handCards.find((card) => card.id === effectTargetId)?.name ?? null
    if (name === HIDDEN_HAND_CARD_NAME) {
      return HIDDEN_HAND_DISPLAY_NAME
    }
    return name
  }
  if (sourceCardName === 'Mountain') {
    return game.players[enemy].battlefield.find((entry) => entry.instanceId === effectTargetId)?.name ?? null
  }
  if (sourceCardName === 'Plains') {
    return game.players[actor].battlefield.find((entry) => entry.instanceId === effectTargetId)?.name ?? null
  }
  return null
}

function selectionModeForSourceCard(sourceCardName: string | null): TargetSelectionMode | null {
  if (sourceCardName === 'Forest' || sourceCardName === 'Swamp') {
    return 'popup_cards'
  }
  if (sourceCardName === 'Mountain' || sourceCardName === 'Plains') {
    return 'battlefield_highlight'
  }
  return null
}

export function resolvePlayLandDrop(game: GameUiState, cardId: string): DragDropResolution {
  const options = game.legal.playLandByCard[cardId]
  if (!options || options.length === 0) {
    return { kind: 'invalid' }
  }

  if (options.length === 1) {
    return { kind: 'single', action: options[0].action }
  }

  return {
    kind: 'needs_target',
    options: options.map((option) => ({
      effectTargetId: option.action.effectTargetId,
      label: option.label,
    })),
  }
}

export function resolvePlayLandTargetSelectionMode(game: GameUiState, cardId: string): TargetSelectionMode | null {
  const options = game.legal.playLandByCard[cardId]
  if (!options || options.length <= 1) {
    return null
  }
  const sourceCardName = sourceCardNameForContext(game, { kind: 'play_land', cardId })
  return selectionModeForSourceCard(sourceCardName)
}

export function resolvePlainsReuseTargetSelectionMode(game: GameUiState): TargetSelectionMode | null {
  if (game.legal.plainsReuseOptions.length <= 1) {
    return null
  }
  return selectionModeForSourceCard(sourceCardNameForContext(game, { kind: 'plains_reuse' }))
}

export function groupCardTargetOptions(
  game: GameUiState,
  context: TargetSelectionContext,
  options: Array<{ effectTargetId?: string; label: string }>,
): GroupedCardTargetOption[] {
  const sourceCardName = sourceCardNameForContext(game, context)
  const grouped = new Map<string, GroupedCardTargetOption>()
  for (const option of options) {
    const cardName = targetNameFor(game, sourceCardName ?? '', option.effectTargetId) ?? option.label
    const existing = grouped.get(cardName)
    if (existing) {
      existing.count += 1
      continue
    }
    grouped.set(cardName, {
      effectTargetId: option.effectTargetId,
      cardName,
      count: 1,
      label: cardName,
    })
  }
  const result = Array.from(grouped.values())
  for (const entry of result) {
    entry.label = entry.count > 1 ? `${entry.cardName} X${entry.count}` : entry.cardName
  }
  return result
}

export function resolveTargetedPlayLandAction(
  game: GameUiState,
  cardId: string,
  effectTargetId?: string,
): Extract<GameAction, { type: 'play_land' }> | null {
  const options = game.legal.playLandByCard[cardId]
  if (!options || options.length === 0) {
    return null
  }

  const match = options.find((option) => option.action.effectTargetId === effectTargetId)
  return match?.action ?? null
}

export function resolvePlainsReuseAction(
  game: GameUiState,
  effectTargetId?: string,
): Extract<GameAction, { type: 'resolve_plains_reuse' }> | null {
  const match = game.legal.plainsReuseOptions.find((option) => option.action.effectTargetId === effectTargetId)
  return match?.action ?? null
}
