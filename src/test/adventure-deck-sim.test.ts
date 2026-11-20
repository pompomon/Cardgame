import { describe, expect, it } from 'vitest'
import { ADVENTURE_DECK_BANDS } from '../app/adventure-difficulty'
import {
  ADVENTURE_SEED_PURPOSE,
  buildAdventureOpponentPools,
  deriveAdventureSeed,
  generateBranchingAdventureMap,
} from '../app/adventure-map'
import { AI_LEVELS } from '../game/ai-levels'
import { shuffle } from '../game/cards'
import type { Card } from '../game/types'
import { BASIC } from './helpers/ai-baselines'
import { drain } from './helpers/ai-tournament'
import {
  ADVENTURE_SIM_DECK_IDS,
  adventureSimCellSteps,
  adventureSimDecks,
  bestOfThree,
  compareAdventureSimDeckIds,
  emptyAdventureSimTally,
  isAdventureSimDeckId,
  mergeAdventureSimCells,
  parseAdventureSimCells,
  playAdventureSimGame,
  serializeAdventureSimCells,
  type AdventureSimCell,
  type AdventureSimOutcome,
  type AdventureSimSeating,
} from './helpers/adventure-deck-sim'
import {
  ADVENTURE_RUN_MODEL_SEED_START,
  ADVENTURE_RUN_MODEL_SEED_STEP,
  adventureMapNodeDeckId,
  adventureRunMapBands,
  adventureRunClearChance,
  adventureRunModelPlans,
  adventureRunModelSteps,
  adventureRunModelWinRates,
  adventureRunOutcomes,
} from './helpers/adventure-run-model'

function landCounts(deck: readonly Card[] | undefined): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const card of deck ?? []) {
    counts[card.name] = (counts[card.name] ?? 0) + 1
  }
  return counts
}

const TEN_OF_EACH = { Forest: 10, Island: 10, Mountain: 10, Plains: 10, Swamp: 10 }

describe('Adventure deck simulation', () => {
  it('seats each Adventure deck against a freshly shuffled standard deck', () => {
    const pools = buildAdventureOpponentPools(11)
    const poolDecks = new Map([...pools.nonBoss, ...pools.boss].map((deck) => [deck.id, deck]))
    expect([...poolDecks.keys()]).toEqual(ADVENTURE_SIM_DECK_IDS)
    for (const deckId of ADVENTURE_SIM_DECK_IDS) {
      const [standard, adventure] = adventureSimDecks(deckId, 'adventure', 5)
      const [swappedAdventure, swappedStandard] = adventureSimDecks(deckId, 'swapped', 5)
      expect(landCounts(standard)).toEqual(TEN_OF_EACH)
      expect(standard?.every((card) => card.id.startsWith('p0-'))).toBe(true)
      expect(landCounts(swappedStandard)).toEqual(TEN_OF_EACH)
      expect(swappedStandard?.every((card) => card.id.startsWith('p1-'))).toBe(true)
      expect(swappedAdventure).toEqual(adventure)
      expect(adventure).toHaveLength(50)
      expect(adventure?.every((card) => card.id.startsWith('opp-'))).toBe(true)
      if (deckId !== 'random') {
        expect(landCounts(adventure)).toEqual(landCounts(poolDecks.get(deckId)?.deck))
      }
      expect(adventureSimDecks(deckId, 'adventure', 6)[1]).not.toEqual(adventure)
    }
  })

  it('builds candidate decks from mix ids and rejects malformed ones', () => {
    expect(isAdventureSimDeckId('mix-Island20-Mountain30')).toBe(true)
    expect(isAdventureSimDeckId('mix-Swamp50')).toBe(true)
    for (const deckId of ['mix-Island20-Mountain29', 'mix-Mountain30-Island20', 'mix-Island20-Island30', 'mix-Island0-Mountain50', 'mix-Isle50', 'mix-Island050', 'mix-']) {
      expect(isAdventureSimDeckId(deckId)).toBe(false)
    }
    const [standard, adventure] = adventureSimDecks('mix-Forest35-Island15', 'adventure', 5)
    expect(landCounts(standard)).toEqual(TEN_OF_EACH)
    expect(landCounts(adventure)).toEqual({ Forest: 35, Island: 15 })
    expect(new Set(adventure?.map((card) => card.id)).size).toBe(50)
    expect(adventureSimDecks('mix-Forest35-Island15', 'adventure', 6)[1]).not.toEqual(adventure)
    expect([...ADVENTURE_SIM_DECK_IDS, 'mix-Swamp50', 'mix-Island50'].sort(compareAdventureSimDeckIds).slice(-3))
      .toEqual([ADVENTURE_SIM_DECK_IDS[ADVENTURE_SIM_DECK_IDS.length - 1], 'mix-Island50', 'mix-Swamp50'])
  })

  it.each<[AdventureSimOutcome[], AdventureSimOutcome, number]>([
    [['win', 'win'], 'win', 2],
    [['loss', 'win', 'loss'], 'loss', 3],
    [['win', 'draw', 'draw'], 'win', 3],
    [['win', 'draw', 'loss'], 'draw', 3],
    [['draw', 'loss', 'loss'], 'loss', 3],
  ])('plays best of three: %j is a series %s in %i games', (outcomes, expected, length) => {
    const played: number[] = []
    const series = bestOfThree((game) => {
      played.push(game)
      return {
        seed: game,
        outcome: outcomes[game],
        unfinished: false,
        turns: 10,
        winKind: null,
        adventure: emptyAdventureSimTally(),
        standard: emptyAdventureSimTally(),
      }
    })
    expect(series.outcome).toBe(expected)
    expect(played).toEqual([0, 1, 2].slice(0, length))
  })

  it('counts Island draws but not turn draws as extra draws', () => {
    const policies = { adventure: BASIC.policy, standard: BASIC.policy }
    for (const seed of [1, 2, 3]) {
      const game = playAdventureSimGame('mix-Island50', 'adventure', policies, seed)
      expect(game.adventure.lands).toBeGreaterThan(0)
      expect(game.adventure.extraDraws).toBe(game.adventure.lands)
    }
  })

  it('merges shards into the cell of one run and rejects corrupt result files', () => {
    const cell = (series: number[]) => drain(adventureSimCellSteps({
      deckId: 'dual-Island-Swamp',
      adventure: BASIC,
      standard: BASIC,
      seating: 'adventure',
      series,
    }))
    const shards = [cell([1, 2]), cell([3, 4])].flatMap((shard) => parseAdventureSimCells(serializeAdventureSimCells([shard])))
    expect(mergeAdventureSimCells(shards)).toEqual([cell([1, 2, 3, 4])])

    const corrupt = JSON.parse(serializeAdventureSimCells([cell([1])]))
    corrupt.cells[0].games.wins = 0.5
    expect(() => parseAdventureSimCells(JSON.stringify(corrupt))).toThrow('Not an Adventure deck simulation result file.')
  })
})

