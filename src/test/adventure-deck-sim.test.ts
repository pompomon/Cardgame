import { describe, expect, it } from 'vitest'
import { buildAdventureOpponentPools } from '../app/adventure-map'
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
  type AdventureSimOutcome,
} from './helpers/adventure-deck-sim'

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
