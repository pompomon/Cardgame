import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStarterDeck } from '../game/cards'
import { createInitialGame, DEFAULT_OPENING_HAND_SIZE } from '../game/engine'
import { BASIC_LANDS, type BasicLand, type Card, type PlayerState } from '../game/types'
import {
  ADVENTURE_MAX_RELIC_CHARGES,
  ADVENTURE_REWARD_CATALOG,
  ADVENTURE_REWARD_IDS,
  consumeAdventureRelicCharge,
  isAdventureChargedRelicId,
  isAdventureRelicId,
  isAdventureRelicInventory,
  type AdventureRelic,
  type AdventureRelicId,
} from '../app/adventure-rewards'
import {
  ADVENTURE_MAX_OPENING_HAND_SIZE,
  adventureEncounterGameSetup,
  cloneAdventureEncounterSetup,
  guaranteeAdventureOpeningCreatures,
  isAdventureEncounterSetup,
  planAdventureEncounterSetup,
  type AdventureEncounterSetup,
} from '../app/adventure-setup'
import { createGameRecord, parseGameRecordJson, serializeGameRecord } from '../app/game-recording'
import { deepFreeze } from './helpers/deep-freeze'

const CLOCK_SEED = 1_760_000_000_000
const EDGE_SEEDS = [
  0,
  1,
  2 ** 31 - 1,
  2 ** 31,
  2 ** 31 + 1,
  2 ** 32 - 1,
  2 ** 32,
  2 ** 32 + 1,
  Number.MAX_SAFE_INTEGER,
  CLOCK_SEED,
]
const SEEDS = [...EDGE_SEEDS, ...Array.from({ length: 22 }, (_, index) => 1_000 + index)]
const HAND_SIZES = [5, 6, 7, 8]
/** Every set of creatures, each in `BASIC_LANDS` order. */
const CREATURE_SUBSETS: BasicLand[][] = Array.from({ length: 2 ** BASIC_LANDS.length }, (_, mask) =>
  BASIC_LANDS.filter((_, index) => (mask & (1 << index)) !== 0))
const CREATURE_SAMPLES: BasicLand[][] = [[], ['Island'], ['Forest', 'Swamp'], [...BASIC_LANDS]]
const CHARM_CREATURES: Partial<Record<AdventureRelicId, BasicLand>> = {
  'gravebloom-charm': 'Forest',
  'signal-charm': 'Island',
  'rooftop-charm': 'Mountain',
  'echo-charm': 'Plains',
  'memory-charm': 'Swamp',
}

function setup(playerOpeningHandSize: number, guaranteedCreatures: BasicLand[] = []): AdventureEncounterSetup {
  return { playerOpeningHandSize, guaranteedCreatures }
}

/** A deck holding these cards in order. Each card ID records its starting position. */
function deckOf(...lands: BasicLand[]): Card[] {
  return lands.map((name, index) => ({ id: `c${index}`, name, type: 'land' }))
}

function repeat(land: BasicLand, count: number): BasicLand[] {
  return Array.from({ length: count }, () => land)
}

function ids(cards: readonly Card[]): string[] {
  return cards.map((card) => card.id)
}

function byId(cards: readonly Card[]): Card[] {
  return [...cards].sort((left, right) => left.id.localeCompare(right.id))
}

function allZones(player: PlayerState): Card[] {
  return [...player.hand, ...player.deck, ...player.battlefield.map((entry) => entry.card), ...player.graveyard]
}

/** Every valid relic inventory: each relic absent or owned, with every charge count. */
function allRelicInventories(): AdventureRelic[][] {
  let inventories: AdventureRelic[][] = [[]]
  for (const id of ADVENTURE_REWARD_IDS) {
    if (!isAdventureRelicId(id)) continue
    const options: AdventureRelic[] = isAdventureChargedRelicId(id)
      ? Array.from({ length: ADVENTURE_MAX_RELIC_CHARGES }, (_, index) => ({ id, charges: index + 1 }))
      : [{ id }]
    inventories = inventories.flatMap((relics) => [relics, ...options.map((relic) => [...relics, relic])])
  }
  return inventories
}

