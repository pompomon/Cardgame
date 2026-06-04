import { beforeEach, describe, expect, it } from 'vitest'
import { BASIC_LANDS } from '../game/types'
import {
  buildAdventureLineup,
  computeAdventureScore,
  createAdventureRun,
} from '../app/adventure'

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  clear(): void
}

function installMemoryStorage(): void {
  const map = new Map<string, string>()
  const storage: StorageLike = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
    clear: () => {
      map.clear()
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
}

beforeEach(() => {
  installMemoryStorage()
})

function countsByLand(deck: Array<{ name: string }>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const land of BASIC_LANDS) {
    counts[land] = 0
  }
  for (const card of deck) {
    counts[card.name] = (counts[card.name] ?? 0) + 1
  }
  return counts
}

describe('adventure deck generation', () => {
  it('builds 7-opponent lineup with mono boss on round 7', () => {
    const lineup = buildAdventureLineup(12345)
    expect(lineup).toHaveLength(7)
    expect(lineup[6].kind).toBe('mono')
    expect(lineup.slice(0, 6).every((entry) => entry.kind !== 'mono')).toBe(true)
    expect(lineup.every((entry) => entry.deck.length === 50)).toBe(true)
  })

  it('produces expected card composition by deck kind', () => {
    const lineup = buildAdventureLineup(9876)
    for (const entry of lineup) {
      const counts = countsByLand(entry.deck)
      if (entry.kind === 'standard') {
        expect(Object.values(counts)).toEqual([10, 10, 10, 10, 10])
      } else if (entry.kind === 'dual') {
        const nonZero = Object.entries(counts).filter(([, value]) => value > 0)
        expect(nonZero).toHaveLength(2)
        expect(nonZero.every(([, value]) => value === 25)).toBe(true)
      } else if (entry.kind === 'mono') {
        const nonZero = Object.entries(counts).filter(([, value]) => value > 0)
        expect(nonZero).toHaveLength(1)
        expect(nonZero[0][1]).toBe(50)
      } else {
        expect(entry.deck).toHaveLength(50)
      }
    }
  })

  it('computes score with expected formula', () => {
    const run = createAdventureRun(22)
    run.remainingChances = 4
    run.totalCardsPlayed = 17
    run.totalRoundsPlayed = 6
    expect(computeAdventureScore(run)).toBe(4 * 100 - 17 + 6 * 5)
  })

})
