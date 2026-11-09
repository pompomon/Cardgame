// Adventure encounter setup: how owned relics change the player's opening
// hand. Planning reads the relics once for each committed attempt, and the
// opening guarantee reorders a copy of the player's deck so that
// `createInitialGame` deals each guaranteed creature.
//
// This is a leaf module. It imports the generic engine setup option, game
// types, the reward rules and the shared validators, never `adventure.ts`,
// persistence, the controller, storage or the DOM. Run progression does not
// call it yet.

import { DEFAULT_OPENING_HAND_SIZE, type InitialGameOptions } from '../game/engine'
import { BASIC_LANDS, isBasicLand, type BasicLand, type Card } from '../game/types'
import {
  adventureRewardCatalogEntry,
  cloneAdventureRelics,
  consumeAdventureRelicCharge,
  isAdventureRelicInventory,
  type AdventureRelic,
} from './adventure-rewards'
import { isIntegerInRange, isRecordObject } from './validators'

/** Most cards in the player's opening hand, whatever relics the run owns. */
export const ADVENTURE_MAX_OPENING_HAND_SIZE = 8

/** How relics change the player's opening hand in one encounter attempt. */
export interface AdventureEncounterSetup {
  /** Cards in the player's opening hand, from 5 to 8. */
  readonly playerOpeningHandSize: number
  /** Creatures the opening hand includes: unique, in `BASIC_LANDS` order. */
  readonly guaranteedCreatures: readonly BasicLand[]
}

/** The setup of a newly committed attempt and fresh copies of the relics after it. */
export interface AdventureEncounterSetupPlan {
  setup: AdventureEncounterSetup
  relics: AdventureRelic[]
}

/** `createInitialGame` decks and options for an encounter. */
export interface AdventureEncounterGameSetup {
  decks: [Card[], Card[]]
  options: InitialGameOptions
}

/**
 * Guard for an encounter setup: an integer opening hand from 5 to 8 and
 * known creatures in strictly increasing `BASIC_LANDS` order, so each
 * appears at most once. Unknown keys are ignored.
 */
export function isAdventureEncounterSetup(value: unknown): value is AdventureEncounterSetup {
  if (!isRecordObject(value)) return false
  const { playerOpeningHandSize, guaranteedCreatures } = value
  if (!isIntegerInRange(playerOpeningHandSize, DEFAULT_OPENING_HAND_SIZE, ADVENTURE_MAX_OPENING_HAND_SIZE)) {
    return false
  }
  if (!Array.isArray(guaranteedCreatures)) return false
  let previousRank = -1
  for (const land of guaranteedCreatures) {
    if (!isBasicLand(land) || BASIC_LANDS.indexOf(land) <= previousRank) return false
    previousRank = BASIC_LANDS.indexOf(land)
  }
  return true
}

/** A detached copy of the known setup fields; unknown keys are dropped. */
export function cloneAdventureEncounterSetup(setup: AdventureEncounterSetup): AdventureEncounterSetup {
  return {
    playerOpeningHandSize: setup.playerOpeningHandSize,
    guaranteedCreatures: [...setup.guaranteedCreatures],
  }
}

/**
 * The setup of a newly committed encounter attempt and the relics after it
 * starts. The opening hand has 5 cards, one more with Prepared Pack and two
 * more while Scout's Cache holds a charge, never more than 8. Scout's Cache
 * uses that charge, so the returned relics hold one charge fewer. Each charm
 * guarantees its creature. Guardian Sigil and Streak Anchor do not change
 * setup. Plan once for each attempt and keep the setup for its restarts:
 * planning again uses another Scout's Cache charge. Throws `RangeError` for
 * an invalid relic inventory.
 */