describe('adventure encounter setup constants', () => {
  it('caps the opening hand where every opening bonus in the catalog together reaches', () => {
    const bonusCards = ADVENTURE_REWARD_CATALOG.reduce(
      (total, entry) => total + (entry.effect.kind === 'opening-hand-bonus' ? entry.effect.cards : 0),
      0,
    )

    expect(DEFAULT_OPENING_HAND_SIZE).toBe(5)
    expect(ADVENTURE_MAX_OPENING_HAND_SIZE).toBe(8)
    expect(DEFAULT_OPENING_HAND_SIZE + bonusCards).toBe(ADVENTURE_MAX_OPENING_HAND_SIZE)
  })
})

describe('isAdventureEncounterSetup', () => {
  it('accepts an opening hand from 5 to 8 with any creatures in BASIC_LANDS order', () => {
    for (const handSize of HAND_SIZES) {
      for (const creatures of CREATURE_SUBSETS) {
        expect(isAdventureEncounterSetup(setup(handSize, creatures))).toBe(true)
      }
    }
    expect(isAdventureEncounterSetup({ ...setup(6, ['Island']), note: 'ignored' })).toBe(true)
  })

  it('rejects other opening hand sizes', () => {
    for (const handSize of [4, 9, 0, -5, 5.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER, '6', null, undefined]) {
      expect(isAdventureEncounterSetup({ playerOpeningHandSize: handSize, guaranteedCreatures: [] })).toBe(false)
    }
  })

  it('rejects unordered, repeated or unknown creatures', () => {
    const sparse: unknown[] = []
    sparse[1] = 'Island'
    for (const creatures of [
      ['Island', 'Forest'],
      ['Swamp', 'Plains'],
      ['Forest', 'Forest'],
      [...BASIC_LANDS, 'Forest'],
      ['forest'],
      ['Forest '],
      ['Wastes'],
      [''],
      [null],
      [0],
      [['Forest']],
      sparse,
      'Forest',
      {},
      null,
      undefined,
    ]) {
      expect(isAdventureEncounterSetup({ playerOpeningHandSize: 5, guaranteedCreatures: creatures })).toBe(false)
    }
  })

  it('rejects values that are not setup objects', () => {
    for (const value of [null, undefined, 5, 'setup', [], [5, []], { playerOpeningHandSize: 5 }, { guaranteedCreatures: [] }]) {
      expect(isAdventureEncounterSetup(value)).toBe(false)
    }
  })

  it('clones the known fields into a detached copy', () => {
    const original = deepFreeze({ ...setup(7, ['Island', 'Swamp']), note: 'dropped' })
    const copy = cloneAdventureEncounterSetup(original)

    expect(copy).toStrictEqual(setup(7, ['Island', 'Swamp']))
    expect(copy.guaranteedCreatures).not.toBe(original.guaranteedCreatures)
  })
})

