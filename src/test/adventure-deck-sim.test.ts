import { describe, expect, it } from 'vitest'
import { buildAdventureOpponentPools, generateBranchingAdventureMap } from '../app/adventure-map'
import type { Card } from '../game/types'
import { BASIC } from './helpers/ai-baselines'
import { drain } from './helpers/ai-tournament'
import {
  ADVENTURE_SIM_DECK_IDS,
  adventureSimCellSteps,
  adventureSimDecks,
  bestOfThree,
  emptyAdventureSimTally,
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
  adventureMapNodeDeckId,
  adventureRunClearChance,
  adventureRunModelSteps,
  adventureRunModelWinRates,
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
      const game = playAdventureSimGame('boss-Island', 'adventure', policies, seed)
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
  const map = generateBranchingAdventureMap(ADVENTURE_RUN_MODEL_SEED_START)
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

  it('takes the player win rate from Adventure-seating losses and places nine decks and a boss per map', () => {
    const empty = drain(adventureSimCellSteps({ deckId: 'random', adventure: BASIC, standard: BASIC, seating: 'adventure', series: [] }))
    const cell = (deckId: string, matchup: string, seating: AdventureSimSeating, wins: number, losses: number): AdventureSimCell =>
      ({ ...empty, deckId, matchup, seating, games: { wins, losses, draws: 5 } })
    const { rates, skipped } = adventureRunModelWinRates([
      ...ADVENTURE_SIM_DECK_IDS.map((deckId) => cell(deckId, 'complete', 'adventure', 1, 3)),
      ...ADVENTURE_SIM_DECK_IDS.map((deckId) => cell(deckId, 'complete', 'swapped', 4, 0)),
      ...ADVENTURE_SIM_DECK_IDS.slice(1).map((deckId) => cell(deckId, 'partial', 'adventure', 1, 3)),
    ])
    expect(skipped).toEqual(['partial'])
    expect([...rates.keys()]).toEqual(['complete'])
    expect(new Set(rates.get('complete')?.values())).toEqual(new Set([0.75]))

    const model = drain(adventureRunModelSteps(rates, 20))
    const placements = [...model.placements.values()]
    const total = (key: 'maps' | 'single' | 'fork') => placements.reduce((sum, placement) => sum + placement[key], 0)
    expect([total('maps'), total('single'), total('fork')]).toEqual([180, 60, 120])
    expect([...model.bosses.values()].reduce((sum, count) => sum + count, 0)).toBe(20)
    expect([...model.forkTiers.values()].reduce((sum, count) => sum + count, 0)).toBe(20)
    // Equal win rates make every map and route alike.
    const [row] = model.rows
    expect([row.blind, row.informedP10, row.informedP90].map((value) => value - row.informed).every((gap) => Math.abs(gap) < 1e-12)).toBe(true)
  })
})
