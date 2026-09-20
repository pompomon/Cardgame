import type { GameState } from '../game/types'
import { cardCatalogEntry } from './card-catalog'
import { targetPromptForCard } from './game-presentation'

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

const dryad = cardCatalogEntry('Forest')
const siren = cardCatalogEntry('Island')
const gargoyle = cardCatalogEntry('Mountain')
const echo = cardCatalogEntry('Plains')
const vampire = cardCatalogEntry('Swamp')

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'play-island-first',
    hint: `Summon ${siren.displayName}. Your opponent has a ${siren.displayName} and will use ${siren.responseAbility!.name} on your first summon.`,
    condition: (game) => canPlayMainLand(game)
      && handHas(game, 0, 'Island')
      && game.players[0].battlefield.length === 0
      && game.players[0].graveyard.length === 0,
  },
  {
    id: 'island-countered',
    hint: `Your opponent may use ${siren.responseAbility!.name} now by discarding ${siren.displayName} and one other card. If they do, your ${siren.displayName} goes to your discard pile.`,
    condition: (game) => game.phase === 'respond',
  },
  {
    id: 'play-forest',
    hint: `Summon ${dryad.displayName}. ${dryad.primaryAbility.name} returns ${siren.displayName} from your discard pile to your hand.`,
    condition: (game) => canPlayMainLand(game)
      && handHas(game, 0, 'Forest')
      && game.players[0].graveyard.length > 0
      && !battlefieldHas(game, 0, 'Forest'),
  },
  {
    id: 'play-island-draw',
    hint: `Summon ${siren.displayName} again. ${siren.primaryAbility.name} draws one card.`,
    condition: (game) => canPlayMainLand(game)
      && handHas(game, 0, 'Island')
      && battlefieldHas(game, 0, 'Forest')
      && !battlefieldHas(game, 0, 'Island'),
  },
  {
    id: 'play-mountain',
    hint: `Choose an opposing creature for ${gargoyle.primaryAbility.name}, then summon ${gargoyle.displayName} to send it to its owner's discard pile.`,
    condition: (game) => canPlayMainLand(game)
      && handHas(game, 0, 'Mountain')
      && game.players[1].battlefield.length > 0
      && !battlefieldHas(game, 0, 'Mountain'),
  },
  {
    id: 'play-swamp',
    hint: `Summon ${vampire.displayName}, then use ${vampire.primaryAbility.name} to choose one card from your opponent's hand for them to discard.`,
    condition: (game) => canPlayMainLand(game)
      && handHas(game, 0, 'Swamp')
      && game.players[1].hand.length > 0
      && battlefieldHas(game, 0, 'Mountain')
      && !battlefieldHas(game, 0, 'Swamp'),
  },
  {
    id: 'swamp-target',
    hint: `${vampire.primaryAbility.name}: ${targetPromptForCard('Swamp')}`,
    condition: (game) => game.phase === 'swamp_target',
  },
  {
    id: 'play-plains',
    hint: `Choose one of your creatures other than ${echo.displayName} for ${echo.primaryAbility.name}, then summon ${echo.displayName} to repeat its ability.`,
    condition: (game) => canPlayMainLand(game)
      && handHas(game, 0, 'Plains')
      && battlefieldHas(game, 0, 'Swamp')
      && !battlefieldHas(game, 0, 'Plains'),
  },
  {
    id: 'plains-target',
    hint: `${echo.primaryAbility.name}: Choose a target for the repeated ability.`,
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
      if (step.id === 'plains-target') {
        const reusedName = game.pendingPlainsReuse?.reusedCardName
        if (reusedName === 'Forest' || reusedName === 'Mountain' || reusedName === 'Swamp') {
          return {
            ...step,
            hint: `${echo.primaryAbility.name} — ${cardCatalogEntry(reusedName).primaryAbility.name}: ${targetPromptForCard(reusedName)}`,
          }
        }
      }
      return step
    }
  }
  return null
}
