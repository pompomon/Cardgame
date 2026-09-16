import { isBasicLand, type BasicLand } from '../game/types'
import { displayCardName } from './card-catalog'
import type { CounterOption, GameUiState, UiCard } from './types'

interface ResponseHandGame {
  actor: number
  pendingLandName: string | null
  pendingLandDisplayName?: string | null
  players: readonly { handCards: readonly UiCard[] }[]
  legal: Pick<GameUiState['legal'], 'counterOptions' | 'canPassResponse'>
}

export interface CounterHandChoice {
  cardId: string
  cardName: string
  serializedKey?: BasicLand
  displayName: string
  action: CounterOption['action']
  a11yLabel: string
}

export interface CounterHandOptions {
  requiredIslandId: string | null
  requiredCardDisplayName: string
  instruction: string
  requiredCardHint: string
  choices: CounterHandChoice[]
  canPass: boolean
  passLabel: string
}

function serializedKeyForCard(card: UiCard): BasicLand | null {
  if (card.serializedKey) {
    return card.serializedKey
  }
  return isBasicLand(card.name) ? card.name : null
}

export function buildCounterHandOptions(game: ResponseHandGame): CounterHandOptions {
  const hand = game.players[game.actor]?.handCards ?? []
  const requiredIslandId = hand.find((card) => serializedKeyForCard(card) === 'Island')?.id ?? null
  const choices: CounterHandChoice[] = []

  for (const option of game.legal.counterOptions) {
    const cardId = option.action.discardCardId
    const card = cardId ? hand.find((candidate) => candidate.id === cardId) : undefined
    if (!card || card.id === requiredIslandId) {
      continue
    }
    const serializedKey = serializedKeyForCard(card)
    choices.push({
      cardId: card.id,
      cardName: card.name,
      ...(serializedKey ? { serializedKey } : {}),
      displayName: card.displayName
        ?? (serializedKey ? displayCardName(serializedKey) : card.name),
      action: option.action,
      a11yLabel: option.label,
    })
  }

  const targetName = game.pendingLandDisplayName
    ?? (isBasicLand(game.pendingLandName) ? displayCardName(game.pendingLandName) : 'the creature')
  return {
    requiredIslandId,
    requiredCardDisplayName: displayCardName('Island'),
    instruction: `Intercept the summon of ${targetName}? Discard Signal Siren and one other highlighted card, or choose Let It Through.`,
    requiredCardHint: 'Signal Siren is included automatically; choose the other card to discard.',
    choices,
    canPass: game.legal.canPassResponse,
    passLabel: 'Let It Through',
  }
}
