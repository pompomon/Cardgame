// Strength bands of the non-boss Adventure decks at each AI level. A new run
// deals its decks weakest band first for the level it starts at, and puts
// Extreme decks only at forks; see `generateBranchingAdventureMap`.
//
// A band comes from the deck's game score against the player's standard deck
// at that level, with the player moving first, in
// docs/research/adventure-deck-strength.md#deck-strength-summary: very easy
// below 15%, easy below 40%, even up to 60%, hard up to 85% and extreme
// above. Change a band only with new measurements in that document.
//
// This is a leaf module. It imports only the AI level and band types, never
// `adventure.ts`, persistence, the controller, storage or the DOM.

import type { AiLevel } from '../game/ai-levels'
import type { AdventureDeckBands } from './adventure-map'

export const ADVENTURE_DECK_BANDS: Readonly<Record<AiLevel, AdventureDeckBands>> = Object.freeze({
  basic: Object.freeze({
    standard: 'even',
    'dual-Forest-Island': 'extreme',
    'dual-Forest-Mountain': 'easy',
    'dual-Forest-Plains': 'very-easy',
    'dual-Forest-Swamp': 'easy',
    'dual-Island-Mountain': 'extreme',
    'dual-Island-Plains': 'hard',
    'dual-Island-Swamp': 'hard',
    'dual-Mountain-Plains': 'even',
    'dual-Mountain-Swamp': 'even',
    'dual-Plains-Swamp': 'easy',
    random: 'even',
  }),
  advanced: Object.freeze({
    standard: 'even',
    'dual-Forest-Island': 'hard',
    'dual-Forest-Mountain': 'even',
    'dual-Forest-Plains': 'very-easy',
    'dual-Forest-Swamp': 'easy',
    'dual-Island-Mountain': 'hard',
    'dual-Island-Plains': 'even',
    'dual-Island-Swamp': 'even',
    'dual-Mountain-Plains': 'extreme',
    'dual-Mountain-Swamp': 'hard',
    'dual-Plains-Swamp': 'easy',
    random: 'even',
  }),
  hard: Object.freeze({
    standard: 'even',
    'dual-Forest-Island': 'extreme',
    'dual-Forest-Mountain': 'very-easy',
    'dual-Forest-Plains': 'very-easy',
    'dual-Forest-Swamp': 'very-easy',
    'dual-Island-Mountain': 'even',
    'dual-Island-Plains': 'hard',
    'dual-Island-Swamp': 'hard',
    'dual-Mountain-Plains': 'very-easy',
    'dual-Mountain-Swamp': 'easy',
    'dual-Plains-Swamp': 'very-easy',
    random: 'even',
  }),
})
