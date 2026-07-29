import type { GameAction } from '../../game/types'
import type { CounterOption, GameUiState, UiCard } from '../../app/types'

interface ResponsePickerGame {
  actor: number
  pendingLandName: string | null
  players: readonly { handCards: readonly UiCard[] }[]
  legal: Pick<GameUiState['legal'], 'counterOptions' | 'canPassResponse'>
}

export interface ResponsePickerOption {
  effectTargetId: string
  label: string
  a11yLabel?: string
  action: GameAction
}

function compactCounterLabel(
  game: ResponsePickerGame,
  option: CounterOption,
): string {
  const targetName = game.pendingLandName ?? 'a land'
  const discardName = game.players[game.actor]?.handCards
    .find((card) => card.id === option.action.discardCardId)?.name ?? 'another card'
  return `Counter ${targetName}\nDiscard Island + ${discardName}`
}

export function buildResponsePickerOptions(game: ResponsePickerGame): ResponsePickerOption[] {
  const options = game.legal.counterOptions.map((option, index) => ({
    effectTargetId: `respond-counter-${index}`,
    label: compactCounterLabel(game, option),
    a11yLabel: option.label,
    action: option.action,
  }))
  if (game.legal.canPassResponse) {
    options.push({
      effectTargetId: 'respond-pass',
      label: 'Pass',
      a11yLabel: 'Pass',
      action: { type: 'pass_response', actor: game.actor },
    })
  }
  return options
}