describe('planAdventureEncounterSetup', () => {
  it('starts every encounter with the default hand and no guarantees', () => {
    expect(planAdventureEncounterSetup([])).toStrictEqual({ setup: setup(5), relics: [] })
  })

  it.each<{ name: string; relics: AdventureRelic[]; handSize: number; after: AdventureRelic[] }>([
    { name: 'Prepared Pack', relics: [{ id: 'prepared-pack' }], handSize: 6, after: [{ id: 'prepared-pack' }] },
    { name: "Scout's Cache with its last charge", relics: [{ id: 'scout-cache', charges: 1 }], handSize: 7, after: [] },
    {
      name: "Scout's Cache with two charges",
      relics: [{ id: 'scout-cache', charges: 2 }],
      handSize: 7,
      after: [{ id: 'scout-cache', charges: 1 }],
    },
    {
      name: "Prepared Pack and Scout's Cache",
      relics: [{ id: 'prepared-pack' }, { id: 'scout-cache', charges: 1 }],
      handSize: 8,
      after: [{ id: 'prepared-pack' }],
    },
    {
      name: 'Guardian Sigil and Streak Anchor',
      relics: [{ id: 'guardian-sigil', charges: 2 }, { id: 'streak-anchor', charges: 1 }],
      handSize: 5,
      after: [{ id: 'guardian-sigil', charges: 2 }, { id: 'streak-anchor', charges: 1 }],
    },
  ])('sizes the opening hand with $name', ({ relics, handSize, after }) => {
    const plan = planAdventureEncounterSetup(deepFreeze(relics))

    expect(plan).toStrictEqual({ setup: setup(handSize), relics: after })
  })

  it('guarantees the creature of each charm', () => {
    for (const [id, creature] of Object.entries(CHARM_CREATURES)) {
      expect(planAdventureEncounterSetup([{ id } as AdventureRelic]).setup).toStrictEqual(setup(5, [creature]))
    }
  })

  it('applies every setup relic together and leaves protection relics unchanged', () => {
    const relics = deepFreeze<AdventureRelic[]>([
      { id: 'guardian-sigil', charges: 2 },
      { id: 'streak-anchor', charges: 2 },
      { id: 'prepared-pack' },
      { id: 'scout-cache', charges: 2 },
      { id: 'gravebloom-charm' },
      { id: 'signal-charm' },
      { id: 'rooftop-charm' },
      { id: 'echo-charm' },
      { id: 'memory-charm' },
    ])

    expect(planAdventureEncounterSetup(relics)).toStrictEqual({
      setup: setup(8, [...BASIC_LANDS]),
      relics: relics.map((relic) => (relic.id === 'scout-cache' ? { id: 'scout-cache', charges: 1 } : relic)),
    })
  })

  it("uses another Scout's Cache charge each time it plans", () => {
    const first = planAdventureEncounterSetup([{ id: 'scout-cache', charges: 2 }])
    const second = planAdventureEncounterSetup(first.relics)
    const third = planAdventureEncounterSetup(second.relics)

    expect([first, second, third].map((plan) => plan.setup.playerOpeningHandSize)).toEqual([7, 7, 5])
    expect([first.relics, second.relics, third.relics]).toEqual([[{ id: 'scout-cache', charges: 1 }], [], []])
  })

  it('returns detached copies of the relics without unknown keys', () => {
    const pack = { id: 'prepared-pack' as const, note: 'dropped' }
    const guardian = { id: 'guardian-sigil' as const, charges: 1 }
    const relics = deepFreeze<AdventureRelic[]>([guardian, pack])
    const plan = planAdventureEncounterSetup(relics)

    expect(plan.relics).toStrictEqual([{ id: 'guardian-sigil', charges: 1 }, { id: 'prepared-pack' }])
    expect(plan.relics).not.toBe(relics)
    expect(plan.relics[0]).not.toBe(guardian)
    expect(plan.setup.guaranteedCreatures).not.toBe(planAdventureEncounterSetup(relics).setup.guaranteedCreatures)
  })

  it('rejects an invalid relic inventory', () => {
    for (const relics of [
      null,
      undefined,
      {},
      'prepared-pack',
      [null],
      [{ id: 'second-wind' }],
      [{ id: 'Prepared-Pack' }],
      [{ id: 'prepared-pack', charges: 1 }],
      [{ id: 'scout-cache' }],
      [{ id: 'scout-cache', charges: 0 }],
      [{ id: 'scout-cache', charges: 3 }],
      [{ id: 'scout-cache', charges: 1.5 }],
      [{ id: 'echo-charm' }, { id: 'echo-charm' }],
      [{ id: 'memory-charm' }, { id: 'echo-charm' }],
    ]) {
      expect(() => planAdventureEncounterSetup(relics as AdventureRelic[])).toThrow(RangeError)
    }
  })

  it('keeps every valid inventory within the opening hand cap', () => {
    const inventories = allRelicInventories()

    expect(inventories).toHaveLength(2 ** 6 * 3 ** 3)
    for (const relics of inventories) {
      const owns = (id: AdventureRelicId) => relics.some((relic) => relic.id === id)
      const plan = planAdventureEncounterSetup(relics)

      expect(isAdventureRelicInventory(relics)).toBe(true)
      expect(isAdventureEncounterSetup(plan.setup)).toBe(true)
      expect(plan.setup.playerOpeningHandSize).toBeLessThanOrEqual(ADVENTURE_MAX_OPENING_HAND_SIZE)
      expect(plan.setup.playerOpeningHandSize).toBe(5 + (owns('prepared-pack') ? 1 : 0) + (owns('scout-cache') ? 2 : 0))
      expect(plan.setup.guaranteedCreatures).toEqual(relics.flatMap((relic) => CHARM_CREATURES[relic.id] ?? []))
      expect(plan.relics).toEqual(consumeAdventureRelicCharge(relics, 'scout-cache') ?? relics)
      expect(isAdventureRelicInventory(plan.relics)).toBe(true)
    }
  })
})