describe('Adventure run model', () => {
  const map = generateBranchingAdventureMap(ADVENTURE_RUN_MODEL_SEED_START, ADVENTURE_DECK_BANDS.basic)
  const tierDecks = map.tiers.map((tier, tierIndex) => tier.nodes.map((node) => adventureMapNodeDeckId(node, tierIndex)))
  const bossId = tierDecks[tierDecks.length - 1][0]
  const winRates = (overrides: [string, number][]) => (deckId: string): number =>
    new Map(overrides).get(deckId) ?? 1

  it('applies the chance rules and retries a lost node', () => {
    // Six straight wins add two chances, so the boss gets five tries.
    const bossOnly = winRates([[bossId, 0.5]])
    expect(adventureRunClearChance(map, bossOnly, 'informed')).toBeCloseTo(1 - 0.5 ** 5, 12)
    // A loss on the second tier resets a streak of one, so winning there at
    // once, after one loss or after two leaves five, three or two tries for
    // the boss; three losses end the run.
    const secondTierToo = winRates([[bossId, 0.5], ...tierDecks[1].map((deckId): [string, number] => [deckId, 0.5])])
    expect(adventureRunClearChance(map, secondTierToo, 'blind')).toBeCloseTo(0.5 * (31 / 32) + 0.25 * (7 / 8) + 0.125 * (3 / 4), 12)
    const fork = tierDecks.find((decks) => decks.length === 2) ?? []
    const oneUnbeatable = winRates([[fork[1], 0]])
    expect(adventureRunClearChance(map, oneUnbeatable, 'informed')).toBe(1)
    expect(adventureRunClearChance(map, oneUnbeatable, 'blind')).toBeCloseTo(0.5, 12)
  })

  it('follows runs to the tier where they end', () => {
    const bossOutcomes = adventureRunOutcomes(map, winRates([[bossId, 0.5]]), 'informed')
    expect(bossOutcomes.slice(0, -2)).toEqual(Array(map.tiers.length - 1).fill(0))
    expect(bossOutcomes.at(-2)).toBeCloseTo(0.5 ** 5, 12)
    expect(bossOutcomes.at(-1)).toBeCloseTo(1 - 0.5 ** 5, 12)
    const forkTier = tierDecks.findIndex((decks) => decks.length === 2)
    const forkOutcomes = adventureRunOutcomes(map, winRates([[tierDecks[forkTier][1], 0]]), 'blind')
    expect(forkOutcomes[forkTier]).toBeCloseTo(0.5, 12)
    expect(forkOutcomes.at(-1)).toBeCloseTo(0.5, 12)
    // The forward pass takes the routes the clear chance assumes.
    const uneven = (deckId: string, tierIndex: number): number => 0.35 + ((deckId.length * 7 + tierIndex * 3) % 11) / 20
    for (const routing of ['informed', 'blind'] as const) {
      const outcomes = adventureRunOutcomes(map, uneven, routing)
      expect(outcomes.reduce((sum, chance) => sum + chance, 0)).toBeCloseTo(1, 12)
      expect(outcomes.at(-1)).toBeCloseTo(adventureRunClearChance(map, uneven, routing), 12)
    }
  })

  it('takes the player win rate from Adventure-seating losses and models each level on its own maps', () => {
    const empty = drain(adventureSimCellSteps({ deckId: 'random', adventure: BASIC, standard: BASIC, seating: 'adventure', series: [] }))
    const cell = (deckId: string, matchup: string, seating: AdventureSimSeating, wins: number, losses: number): AdventureSimCell =>
      ({ ...empty, deckId, matchup, seating, games: { wins, losses, draws: 5 } })
    const { rates, skipped } = adventureRunModelWinRates([
      ...ADVENTURE_SIM_DECK_IDS.map((deckId) => cell(deckId, 'advanced vs basic', 'adventure', 1, 3)),
      ...ADVENTURE_SIM_DECK_IDS.map((deckId) => cell(deckId, 'advanced vs basic', 'swapped', 4, 0)),
      ...ADVENTURE_SIM_DECK_IDS.map((deckId) => cell(deckId, 'basic vs basic', 'adventure', 1, 7)),
      ...ADVENTURE_SIM_DECK_IDS.map((deckId) => cell(deckId, 'legacy-hard vs basic', 'adventure', 1, 1)),
      ...ADVENTURE_SIM_DECK_IDS.slice(1).map((deckId) => cell(deckId, 'partial', 'adventure', 1, 3)),
    ])
    expect(skipped).toEqual(['partial'])
    expect(new Set(rates.get('advanced vs basic')?.values())).toEqual(new Set([0.75]))

    const { plans, skipped: notLevels } = adventureRunModelPlans(rates, [2])
    expect(notLevels).toEqual(['legacy-hard vs basic'])
    expect(plans.map((plan) => [plan.name, plan.level])).toEqual([
      ['advanced vs basic', 'advanced'],
      ['advanced vs basic, tiers 1–2 at basic', 'advanced'],
      ['basic vs basic', 'basic'],
    ])
    expect([plans[1].winRate('dual-Forest-Island', 1), plans[1].winRate('dual-Forest-Island', 2)]).toEqual([0.875, 0.75])

    const model = drain(adventureRunModelSteps(plans, 20))
    expect([...model.placements.keys()]).toEqual(['basic', 'advanced', 'hard'])
    for (const placements of model.placements.values()) {
      const total = (key: 'maps' | 'single' | 'fork') => [...placements.values()].reduce((sum, placement) => sum + placement[key], 0)
      expect([total('maps'), total('single'), total('fork')]).toEqual([180, 60, 120])
    }
    // Mountain–Plains is Extreme for Advanced opponents, so it only appears at forks.
    const advancedMP = model.placements.get('advanced')?.get('dual-Mountain-Plains')
    expect(advancedMP?.maps).toBeGreaterThan(0)
    expect(advancedMP?.fork).toBe(advancedMP?.maps)
    expect(model.placements.get('hard')?.get('dual-Mountain-Plains')?.single).toBeGreaterThan(0)
    expect([...model.bosses.values()].reduce((sum, count) => sum + count, 0)).toBe(20)
    expect([...model.forkTiers.values()].reduce((sum, count) => sum + count, 0)).toBe(20)
    // Equal win rates make every map and route alike.
    const [row, ramped] = model.rows
    expect([row.blind, row.informedP10, row.informedP90].map((value) => value - row.informed).every((gap) => Math.abs(gap) < 1e-12)).toBe(true)
    expect(row.informedOutcomes.reduce((sum, chance) => sum + chance, 0)).toBeCloseTo(1, 12)
    expect(row.informedOutcomes.at(-1)).toBeCloseTo(row.informed, 12)
    expect(ramped.informed).toBeGreaterThan(row.informed)
  })

  it('deals shuffled-order maps as maps were dealt before level ordering', () => {
    for (let index = 0; index < 50; index += 1) {
      const seed = ADVENTURE_RUN_MODEL_SEED_START + index * ADVENTURE_RUN_MODEL_SEED_STEP
      // Before level ordering, a map took the first nine shuffled decks, tier by tier.
      const pools = buildAdventureOpponentPools(deriveAdventureSeed(ADVENTURE_SEED_PURPOSE.deckOrder, seed))
      const dealt = shuffle(pools.nonBoss, deriveAdventureSeed(ADVENTURE_SEED_PURPOSE.nonBossPick, seed)).map((opponent) => opponent.id)
      for (const level of AI_LEVELS) {
        const shuffledMap = generateBranchingAdventureMap(seed, adventureRunMapBands('shuffled', level))
        const tiers = shuffledMap.tiers.slice(0, -1)
          .map((tier, tierIndex) => tier.nodes.map((node) => adventureMapNodeDeckId(node, tierIndex)).sort())
        const expected: string[][] = []
        for (const tier of tiers) {
          const next = expected.flat().length
          expected.push(dealt.slice(next, next + tier.length).sort())
        }
        expect(tiers, `${level} seed ${seed}`).toEqual(expected)
      }
    }
  })
})
