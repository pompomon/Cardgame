import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAdventureRun } from '../app/adventure'
import {
  ADVENTURE_RUN_STORAGE_KEY,
  clearStoredAdventureRun,
  persistAdventureRun,
  readStoredAdventureRun,
} from '../app/adventure-persistence'

interface MemoryStore {
  data: Map<string, string>
  shouldThrowOnGet: boolean
  shouldThrowOnSet: boolean
  shouldThrowOnRemove: boolean
}

function installMemoryLocalStorage(): MemoryStore {
  const store: MemoryStore = {
    data: new Map<string, string>(),
    shouldThrowOnGet: false,
    shouldThrowOnSet: false,
    shouldThrowOnRemove: false,
  }
  const stub = {
    getItem(key: string): string | null {
      if (store.shouldThrowOnGet) throw new Error('storage unavailable')
      return store.data.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      if (store.shouldThrowOnSet) throw new Error('storage quota')
      store.data.set(key, String(value))
    },
    removeItem(key: string): void {
      if (store.shouldThrowOnRemove) throw new Error('storage unavailable')
      store.data.delete(key)
    },
    clear(): void { store.data.clear() },
    key(): string | null { return null },
    length: 0,
  }
  vi.stubGlobal('localStorage', stub)
  return store
}

describe('adventure run persistence', () => {
  let store: MemoryStore

  beforeEach(() => {
    store = installMemoryLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null when the run key is missing', () => {
    expect(readStoredAdventureRun()).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    store.data.set(ADVENTURE_RUN_STORAGE_KEY, '{not json')
    expect(readStoredAdventureRun()).toBeNull()
  })

  it('rejects stored runs whose opponent decks are not exactly 50 cards', () => {
    const run = createAdventureRun(42)
    run.opponentLineup[0].deck = run.opponentLineup[0].deck.slice(0, 30)
    store.data.set(ADVENTURE_RUN_STORAGE_KEY, JSON.stringify(run))

    expect(readStoredAdventureRun()).toBeNull()
  })

  it('rejects stored runs with non-finite or out-of-range numeric fields', () => {
    const baseRun = createAdventureRun(42)
    const cases: Array<Partial<typeof baseRun>> = [
      { currentRound: 0 },
      { currentRound: 8 },
      { remainingChances: -1 },
      { winStreak: -3 },
      { totalRoundsPlayed: -1 },
      { totalCardsPlayed: -2 },
      { currentOpponentIndex: -1 },
      { currentOpponentIndex: 7 },
    ]
    for (const overrides of cases) {
      const corrupted = { ...baseRun, ...overrides }
      store.data.set(ADVENTURE_RUN_STORAGE_KEY, JSON.stringify(corrupted))
      expect(readStoredAdventureRun()).toBeNull()
    }
    store.data.set(
      ADVENTURE_RUN_STORAGE_KEY,
      JSON.stringify({ ...baseRun, baseSeed: 'inf-marker' }).replace('"inf-marker"', '1e309'),
    )
    expect(readStoredAdventureRun()).toBeNull()
  })

  it('round-trips a valid run', () => {
    const run = createAdventureRun(123)

    expect(persistAdventureRun(run)).toBe(true)
    expect(readStoredAdventureRun()).toEqual(run)
  })

  it('returns null when storage is unavailable on read', () => {
    store.data.set(ADVENTURE_RUN_STORAGE_KEY, JSON.stringify(createAdventureRun(123)))
    store.shouldThrowOnGet = true

    expect(readStoredAdventureRun()).toBeNull()
  })

  it('returns false when storage is unavailable on write', () => {
    store.shouldThrowOnSet = true

    expect(persistAdventureRun(createAdventureRun(123))).toBe(false)
    expect(store.data.has(ADVENTURE_RUN_STORAGE_KEY)).toBe(false)
  })

  it('does not throw when storage is unavailable on clear', () => {
    store.data.set(ADVENTURE_RUN_STORAGE_KEY, JSON.stringify(createAdventureRun(123)))
    store.shouldThrowOnRemove = true

    expect(() => clearStoredAdventureRun()).not.toThrow()
  })
})
