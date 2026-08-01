import type { CounterOption, GameUiState, UiCard } from '../../app/types'

interface ResponseHandGame {
  actor: number
  pendingLandName: string | null
  players: readonly { handCards: readonly UiCard[] }[]
  legal: Pick<GameUiState['legal'], 'counterOptions' | 'canPassResponse'>
}

export interface CounterHandChoice {
  cardId: string
  cardName: string
  action: CounterOption['action']
  a11yLabel: string
}

export interface CounterHandOptions {
  requiredIslandId: string | null
  instruction: string
  choices: CounterHandChoice[]
  canPass: boolean
}

export function buildCounterHandOptions(game: ResponseHandGame): CounterHandOptions {
  const hand = game.players[game.actor]?.handCards ?? []
  const requiredIslandId = hand.find((card) => card.name === 'Island')?.id ?? null
  const choices: CounterHandChoice[] = []

  for (const option of game.legal.counterOptions) {
    const cardId = option.action.discardCardId
    const card = cardId ? hand.find((candidate) => candidate.id === cardId) : undefined
    if (!card || card.id === requiredIslandId) {
      continue
    }
    choices.push({
      cardId: card.id,
      cardName: card.name,
      action: option.action,
      a11yLabel: option.label,
    })
  }

  const targetName = game.pendingLandName ?? 'the land'
  return {
    requiredIslandId,
    instruction: `Counter ${targetName}: tap a highlighted card to discard with Island.`,
    choices,
    canPass: game.legal.canPassResponse,
  }
}