describe('guaranteeAdventureOpeningCreatures', () => {
  it('keeps the deck order when every guaranteed creature is already in the opening window', () => {
    for (const seed of EDGE_SEEDS) {
      const deck = deepFreeze(createStarterDeck(0, seed))
      for (const handSize of HAND_SIZES) {
        const present = BASIC_LANDS.filter((land) => deck.slice(0, handSize).some((card) => card.name === land))
        const result = guaranteeAdventureOpeningCreatures(deck, setup(handSize, present))

        expect(result).toEqual(deck)
        expect(result).not.toBe(deck)
        result.forEach((card, index) => expect(card).not.toBe(deck[index]))
      }
    }
  })

  it('guarantees every set of creatures by swapping in only the missing ones', () => {
    for (const seed of SEEDS) {
      const deck = deepFreeze(createStarterDeck(0, seed))
      const sortedDeck = byId(deck)
      for (const handSize of HAND_SIZES) {
        const openingWindow = deck.slice(0, handSize)
        for (const creatures of CREATURE_SUBSETS) {
          const encounter = setup(handSize, creatures)
          const result = guaranteeAdventureOpeningCreatures(deck, encounter)
          const missing = creatures.filter((creature) => !openingWindow.some((card) => card.name === creature))
          const moved = result.flatMap((card, index) => (card.id === deck[index].id ? [] : [index]))

          expect(byId(result)).toEqual(sortedDeck)
          for (const creature of creatures) {
            expect(result.slice(0, handSize).some((card) => card.name === creature)).toBe(true)
          }
          expect(moved).toHaveLength(2 * missing.length)
          expect(moved.filter((index) => index < handSize).map((index) => result[index].name).sort())
            .toEqual([...missing].sort())
          expect(guaranteeAdventureOpeningCreatures(result, encounter)).toEqual(result)
        }
      }
    }
  })

  it('fills missing creatures in BASIC_LANDS order from the end of the window', () => {
    const deck = deepFreeze(deckOf('Forest', 'Plains', 'Plains', 'Mountain', 'Plains', 'Mountain', 'Swamp', 'Island', 'Island', 'Swamp'))
    const result = guaranteeAdventureOpeningCreatures(deck, setup(5, ['Forest', 'Island', 'Swamp']))

    expect(ids(result)).toEqual(['c0', 'c1', 'c2', 'c6', 'c7', 'c5', 'c3', 'c4', 'c8', 'c9'])
    expect(guaranteeAdventureOpeningCreatures(deck, setup(5, ['Forest', 'Island', 'Swamp']))).toEqual(result)
  })

  it('never displaces a claimed creature, even from the last window slot', () => {
    const deck = deckOf('Plains', 'Plains', 'Plains', 'Plains', 'Forest', 'Island')

    expect(ids(guaranteeAdventureOpeningCreatures(deck, setup(5, ['Forest', 'Island']))))
      .toEqual(['c0', 'c1', 'c2', 'c5', 'c4', 'c3'])
  })

  it('displaces extra copies of a guaranteed creature', () => {
    const deck = deckOf(...repeat('Forest', 5), 'Swamp', 'Plains', 'Mountain', 'Island')
    const result = guaranteeAdventureOpeningCreatures(deck, setup(5, [...BASIC_LANDS]))

    expect(ids(result)).toEqual(['c0', 'c5', 'c6', 'c7', 'c8', 'c1', 'c2', 'c3', 'c4'])
    expect(result.slice(0, 5).map((card) => card.name)).toEqual(['Forest', 'Swamp', 'Plains', 'Mountain', 'Island'])
  })

  it('uses the opening hand size as the window', () => {
    const deck = deckOf(...repeat('Forest', 6), 'Island', 'Forest', 'Mountain', 'Island')

    expect(guaranteeAdventureOpeningCreatures(deck, setup(8, ['Island']))).toEqual(deck)
    expect(ids(guaranteeAdventureOpeningCreatures(deck, setup(5, ['Island']))))
      .toEqual(['c0', 'c1', 'c2', 'c3', 'c6', 'c5', 'c4', 'c7', 'c8', 'c9'])
    expect(ids(guaranteeAdventureOpeningCreatures(deckOf(...repeat('Forest', 8), 'Mountain', 'Island'), setup(8, ['Island']))))
      .toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c9', 'c8', 'c7'])
    expect(ids(guaranteeAdventureOpeningCreatures(deckOf(...repeat('Forest', 5), 'Island'), setup(5, ['Island']))))
      .toEqual(['c0', 'c1', 'c2', 'c3', 'c5', 'c4'])
  })

  it('accepts a deck exactly as long as the opening hand', () => {
    const deck = deckOf('Swamp', 'Plains', 'Mountain', 'Island', 'Forest')

    expect(guaranteeAdventureOpeningCreatures(deck, setup(5, [...BASIC_LANDS]))).toEqual(deck)
  })

  it('rejects a missing creature, a short deck or an invalid setup without changing the deck', () => {
    const forests = deepFreeze(deckOf(...repeat('Forest', 10)))

    expect(() => guaranteeAdventureOpeningCreatures(forests, setup(5, ['Island']))).toThrow(RangeError)
    expect(() => guaranteeAdventureOpeningCreatures(forests.slice(0, 4), setup(5))).toThrow(RangeError)
    expect(() => guaranteeAdventureOpeningCreatures(forests.slice(0, 7), setup(8))).toThrow(RangeError)
    for (const invalid of [
      setup(4),
      setup(9),
      setup(5.5),
      setup(5, ['Island', 'Forest']),
      setup(5, ['Forest', 'Forest']),
      null,
    ]) {
      expect(() => guaranteeAdventureOpeningCreatures(forests, invalid as AdventureEncounterSetup)).toThrow(RangeError)
    }
    expect(forests).toEqual(deckOf(...repeat('Forest', 10)))
  })
})

