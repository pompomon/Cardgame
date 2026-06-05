import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ADVENTURE_GAME_STORAGE_KEY,
  createAdventureRun,
  isAdventureRunState,
  readStoredAdventureGameSnapshot,
} from '../app/adventure'
import {
  ADVENTURE_RUN_STORAGE_KEY,
  clearStoredAdventureRun,
  persistAdventureRun,
  readStoredAdventureRun,
} from '../app/adventure-persistence'
import { createInitialGame } from '../game/engine'
import type { LogEvent } from '../game/types'

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

function validOversizedEvents(): LogEvent[] {
  return Array.from({ length: 10000 }, (_value, index) => ({
    kind: 'turn_start',
    turn: index + 1,
    actor: 0,
  }))
}

function playerOf(state: Record<string, unknown>, index: 0 | 1): Record<string, unknown> {
  return (state.players as Array<Record<string, unknown>>)[index]
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

  it.each([
    ['negative baseSeed', (run: ReturnType<typeof createAdventureRun>) => { run.baseSeed = -1 }],
    ['fractional currentRound', (run: ReturnType<typeof createAdventureRun>) => { run.currentRound = 1.5 }],
    ['fractional remainingChances', (run: ReturnType<typeof createAdventureRun>) => { run.remainingChances = 1.5 }],
    ['fractional winStreak', (run: ReturnType<typeof createAdventureRun>) => { run.winStreak = 1.5 }],
    ['fractional totalRoundsPlayed', (run: ReturnType<typeof createAdventureRun>) => { run.totalRoundsPlayed = 1.5 }],
    ['fractional totalCardsPlayed', (run: ReturnType<typeof createAdventureRun>) => { run.totalCardsPlayed = 1.5 }],
    ['fractional currentOpponentIndex', (run: ReturnType<typeof createAdventureRun>) => { run.currentOpponentIndex = 1.5 }],
    ['negative activeGameSeed', (run: ReturnType<typeof createAdventureRun>) => { run.activeGameSeed = -1 }],
    ['fractional activeGameSeed', (run: ReturnType<typeof createAdventureRun>) => { run.activeGameSeed = 1.5 }],
    ['invalid status', (run: ReturnType<typeof createAdventureRun>) => { run.status = 'waiting' as typeof run.status }],
    ['wrong lineup length', (run: ReturnType<typeof createAdventureRun>) => { run.opponentLineup = run.opponentLineup.slice(0, 6) }],
    ['invalid opponent kind', (run: ReturnType<typeof createAdventureRun>) => { (run.opponentLineup[0] as unknown as Record<string, unknown>).kind = 'boss' }],
    ['invalid opponent lands', (run: ReturnType<typeof createAdventureRun>) => { (run.opponentLineup[0] as unknown as Record<string, unknown>).lands = ['Bogus'] }],
    ['wrong opponent deck length', (run: ReturnType<typeof createAdventureRun>) => { run.opponentLineup[0].deck = run.opponentLineup[0].deck.slice(0, 49) }],
    ['invalid nested card name', (run: ReturnType<typeof createAdventureRun>) => { (run.opponentLineup[0].deck[0] as unknown as Record<string, unknown>).name = 'Bogus' }],
    ['invalid nested card type', (run: ReturnType<typeof createAdventureRun>) => { (run.opponentLineup[0].deck[0] as unknown as Record<string, unknown>).type = 'spell' }],
    ['invalid nested card id', (run: ReturnType<typeof createAdventureRun>) => { (run.opponentLineup[0].deck[0] as unknown as Record<string, unknown>).id = 7 }],
  ])('rejects structurally corrupted adventure runs: %s', (_label, mutate) => {
    const run = createAdventureRun(42)
    mutate(run)
    store.data.set(ADVENTURE_RUN_STORAGE_KEY, JSON.stringify(run))

    expect(readStoredAdventureRun()).toBeNull()
  })

  it.each([
    ['NaN baseSeed', Number.NaN],
    ['Infinity baseSeed', Infinity],
    ['-Infinity baseSeed', -Infinity],
  ])('rejects direct in-memory adventure run %s', (_label, value) => {
    const run = createAdventureRun(42) as unknown as Record<string, unknown>
    run.baseSeed = value

    expect(isAdventureRunState(run)).toBe(false)
  })

  it('rejects adventure run fields that JSON parses as Infinity', () => {
    const run = createAdventureRun(42) as unknown as Record<string, unknown>
    run.activeGameSeed = '__INF__'
    store.data.set(
      ADVENTURE_RUN_STORAGE_KEY,
      JSON.stringify(run).replace('"__INF__"', '1e309'),
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

  it.each([
    ['swapped player ids', (state: Record<string, unknown>) => {
      const players = state.players as unknown[]
      state.players = [players[1], players[0]]
    }],
    ['negative turn', (state: Record<string, unknown>) => { state.turn = -1 }],
    ['fractional turn', (state: Record<string, unknown>) => { state.turn = 1.5 }],
    ['negative nextInstanceId', (state: Record<string, unknown>) => { state.nextInstanceId = -1 }],
    ['fractional nextInstanceId', (state: Record<string, unknown>) => { state.nextInstanceId = 1.5 }],
    ['invalid landsPlayedThisTurn', (state: Record<string, unknown>) => { playerOf(state, 0).landsPlayedThisTurn = 2 }],
    ['fractional landsPlayedThisTurn', (state: Record<string, unknown>) => { playerOf(state, 0).landsPlayedThisTurn = 0.5 }],
    ['invalid phase', (state: Record<string, unknown>) => { state.phase = 'cleanup' }],
    ['invalid winner', (state: Record<string, unknown>) => { state.winner = 5 }],
    ['invalid currentPlayer', (state: Record<string, unknown>) => { state.currentPlayer = 2 }],
    ['malformed pending land play', (state: Record<string, unknown>) => {
      state.pendingLandPlay = {
        actor: 0,
        card: { id: 'c1', name: 'Forest', type: 'land' },
        effectTargetId: 9,
      }
    }],
    ['pending Plains reuse outside plains_target', (state: Record<string, unknown>) => {
      state.phase = 'main'
      state.pendingPlainsReuse = {
        actor: 0,
        reusedInstanceId: 'p0-1',
        reusedCardName: 'Forest',
      }
    }],
    ['missing pending Plains reuse during plains_target', (state: Record<string, unknown>) => {
      state.phase = 'plains_target'
      state.pendingPlainsReuse = null
    }],
    ['malformed pending Plains reuse', (state: Record<string, unknown>) => {
      state.phase = 'plains_target'
      state.pendingPlainsReuse = {
        actor: 0,
        reusedInstanceId: 'p0-1',
        reusedCardName: 'Plains',
      }
    }],
    ['invalid nested card', (state: Record<string, unknown>) => {
      const deck = playerOf(state, 0).deck as Array<Record<string, unknown>>
      deck[0] = { ...deck[0], name: 'Bogus' }
    }],
    ['malformed battlefield entry', (state: Record<string, unknown>) => { playerOf(state, 0).battlefield = [{ instanceId: 'bf-1' }] }],
  ])('rejects structurally corrupted adventure game snapshots: %s', (_label, mutate) => {
    const state = createInitialGame(99) as unknown as Record<string, unknown>
    mutate(state)
    store.data.set(ADVENTURE_GAME_STORAGE_KEY, JSON.stringify(state))

    expect(readStoredAdventureGameSnapshot()).toBeNull()
  })

  it('back-fills missing events on valid legacy adventure game snapshots', () => {
    const state = createInitialGame(100) as unknown as Record<string, unknown>
    delete state.events
    store.data.set(ADVENTURE_GAME_STORAGE_KEY, JSON.stringify(state))

    const parsed = readStoredAdventureGameSnapshot()

    expect(parsed).not.toBeNull()
    expect(parsed?.events).toEqual([])
  })

  it('sanitizes oversized adventure game snapshot events from the tail', () => {
    const state = createInitialGame(101) as unknown as Record<string, unknown>
    const trailingMalformedEvents = Array.from({ length: 300 }, () => ({ kind: 'unknown_event' }))
    state.events = [
      ...validOversizedEvents(),
      ...trailingMalformedEvents,
    ]
    store.data.set(ADVENTURE_GAME_STORAGE_KEY, JSON.stringify(state))

    const parsed = readStoredAdventureGameSnapshot()

    expect(parsed).not.toBeNull()
    expect(parsed?.events).toHaveLength(9700)
    expect(parsed?.events[0]).toEqual({ kind: 'turn_start', turn: 301, actor: 0 })
    expect(parsed?.events.some((event) => event.kind === 'unknown_event')).toBe(false)
  })
})
