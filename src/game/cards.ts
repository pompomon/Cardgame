import type { BasicLand, Card } from './types'

const BASIC_LANDS: BasicLand[] = ['Forest', 'Island', 'Mountain', 'Plains', 'Swamp']

export function lcg(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

export function shuffle<T>(items: T[], seed: number): T[] {
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

function makeCard(owner: string, land: BasicLand, index: number): Card {
  return {
    id: `${owner}-${land.toLowerCase()}-${index}`,
    name: land,
    type: 'land',
  }
}

export function createTutorialDecks(): [Card[], Card[]] {
  const playerDeck: Card[] = [
    makeCard('tutorial-p0', 'Island', 0),
    makeCard('tutorial-p0', 'Forest', 0),
    makeCard('tutorial-p0', 'Mountain', 0),
    makeCard('tutorial-p0', 'Swamp', 0),
    makeCard('tutorial-p0', 'Plains', 0),
  ]
  const playerPattern: BasicLand[] = ['Island', 'Forest', 'Mountain', 'Swamp', 'Plains']
  for (let i = 0; i < 9; i += 1) {
    for (const land of playerPattern) {
      playerDeck.push(makeCard('tutorial-p0', land, i + 1))
    }
  }

  const aiDeck: Card[] = [makeCard('tutorial-p1', 'Island', 0)]
  for (let index = 0; index < 49; index += 1) {
    aiDeck.push(makeCard('tutorial-p1', 'Plains', index))
  }

  return [playerDeck, aiDeck]
}
