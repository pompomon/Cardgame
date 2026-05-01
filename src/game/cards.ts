import type { Card } from './types'

const CREATURE_POOL: Array<Omit<Card, 'id'>> = [
  { name: 'River Scout', type: 'creature', cost: 1, power: 1, toughness: 1 },
  { name: 'Forest Wolf', type: 'creature', cost: 2, power: 2, toughness: 2 },
  { name: 'Stone Golem', type: 'creature', cost: 3, power: 3, toughness: 3 },
  { name: 'Sky Drake', type: 'creature', cost: 2, power: 2, toughness: 1 },
  { name: 'Iron Guard', type: 'creature', cost: 3, power: 2, toughness: 4 },
]

function lcg(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

function shuffle<T>(items: T[], seed: number): T[] {
  const random = lcg(seed)
  const clone = [...items]
  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[clone[i], clone[j]] = [clone[j], clone[i]]
  }
  return clone
}

export function createStarterDeck(playerId: number, seed: number): Card[] {
  const lands: Card[] = Array.from({ length: 10 }, (_, index) => ({
    id: `p${playerId}-l${index}`,
    name: 'Basic Land',
    type: 'land',
    cost: 0,
    power: 0,
    toughness: 0,
  }))

  const creatures: Card[] = Array.from({ length: 20 }, (_, index) => {
    const base = CREATURE_POOL[index % CREATURE_POOL.length]
    return {
      ...base,
      id: `p${playerId}-c${index}`,
    }
  })

  return shuffle([...lands, ...creatures], seed + playerId * 97)
}