export function planAdventureEncounterSetup(relics: readonly AdventureRelic[]): AdventureEncounterSetupPlan {
  if (!isAdventureRelicInventory(relics)) {
    throw new RangeError('Adventure encounter setup needs a valid relic inventory.')
  }
  let remaining = cloneAdventureRelics(relics)
  let bonusCards = 0
  const creatures = new Set<BasicLand>()
  for (const relic of relics) {
    const effect = adventureRewardCatalogEntry(relic.id).effect
    switch (effect.kind) {
      case 'opening-hand-bonus':
        if (effect.scope === 'every-encounter') {
          bonusCards += effect.cards
        } else if ('charges' in relic) {
          const used = consumeAdventureRelicCharge(remaining, relic.id)
          if (used !== null) {
            remaining = used
            bonusCards += effect.cards
          }
        }
        break
      case 'guarantee-creature':
        creatures.add(effect.land)
        break
      default:
        // Every other effect applies at a run transition, not during setup.
        break
    }
  }
  return {
    setup: {
      playerOpeningHandSize: Math.min(ADVENTURE_MAX_OPENING_HAND_SIZE, DEFAULT_OPENING_HAND_SIZE + bonusCards),
      guaranteedCreatures: BASIC_LANDS.filter((land) => creatures.has(land)),
    },
    relics: remaining,
  }
}

/**
 * A copy of the player's deck whose first `playerOpeningHandSize` cards,
 * the opening window, include each guaranteed creature. It keeps every card
 * and moves as few as it can:
 *
 * 1. Each guaranteed creature already in the window claims its first copy
 *    there.
 * 2. Each creature still missing, in `BASIC_LANDS` order, swaps its first
 *    copy after the window with the unclaimed window card nearest the end
 *    of the window, then claims that slot.
 *
 * A claimed card never moves, so only cards the setup does not need, or
 * extra copies, leave the window. The input deck is not changed. Throws
 * `RangeError` for an invalid setup, a deck shorter than the opening hand,
 * or a guaranteed creature the deck lacks.
 */
export function guaranteeAdventureOpeningCreatures(deck: readonly Card[], setup: AdventureEncounterSetup): Card[] {
  if (!isAdventureEncounterSetup(setup)) {
    throw new RangeError('Adventure opening guarantees need a valid encounter setup.')
  }
  const handSize = setup.playerOpeningHandSize
  if (!Array.isArray(deck) || deck.length < handSize) {
    throw new RangeError(`An opening hand of ${handSize} cards needs a deck of at least ${handSize} cards.`)
  }
  const result = deck.map((card) => ({ ...card }))
  const claimed = Array.from({ length: handSize }, () => false)
  const missing: BasicLand[] = []
  for (const creature of setup.guaranteedCreatures) {
    const index = result.findIndex((card, position) => position < handSize && card.name === creature)
    if (index === -1) {
      missing.push(creature)
    } else {
      claimed[index] = true
    }
  }
  for (const creature of missing) {
    const source = result.findIndex((card, position) => position >= handSize && card.name === creature)
    if (source === -1) {
      throw new RangeError(`The deck has no ${creature} card to guarantee.`)
    }
    // At most five creatures are guaranteed and the window holds at least
    // five cards, so an unclaimed slot remains.
    const target = claimed.lastIndexOf(false)
    const displaced = result[target]
    result[target] = result[source]
    result[source] = displaced
    claimed[target] = true
  }
  return result
}

/**
 * `createInitialGame` arguments for an encounter: the player's deck with
 * each guaranteed creature in the opening window, a copy of the opponent's
 * deck, and opening hand sizes `[playerOpeningHandSize, 5]`. Relics change
 * only the player's hand; the opponent always draws the default hand.
 * Throws like `guaranteeAdventureOpeningCreatures`.
 */
export function adventureEncounterGameSetup(
  setup: AdventureEncounterSetup,
  decks: readonly [readonly Card[], readonly Card[]],
): AdventureEncounterGameSetup {
  const playerDeck = guaranteeAdventureOpeningCreatures(decks[0], setup)
  return {
    decks: [playerDeck, decks[1].map((card) => ({ ...card }))],
    options: { openingHandSizes: [setup.playerOpeningHandSize, DEFAULT_OPENING_HAND_SIZE] },
  }
}
