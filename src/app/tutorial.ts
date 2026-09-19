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
    hint: 'Summon Signal Siren. Your opponent has a Signal Siren and will intercept your first summon.',
    condition: (game) => canPlayMainLand(game)
      && handHas(game, 0, 'Island')
      && game.players[0].battlefield.length === 0
      && game.players[0].graveyard.length === 0,
  },
  {
    id: 'island-countered',
    hint: 'Your opponent may intercept now by discarding Signal Siren and one other card. If they do, your Signal Siren goes to your discard pile.',
    condition: (game) => game.phase === 'respond',
  },
  {
    id: 'play-forest',
    hint: 'Summon Gravebloom Dryad to reclaim Signal Siren from your discard pile.',
    condition: (game) => canPlayMainLand(game)
      && handHas(game, 0, 'Forest')
      && game.players[0].graveyard.length > 0
      && !battlefieldHas(game, 0, 'Forest'),
  },
  {
    id: 'play-island-draw',
    hint: 'Summon Signal Siren again. Listen In draws one card.',
    condition: (game) => canPlayMainLand(game)
      && handHas(game, 0, 'Island')
      && battlefieldHas(game, 0, 'Forest')
      && !battlefieldHas(game, 0, 'Island'),
  },
  {
    id: 'play-mountain',
    hint: "Summon Rooftop Gargoyle, then choose an opposing creature to banish to its owner's discard pile.",
    condition: (game) => canPlayMainLand(game)
      && handHas(game, 0, 'Mountain')
      && game.players[1].battlefield.length > 0
      && !battlefieldHas(game, 0, 'Mountain'),
  },
  {
    id: 'play-swamp',
    hint: "Summon Memory Vampire, then choose one card from your opponent's hand for them to discard.",
    condition: (game) => canPlayMainLand(game)
      && handHas(game, 0, 'Swamp')
      && game.players[1].hand.length > 0
      && battlefieldHas(game, 0, 'Mountain')
      && !battlefieldHas(game, 0, 'Swamp'),
  },
  {
    id: 'swamp-target',
    hint: "Choose a card from your opponent's hand for them to discard.",
    condition: (game) => game.phase === 'swamp_target',
  },
  {
    id: 'play-plains',
    hint: 'Summon Echo Doppelgänger, then choose one of your other creatures whose ability it should mimic.',
    condition: (game) => canPlayMainLand(game)
      && handHas(game, 0, 'Plains')
      && battlefieldHas(game, 0, 'Swamp')
      && !battlefieldHas(game, 0, 'Plains'),
  },
  {
    id: 'plains-target',
    hint: 'Choose one of your other creatures whose ability Echo Doppelgänger should repeat.',
    condition: (game) => game.phase === 'plains_target',
  },
  {
    id: 'win',
    hint: 'You won by summoning all five creature types to your board. Tutorial complete!',
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
