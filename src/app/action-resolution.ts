import type { GameAction } from '../game/types'
import { isBasicLand, type BasicLand } from '../game/types'
import { displayCardName } from './card-catalog'
import { targetPromptForCard } from './game-presentation'
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
  | { kind: 'swamp_discard' }

export interface GroupedCardTargetOption {
  effectTargetId?: string
  cardName: string
  serializedKey?: BasicLand
  displayName: string
  count: number
  label: string
}

interface ProjectedCardIdentity {
  readonly serializedKey?: BasicLand
  readonly legacyName: string
  readonly displayName: string
}

function serializedKeyForCard(
  card: { readonly name: string; readonly serializedKey?: BasicLand } | undefined,
): BasicLand | null {
  if (!card) {
    return null
  }
  if (card.serializedKey) {
    return card.serializedKey
  }
  return isBasicLand(card.name) ? card.name : null
}

function projectedCardIdentity(
  card: {
    readonly name: string
    readonly serializedKey?: BasicLand
    readonly displayName?: string
  } | undefined,
): ProjectedCardIdentity | null {
  if (!card) {
    return null
  }
  const serializedKey = serializedKeyForCard(card)
  if (serializedKey) {
    return {
      serializedKey,
      legacyName: card.name,
      displayName: card.displayName ?? displayCardName(serializedKey),
    }
  }
  if (card.name === HIDDEN_HAND_CARD_NAME) {
    return {
      legacyName: HIDDEN_HAND_CARD_NAME,
      displayName: HIDDEN_HAND_DISPLAY_NAME,
    }
  }
  return {
    legacyName: card.name,
    displayName: card.displayName ?? card.name,
  }
}

function sourceCardKeyForContext(
  game: GameUiState,
  context: TargetSelectionContext,
): BasicLand | null {
  if (context.kind === 'plains_reuse') {
    return game.pendingPlainsReuseName
  }
  if (context.kind === 'swamp_discard') {
    return 'Swamp'
  }
  const actor = game.actor
  const source = game.players[actor].handCards.find((card) => card.id === context.cardId)
  return serializedKeyForCard(source)
}

function targetIdentityFor(
  game: GameUiState,
  sourceCardKey: BasicLand | null,
  effectTargetId: string | undefined,
): ProjectedCardIdentity | null {
  if (!effectTargetId) {
    return null
  }
  const actor = game.actor
  const enemy = actor === 0 ? 1 : 0

  if (sourceCardKey === 'Forest') {
    return projectedCardIdentity(
      game.players[actor].graveyardCards.find((card) => card.id === effectTargetId),
    )
  }
  if (sourceCardKey === 'Swamp') {
    // Prefer the revealed real name (populated by the view model when the
    // local human is actively choosing a Swamp discard target). Fall back
    // to the projected handCards entry — which is `HIDDEN_HAND_CARD_NAME`
    // in hvai outside the decision — and finally to the display sentinel
    // so the picker keeps a stable label even in unexpected states.
    const revealed = game.revealedEnemyHandForSwamp?.find((card) => card.id === effectTargetId)
    if (revealed) {
      return projectedCardIdentity(revealed)
    }
    return projectedCardIdentity(
      game.players[enemy].handCards.find((card) => card.id === effectTargetId),
    )
  }
  if (sourceCardKey === 'Mountain') {
    return projectedCardIdentity(
      game.players[enemy].battlefield.find((entry) => entry.instanceId === effectTargetId),
    )
  }
  if (sourceCardKey === 'Plains') {
    return projectedCardIdentity(
      game.players[actor].battlefield.find((entry) => entry.instanceId === effectTargetId),
    )
  }
  return null
}

function selectionModeForSourceCard(sourceCardKey: BasicLand | null): TargetSelectionMode | null {
  if (sourceCardKey === 'Forest' || sourceCardKey === 'Swamp') {
    return 'popup_cards'
  }
  if (sourceCardKey === 'Mountain' || sourceCardKey === 'Plains') {
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
  const sourceCardKey = sourceCardKeyForContext(game, { kind: 'play_land', cardId })
  return selectionModeForSourceCard(sourceCardKey)
}

export function resolvePlainsReuseTargetSelectionMode(game: GameUiState): TargetSelectionMode | null {
  if (game.legal.plainsReuseOptions.length <= 1) {
    return null
  }
  return selectionModeForSourceCard(sourceCardKeyForContext(game, { kind: 'plains_reuse' }))
}

export function resolveSwampDiscardTargetSelectionMode(game: GameUiState): TargetSelectionMode | null {
  if (game.legal.swampDiscardOptions.length <= 1) {
    return null
  }
  return selectionModeForSourceCard(sourceCardKeyForContext(game, { kind: 'swamp_discard' }))
}

export function targetPromptForContext(
  game: GameUiState,
  context: TargetSelectionContext,
): string {
  return targetPromptForCard(sourceCardKeyForContext(game, context))
}

export function groupCardTargetOptions(
  game: GameUiState,
  context: TargetSelectionContext,
  options: Array<{ effectTargetId?: string; label: string }>,
): GroupedCardTargetOption[] {
  const sourceCardKey = sourceCardKeyForContext(game, context)
  const grouped = new Map<string, GroupedCardTargetOption>()
  for (const option of options) {
    const identity = targetIdentityFor(game, sourceCardKey, option.effectTargetId)
    const displayName = identity?.displayName ?? option.label
    const existing = grouped.get(displayName)
    if (existing) {
      existing.count += 1
      continue
    }
    grouped.set(displayName, {
      effectTargetId: option.effectTargetId,
      cardName: identity?.legacyName ?? option.label,
      ...(identity?.serializedKey ? { serializedKey: identity.serializedKey } : {}),
      displayName,
      count: 1,
      label: displayName,
    })
  }
  const result = Array.from(grouped.values())
  for (const entry of result) {
    entry.label = entry.count > 1 ? `${entry.displayName} X${entry.count}` : entry.displayName
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

export function resolveSwampDiscardAction(
  game: GameUiState,
  effectTargetId?: string,
): Extract<GameAction, { type: 'resolve_swamp_discard' }> | null {
  const match = game.legal.swampDiscardOptions.find((option) => option.action.effectTargetId === effectTargetId)
  return match?.action ?? null
}
