import { describe, expect, it } from 'vitest'

import { TEST_DECK_KINDS, deckOfKind, type TestDeckKind } from './helpers/seeded-games'

/** The land names of a deck, which tell the mono and dual variants apart. */
function landsOf(kind: TestDeckKind, seed: number, variant?: number): string {
  const deck = deckOfKind(kind, seed, variant) ?? []
  return [...new Set(deck.map((card) => card.name))].sort().join('/')
}

describe('seeded test decks', () => {
  it('meets every mono and dual deck when kinds cycle with consecutive seeds', () => {
    // The `npm run ai:tune` scheme: seed = start + game, kind = game % 5, and
    // every fifth cycle of kinds held out.
    const met = {
      training: { dual: new Set<string>(), mono: new Set<string>() },
      holdout: { dual: new Set<string>(), mono: new Set<string>() },
    }
    for (let game = 0; game < 2000; game += 1) {
      const kind = TEST_DECK_KINDS[game % TEST_DECK_KINDS.length]
      if (kind !== 'dual' && kind !== 'mono') continue
      const side = Math.floor(game / TEST_DECK_KINDS.length) % 5 === 4 ? met.holdout : met.training
      side[kind].add(landsOf(kind, 100_000 + game))
    }
    for (const side of [met.training, met.holdout]) {
      expect(side.mono.size).toBe(5)
      expect(side.dual.size).toBe(10)
    }
  })

  it('cycles a fixed kind evenly when the seed is the variant', () => {
    const duals = Array.from({ length: 20 }, (_, index) => landsOf('dual', index + 1, index + 1))
    expect(new Set(duals).size).toBe(10)
    expect(duals.slice(10)).toEqual(duals.slice(0, 10))
    const monos = Array.from({ length: 10 }, (_, index) => landsOf('mono', index + 1, index + 1))
    expect(new Set(monos).size).toBe(5)
    expect(monos.slice(5)).toEqual(monos.slice(0, 5))
  })
})