describe('adventureEncounterGameSetup', () => {
  it('matches the default game when relics change nothing', () => {
    for (const seed of EDGE_SEEDS) {
      const defaultDecks = [createStarterDeck(0, seed), createStarterDeck(1, seed + 1)] as const
      const game = adventureEncounterGameSetup(setup(5), defaultDecks)

      expect(game.options).toEqual({ openingHandSizes: [5, 5] })
      expect(JSON.stringify(createInitialGame(seed, game.decks, game.options))).toBe(JSON.stringify(createInitialGame(seed)))
    }
  })

  it('changes only the player opening hand and keeps 50 unique cards for each player', () => {
    for (const seed of EDGE_SEEDS) {
      const playerDeck = deepFreeze(createStarterDeck(0, seed))
      const opponentDeck = deepFreeze(createStarterDeck(1, seed + 1))
      const baseline = createInitialGame(seed, [[...playerDeck], [...opponentDeck]])
      for (const handSize of HAND_SIZES) {
        for (const creatures of CREATURE_SAMPLES) {
          const { decks, options } = adventureEncounterGameSetup(setup(handSize, creatures), [playerDeck, opponentDeck])
          const state = createInitialGame(seed, decks, options)
          const [player, opponent] = state.players

          expect(options).toEqual({ openingHandSizes: [handSize, DEFAULT_OPENING_HAND_SIZE] })
          expect(player.hand).toHaveLength(handSize)
          expect(player.deck).toHaveLength(playerDeck.length - handSize)
          for (const creature of creatures) {
            expect(player.hand.some((card) => card.name === creature)).toBe(true)
          }
          expect(byId(allZones(player))).toEqual(byId(playerDeck))
          expect(byId(allZones(opponent))).toEqual(byId(opponentDeck))
          expect(new Set(ids(allZones(player))).size).toBe(50)
          expect(new Set(ids(allZones(opponent))).size).toBe(50)
          expect(opponent.hand).toHaveLength(DEFAULT_OPENING_HAND_SIZE)
          expect(opponent).toEqual(baseline.players[1])
          expect([state.turn, state.currentPlayer, state.phase, state.winner, state.nextInstanceId])
            .toEqual([baseline.turn, baseline.currentPlayer, baseline.phase, baseline.winner, baseline.nextInstanceId])
        }
      }
    }
  })

  it('returns decks that share nothing with its input', () => {
    const decks = deepFreeze([createStarterDeck(0, 7), createStarterDeck(1, 7)] as const)
    const game = adventureEncounterGameSetup(setup(8, ['Plains']), decks)

    expect(game.decks[1]).toEqual(decks[1])
    expect(game.decks[1]).not.toBe(decks[1])
    game.decks.forEach((deck, player) => deck.forEach((card) => expect(decks[player]).not.toContain(card)))
  })

  it('rejects the setup before creating a game', () => {
    const decks = [createStarterDeck(0, 3), createStarterDeck(1, 3)] as const

    expect(() => adventureEncounterGameSetup(setup(9), decks)).toThrow(RangeError)
    expect(() => adventureEncounterGameSetup(setup(5, ['Swamp', 'Forest']), decks)).toThrow(RangeError)
  })

  it('keeps an eight-card opening in the recording initial snapshot alone', () => {
    const seed = CLOCK_SEED
    const { decks, options } = adventureEncounterGameSetup(
      setup(8, [...BASIC_LANDS]),
      [createStarterDeck(0, seed), createStarterDeck(1, seed + 1)],
    )
    const initial = createInitialGame(seed, decks, options)
    const text = serializeGameRecord(createGameRecord(seed, 'adventure-hvai', ['human', 'ai'], 'basic', initial, 1000))
    const parsed = parseGameRecordJson(text)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.record.initialState).toEqual(initial)
    expect(parsed.record.initialState.players.map((player) => player.hand.length)).toEqual([8, 5])
    for (const id of ADVENTURE_REWARD_IDS) {
      expect(text).not.toContain(id)
    }
    expect(text).not.toMatch(/relic|reward/i)
  })
})

describe('adventure setup module boundary', () => {
  const source = readFileSync(resolve(__dirname, '..', 'app', 'adventure-setup.ts'), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it('imports only the engine setup option, game types, the reward rules and the shared validators', () => {
    const specifiers = [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map((match) => match[1])

    expect(new Set(specifiers)).toEqual(new Set(['../game/engine', '../game/types', './adventure-rewards', './validators']))
  })

  it('reads no randomness, clock, storage, DOM or string hashes', () => {
    for (const forbidden of [
      /\bMath\.random\b/,
      /\bDate\b/,
      /\bperformance\b/,
      /\bcrypto\b/,
      /\blocalStorage\b/,
      /\bdocument\b/,
      /\bwindow\b/,
      /\.charCodeAt\b/,
      /\.codePointAt\b/,
    ]) {
      expect(code).not.toMatch(forbidden)
    }
  })
})
