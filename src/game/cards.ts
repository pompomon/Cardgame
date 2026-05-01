import type { BasicLand, Card } from './types'

const BASIC_LANDS: BasicLand[] = ['Forest', 'Island', 'Mountain', 'Plains', 'Swamp']

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
  const lands: Card[] = BASIC_LANDS.flatMap((land) =>
    Array.from({ length: 10 }, (_, index) => ({
      id: `p${playerId}-${land.toLowerCase()}-${index}`,
      name: land,
      type: 'land',
    })),
  )

  return shuffle(lands, seed + playerId * 97)
}
