import type { GameState } from '../game/types'

export interface TutorialStep {
  id: string
  hint: string
  condition: (game: GameState) => boolean
}

function handHas(game: GameState, player: 0 | 1, cardName: 'Forest' | 'Island' | 'Mountain' | 'Plains' | 'Swamp'): boolean {
  return game.players[player].hand.some((card) => card.name === cardName)
}

function battlefieldHas(game: GameState, player: 0 | 1, cardName: 'Forest' | 'Island' | 'Mountain' | 'Plains' | 'Swamp'): boolean {
  return game.players[player].battlefield.some((entry) => entry.card.name === cardName)
}

function canPlayMainLand(game: GameState): boolean {
  return game.phase === 'main' && game.currentPlayer === 0 && game.players[0].landsPlayedThisTurn < 1
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'play-island-first',
    hint: 'Play Island. Your opponent has an Island and will counter your first play — this demonstrates the counter mechanic.',
    condition: (game) => canPlayMainLand(game)
      && handHas(game, 0, 'Island')
      && game.players[0].battlefield.length === 0,
  },
  {
    id: 'island-countered',
    hint: 'The opponent used Island to counter your land! They discard Island plus one other card, and your Island goes to your graveyard.',
    condition: (game) => game.phase === 'respond',
  },
  {
    id: 'play-forest',
    hint: 'Your Island is in your graveyard. Play Forest to return it to your hand.',
    condition: (game) => canPlayMainLand(game)
      && handHas(game, 0, 'Forest')
      && game.players[0].graveyard.length > 0,
  },
  {
    id: 'play-island-draw',
    hint: "You retrieved Island. Play it now to draw an extra card with Island's ability.",
    condition: (game) => canPlayMainLand(game)
      && handHas(game, 0, 'Island')
      && battlefieldHas(game, 0, 'Forest'),
  },
  {
    id: 'play-mountain',
    hint: "Play Mountain to destroy one of your opponent's battlefield lands.",
    condition: (game) => canPlayMainLand(game)
      && handHas(game, 0, 'Mountain')
      && game.players[1].battlefield.length > 0,
  },
  {
    id: 'play-swamp',
    hint: "Play Swamp to make your opponent discard a card from hand. Choose the card to discard.",
    condition: (game) => canPlayMainLand(game)
      && handHas(game, 0, 'Swamp')
      && game.players[1].hand.length > 0
      && battlefieldHas(game, 0, 'Mountain'),
  },
  {
    id: 'play-plains',
    hint: 'Play Plains to reuse one of your battlefield land abilities. You will pick the target land.',
    condition: (game) => canPlayMainLand(game)
      && handHas(game, 0, 'Plains')
      && battlefieldHas(game, 0, 'Swamp'),
  },
  {
    id: 'plains-target',
    hint: 'Choose which land ability Plains should reuse. Try Island for card draw or Mountain for removal.',
    condition: (game) => game.phase === 'plains_target',
  },
  {
    id: 'win',
    hint: 'You won by placing 5 different land types on your battlefield. Tutorial complete!',
    condition: (game) => game.phase === 'gameOver' && game.winner === 0,
  },
]

export function getCurrentTutorialStep(game: GameState): TutorialStep | null {
  for (const step of TUTORIAL_STEPS) {
    if (step.condition(game)) {
      return step
    }
  }
  return null
}
