import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  ADVENTURE_GAME_STORAGE_KEY,
  applyAdventureEncounterResult,
  beginAdventureEncounter,
  clearStoredAdventureGameSnapshot,
  createAdventureRun,
  isAdventureGameSnapshotForRun,
  isAdventureRunState,
  isLegacyAdventureRunState,
  persistAdventureGameSnapshot,
  readStoredAdventureGameSnapshot,
  type AdventureGameSnapshotEnvelope,
  type AdventureRunState,
  type AdventureRunStateV1,
  type StoredAdventureGameSnapshot,
} from '../app/adventure'
import {
  ADVENTURE_RUN_STORAGE_KEY,
  clearStoredAdventureRun,
  persistAdventureRun,
  readStoredAdventureRun,
  readStoredAdventureRunRecord,
} from '../app/adventure-persistence'
import { generateBranchingAdventureMap, isAdventureMap } from '../app/adventure-map'
import { isLegalActionForState } from '../app/action-validation'
import { applyAction, createInitialGame, getLegalActions } from '../game/engine'
import { BASIC_LANDS, type GameState, type LogEvent } from '../game/types'
import { compatibilityDecisions, compatibilityTimeline } from './fixtures/compatibility-scenario'

interface MemoryStore {
  data: Map<string, string>
  shouldThrowOnGet: boolean
  shouldThrowOnSet: boolean
  shouldThrowOnRemove: boolean
  setCalls: number
  removeCalls: number
}

function installMemoryLocalStorage(): MemoryStore {
  const store: MemoryStore = {
    data: new Map<string, string>(),
    shouldThrowOnGet: false,
    shouldThrowOnSet: false,
    shouldThrowOnRemove: false,
    setCalls: 0,
    removeCalls: 0,
  }
  const stub = {
    getItem(key: string): string | null {
      if (store.shouldThrowOnGet) throw new Error('storage unavailable')
      return store.data.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      store.setCalls += 1
      if (store.shouldThrowOnSet) throw new Error('storage quota')
      store.data.set(key, String(value))
    },
    removeItem(key: string): void {
      store.removeCalls += 1
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

const RUN_ID = '0123456789abcdef0123456789abcdef'
const OTHER_RUN_ID = 'fedcba9876543210fedcba9876543210'

interface V1Fixture {
  closedMidRound: Record<string, string>
  pausedMidRound: Record<string, string>
}

function readV1Fixture(): V1Fixture {
  return JSON.parse(readFileSync(resolve(__dirname, 'fixtures', 'adventure-v1-saves.json'), 'utf8')) as V1Fixture
}

function v1Run(): AdventureRunStateV1 {
  return JSON.parse(readV1Fixture().closedMidRound[ADVENTURE_RUN_STORAGE_KEY]) as AdventureRunStateV1
}

function newRun(seed = 123): AdventureRunState {
  return createAdventureRun(seed, RUN_ID)
}

function encounterRun(seed = 123): AdventureRunState {
  return beginAdventureEncounter(newRun(seed), seed)
}

type MutableRecord = Record<string, unknown>

function asRecord(value: unknown): MutableRecord {
  return value as MutableRecord
}

function tier(run: AdventureRunState, index: number): MutableRecord {
  return asRecord(run.map.tiers[index])
}

function node(run: AdventureRunState, index: number): MutableRecord {
  return asRecord(run.map.tiers[index].nodes[0])
}

function opponent(run: AdventureRunState, index: number): MutableRecord {
  return asRecord(run.map.tiers[index].nodes[0].opponent)
}

function card(run: AdventureRunState, tierIndex: number, cardIndex: number): MutableRecord {
  return asRecord(run.map.tiers[tierIndex].nodes[0].opponent.deck[cardIndex])
}

function finishedRunFields(run: AdventureRunState, status: 'completed' | 'failed'): Partial<AdventureRunState> {
  const tierIndex = status === 'completed' ? 6 : 2
  return {
    status,
    stage: null,
    currentTierIndex: tierIndex,
    completedNodeIds: run.map.tiers
      .slice(0, status === 'completed' ? 7 : tierIndex)
      .map((entry) => entry.nodes[0].id),
    selectedNodeId: null,
    attemptSeed: null,
  }
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

function envelopeFor(run: AdventureRunState, game: unknown): MutableRecord {
  return {
    schemaVersion: 2,
    runId: run.runId,
    nodeId: run.selectedNodeId,
    attemptOrdinal: run.attemptOrdinal,
    attemptSeed: run.attemptSeed,
    game,
  }
}

function expectEnvelope(slot: StoredAdventureGameSnapshot): AdventureGameSnapshotEnvelope {
  if (slot.kind !== 'envelope') {
    throw new Error(`Expected an envelope, got ${slot.kind}.`)
  }
  return slot.envelope
}

function snapshotStorage(store: MemoryStore): Array<[string, string]> {
  return [...store.data.entries()]
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

  it('round-trips valid schema version 2 runs', () => {
    for (const run of [newRun(), encounterRun(), applyAdventureEncounterResult(encounterRun(), 'loss', 77)]) {
      expect(persistAdventureRun(run)).toBe(true)
      expect(readStoredAdventureRunRecord()).toEqual({ run, migratedFromV1: false })
    }
  })

  it('reads a cleaned, detached copy without rewriting storage', () => {
    const run = encounterRun()
    const stored = JSON.parse(JSON.stringify(run)) as MutableRecord
    stored.extra = 'top'
    asRecord(stored.map).extra = 'map'
    const storedTier = (asRecord(stored.map).tiers as MutableRecord[])[0]
    storedTier.extra = 'tier'
    const storedNode = (storedTier.nodes as MutableRecord[])[0]
    storedNode.extra = 'node'
    asRecord(storedNode.opponent).extra = 'opponent'
    ;(asRecord(storedNode.opponent).deck as MutableRecord[])[0].extra = 'card'
    const serialized = JSON.stringify(stored)
    store.data.set(ADVENTURE_RUN_STORAGE_KEY, serialized)

    const first = readStoredAdventureRun()
    const second = readStoredAdventureRun()

    expect(first).toEqual(run)
    expect(JSON.stringify(first)).not.toContain('extra')
    expect(first).not.toBe(second)
    expect(first?.map.tiers[0].nodes[0].opponent.deck).not.toBe(second?.map.tiers[0].nodes[0].opponent.deck)
    expect(store.data.get(ADVENTURE_RUN_STORAGE_KEY)).toBe(serialized)
    expect(store.setCalls).toBe(0)
    expect(store.removeCalls).toBe(0)
  })

  it('rejects stored runs whose opponent decks are not exactly 50 cards', () => {
    const run = newRun(42)
    opponent(run, 0).deck = run.map.tiers[0].nodes[0].opponent.deck.slice(0, 30)
    store.data.set(ADVENTURE_RUN_STORAGE_KEY, JSON.stringify(run))

    expect(readStoredAdventureRun()).toBeNull()
  })

  it('rejects stored runs with non-finite or out-of-range numeric fields', () => {
    const baseRun = newRun(42)
    const cases: MutableRecord[] = [
      { currentTierIndex: -1 },
      { currentTierIndex: 7 },
      { remainingChances: -1 },
      { scoreEligibleChances: -1 },
      { winStreak: -3 },
      { scoreEligibleWinStreak: -3 },
      { totalRoundsPlayed: -1 },
      { totalCardsPlayed: -2 },
      { attemptOrdinal: -1 },
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

  it.each<[string, (run: AdventureRunState) => void]>([
    ['schemaVersion 1', (run) => { asRecord(run).schemaVersion = 1 }],
    ['schemaVersion 3', (run) => { asRecord(run).schemaVersion = 3 }],
    ['string schemaVersion', (run) => { asRecord(run).schemaVersion = '2' }],
    ['null schemaVersion', (run) => { asRecord(run).schemaVersion = null }],
    ['missing schemaVersion', (run) => { delete asRecord(run).schemaVersion }],
    ['missing runId', (run) => { delete asRecord(run).runId }],
    ['numeric runId', (run) => { asRecord(run).runId = 12345 }],
    ['uppercase runId', (run) => { run.runId = RUN_ID.toUpperCase() }],
    ['short runId', (run) => { run.runId = RUN_ID.slice(1) }],
    ['long runId', (run) => { run.runId = `${RUN_ID}0` }],
    ['negative baseSeed', (run) => { run.baseSeed = -1 }],
    ['fractional baseSeed', (run) => { run.baseSeed = 1.5 }],
    ['invalid status', (run) => { asRecord(run).status = 'waiting' }],
    ['inactive status', (run) => { asRecord(run).status = 'inactive' }],
    ['unknown stage', (run) => { asRecord(run).stage = 'reward' }],
    ['missing stage', (run) => { delete asRecord(run).stage }],
    ['no stage on a resumable run', (run) => { run.stage = null }],
    ['a stage on a completed run', (run) => {
      Object.assign(run, finishedRunFields(run, 'completed'))
      run.stage = 'map'
    }],
    ['a stage on a failed run', (run) => {
      Object.assign(run, finishedRunFields(run, 'failed'))
      run.stage = 'map'
    }],
    ['missing map', (run) => { delete asRecord(run).map }],
    ['unknown map kind', (run) => { asRecord(run.map).kind = 'graph' }],
    ['six tiers', (run) => { run.map.tiers = run.map.tiers.slice(0, 6) }],
    ['eight tiers', (run) => { run.map.tiers = [...run.map.tiers, run.map.tiers[6]] }],
    ['a tier without nodes', (run) => { tier(run, 2).nodes = [] }],
    ['a forked tier', (run) => {
      tier(run, 2).nodes = [
        { ...run.map.tiers[2].nodes[0], id: 'tier-3-left', lane: 'left' },
        { ...run.map.tiers[2].nodes[0], id: 'tier-3-right', lane: 'right' },
      ]
    }],
    ['a side lane', (run) => { node(run, 2).lane = 'left'; node(run, 2).id = 'tier-3-left' }],
    ['an unknown lane', (run) => { node(run, 2).lane = 'middle' }],
    ['a node id from another tier', (run) => { node(run, 2).id = 'tier-2-center' }],
    ['an unknown node id', (run) => { node(run, 2).id = 'boss' }],
    ['a non-mono final linear tier', (run) => { node(run, 6).opponent = run.map.tiers[0].nodes[0].opponent }],
    ['a mono non-final linear tier', (run) => { node(run, 0).opponent = run.map.tiers[6].nodes[0].opponent }],
    ['invalid opponent kind', (run) => { opponent(run, 0).kind = 'boss' }],
    ['invalid opponent lands', (run) => { opponent(run, 0).lands = ['Bogus'] }],
    ['no opponent lands', (run) => { opponent(run, 0).lands = [] }],
    ['repeated opponent lands', (run) => { opponent(run, 0).lands = ['Forest', 'Forest'] }],
    ['six opponent lands', (run) => { opponent(run, 0).lands = [...BASIC_LANDS, 'Forest'] }],
    ['empty opponent id', (run) => { opponent(run, 0).id = '' }],
    ['oversized opponent id', (run) => { opponent(run, 0).id = 'x'.repeat(129) }],
    ['empty opponent label', (run) => { opponent(run, 0).label = '' }],
    ['oversized opponent label', (run) => { opponent(run, 0).label = 'x'.repeat(257) }],
    ['numeric opponent label', (run) => { opponent(run, 0).label = 7 }],
    ['wrong opponent deck length', (run) => { opponent(run, 0).deck = run.map.tiers[0].nodes[0].opponent.deck.slice(0, 49) }],
    ['invalid nested card name', (run) => { card(run, 0, 0).name = 'Bogus' }],
    ['invalid nested card type', (run) => { card(run, 0, 0).type = 'spell' }],
    ['invalid nested card id', (run) => { card(run, 0, 0).id = 7 }],
    ['empty nested card id', (run) => { card(run, 0, 0).id = '' }],
    ['oversized nested card id', (run) => { card(run, 0, 0).id = 'x'.repeat(129) }],
    ['duplicate nested card ids', (run) => { card(run, 0, 1).id = run.map.tiers[0].nodes[0].opponent.deck[0].id }],
    ['fractional currentTierIndex', (run) => { run.currentTierIndex = 1.5 }],
    ['string currentTierIndex', (run) => { asRecord(run).currentTierIndex = '1' }],
    ['too few completed nodes', (run) => { run.currentTierIndex = 2; run.completedNodeIds = ['tier-1-center'] }],
    ['too many completed nodes', (run) => { run.completedNodeIds = ['tier-1-center'] }],
    ['completed nodes out of order', (run) => {
      run.currentTierIndex = 2
      run.completedNodeIds = ['tier-2-center', 'tier-1-center']
    }],
    ['an unknown completed node', (run) => { run.currentTierIndex = 1; run.completedNodeIds = ['tier-1-left'] }],
    ['non-array completed nodes', (run) => { asRecord(run).completedNodeIds = 'tier-1-center' }],
    ['a selected node from another tier', (run) => { run.selectedNodeId = 'tier-2-center' }],
    ['an unknown selected node', (run) => { run.selectedNodeId = 'tier-1-left' }],
    ['no selected node at an encounter', (run) => { run.stage = 'encounter'; run.selectedNodeId = null }],
    ['negative attemptOrdinal', (run) => { run.attemptOrdinal = -1 }],
    ['fractional attemptOrdinal', (run) => { run.attemptOrdinal = 0.5 }],
    ['unsafe attemptOrdinal', (run) => { run.attemptOrdinal = 2 ** 53 }],
    ['negative attemptSeed', (run) => { run.attemptSeed = -1 }],
    ['fractional attemptSeed', (run) => { run.attemptSeed = 1.5 }],
    ['no attemptSeed at an encounter', (run) => {
      run.stage = 'encounter'
      run.selectedNodeId = 'tier-1-center'
      run.attemptSeed = null
    }],
    ['fractional remainingChances', (run) => { run.remainingChances = 1.5 }],
    ['fractional scoreEligibleChances', (run) => { run.scoreEligibleChances = 1.5 }],
    ['fractional winStreak', (run) => { run.winStreak = 1.5 }],
    ['fractional scoreEligibleWinStreak', (run) => { run.scoreEligibleWinStreak = 1.5 }],
    ['fractional totalRoundsPlayed', (run) => { run.totalRoundsPlayed = 1.5 }],
    ['fractional totalCardsPlayed', (run) => { run.totalCardsPlayed = 1.5 }],
    ['missing score counter', (run) => { delete asRecord(run).scoreEligibleChances }],
    ['relics', (run) => { asRecord(run).relics = ['lucky-coin'] }],
    ['reward history', (run) => { asRecord(run).rewardHistory = [{ kind: 'boon' }] }],
    ['non-array relics', (run) => { asRecord(run).relics = {} }],
    ['missing reward history', (run) => { delete asRecord(run).rewardHistory }],
  ])('rejects structurally corrupted adventure runs: %s', (_label, mutate) => {
    const run = newRun(42)
    mutate(run)
    const serialized = JSON.stringify(run)
    store.data.set(ADVENTURE_RUN_STORAGE_KEY, serialized)

    expect(readStoredAdventureRun()).toBeNull()
    expect(isAdventureRunState(run)).toBe(false)
    expect(store.data.get(ADVENTURE_RUN_STORAGE_KEY)).toBe(serialized)
  })

  it('treats a stored run on a valid branching map as unavailable and never rewrites it', () => {
    const run = { ...newRun(42), map: generateBranchingAdventureMap(42) }
    expect(isAdventureMap(run.map)).toBe(true)
    const serialized = JSON.stringify(run)
    store.data.set(ADVENTURE_RUN_STORAGE_KEY, serialized)

    expect(readStoredAdventureRunRecord()).toBeNull()
    expect(readStoredAdventureRun()).toBeNull()
    expect(persistAdventureRun(run)).toBe(false)
    expect(store.data.get(ADVENTURE_RUN_STORAGE_KEY)).toBe(serialized)
    expect(store.setCalls).toBe(0)
    expect(store.removeCalls).toBe(0)
  })

  it.each<[string, (run: AdventureRunState) => void]>([
    ['selected node on a failed run', (run) => {
      run.status = 'failed'
      run.stage = null
      run.attemptSeed = null
      run.selectedNodeId = 'tier-1-center'
    }],
    ['attempt seed on a failed run', (run) => {
      run.status = 'failed'
      run.stage = null
    }],
    ['completed run before the final tier', (run) => {
      run.status = 'completed'
      run.stage = null
      run.attemptSeed = null
      run.currentTierIndex = 5
      run.completedNodeIds = run.map.tiers.map((entry) => entry.nodes[0].id)
    }],
    ['completed run missing the final node', (run) => {
      run.status = 'completed'
      run.stage = null
      run.attemptSeed = null
      run.currentTierIndex = 6
      run.completedNodeIds = run.map.tiers.slice(0, 6).map((entry) => entry.nodes[0].id)
    }],
  ])('rejects finished runs with leftover progress: %s', (_label, mutate) => {
    const run = newRun(42)
    mutate(run)
    store.data.set(ADVENTURE_RUN_STORAGE_KEY, JSON.stringify(run))

    expect(readStoredAdventureRun()).toBeNull()
  })

  it.each(['completed', 'failed'] as const)('accepts a %s run without leftover progress', (status) => {
    const run = newRun(42)
    Object.assign(run, finishedRunFields(run, status))

    expect(persistAdventureRun(run)).toBe(true)
    expect(readStoredAdventureRun()).toEqual(run)
  })

  it.each([
    ['NaN baseSeed', Number.NaN],
    ['Infinity baseSeed', Infinity],
    ['-Infinity baseSeed', -Infinity],
  ])('rejects direct in-memory adventure run %s', (_label, value) => {
    const run = asRecord(newRun(42))
    run.baseSeed = value

    expect(isAdventureRunState(run)).toBe(false)
  })

  it('rejects adventure run fields that JSON parses as Infinity', () => {
    const run = asRecord(newRun(42))
    run.attemptSeed = '__INF__'
    store.data.set(
      ADVENTURE_RUN_STORAGE_KEY,
      JSON.stringify(run).replace('"__INF__"', '1e309'),
    )

    expect(readStoredAdventureRun()).toBeNull()
  })

  it('refuses to write invalid runs', () => {
    const valid = newRun(42)
    expect(persistAdventureRun(valid)).toBe(true)
    const before = store.data.get(ADVENTURE_RUN_STORAGE_KEY)
    const invalid = newRun(43)
    invalid.currentTierIndex = 3

    expect(persistAdventureRun(invalid)).toBe(false)
    expect(persistAdventureRun({ ...valid, schemaVersion: 3 } as unknown as AdventureRunState)).toBe(false)
    expect(store.data.get(ADVENTURE_RUN_STORAGE_KEY)).toBe(before)
  })

  it('writes only known fields', () => {
    const run = newRun(42)
    asRecord(run).extra = 'top'

    expect(persistAdventureRun(run)).toBe(true)
    expect(store.data.get(ADVENTURE_RUN_STORAGE_KEY)).not.toContain('extra')
  })

  it('loads pre-migration opponent labels without rewriting the stored fields', () => {
    const run = newRun(123)
    node(run, 0).opponent = {
      ...run.map.tiers[0].nodes[0].opponent,
      label: 'Standard Deck (10 of each land)',
      kind: 'standard',
      lands: [...BASIC_LANDS],
    }
    node(run, 6).opponent = {
      ...run.map.tiers[6].nodes[0].opponent,
      label: 'Boss: Mono Forest Deck',
      kind: 'mono',
      lands: ['Forest'],
    }
    const serialized = JSON.stringify(run)
    store.data.set(ADVENTURE_RUN_STORAGE_KEY, serialized)

    const restored = readStoredAdventureRun()

    expect(restored?.map.tiers[0].nodes[0].opponent.label).toBe('Standard Deck (10 of each land)')
    expect(restored?.map.tiers[6].nodes[0].opponent.label).toBe('Boss: Mono Forest Deck')
    expect(store.data.get(ADVENTURE_RUN_STORAGE_KEY)).toBe(serialized)
  })

  it('returns null when storage is unavailable on read', () => {
    store.data.set(ADVENTURE_RUN_STORAGE_KEY, JSON.stringify(newRun(123)))
    store.shouldThrowOnGet = true

    expect(readStoredAdventureRun()).toBeNull()
  })

  it('returns false when storage is unavailable on write', () => {
    store.shouldThrowOnSet = true

    expect(persistAdventureRun(newRun(123))).toBe(false)
    expect(store.data.has(ADVENTURE_RUN_STORAGE_KEY)).toBe(false)
  })

  it('does not throw when storage is unavailable on clear', () => {
    store.data.set(ADVENTURE_RUN_STORAGE_KEY, JSON.stringify(newRun(123)))
    store.shouldThrowOnRemove = true

    expect(() => clearStoredAdventureRun()).not.toThrow()
  })
})

describe('version 1 adventure run reads', () => {
  let store: MemoryStore

  beforeEach(() => {
    store = installMemoryLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('converts the captured version 1 save in memory and leaves storage byte-for-byte unchanged', () => {
    const fixture = readV1Fixture().pausedMidRound
    for (const [key, value] of Object.entries(fixture)) {
      store.data.set(key, value)
    }
    const before = snapshotStorage(store)
    const legacy = JSON.parse(fixture[ADVENTURE_RUN_STORAGE_KEY]) as AdventureRunStateV1

    const record = readStoredAdventureRunRecord()
    const slot = readStoredAdventureGameSnapshot()

    expect(record?.migratedFromV1).toBe(true)
    expect(isAdventureRunState(record?.run)).toBe(true)
    expect(record?.run).toMatchObject({
      schemaVersion: 2,
      baseSeed: legacy.baseSeed,
      status: 'paused',
      stage: 'map',
      currentTierIndex: legacy.currentOpponentIndex,
      attemptSeed: legacy.activeGameSeed,
      totalCardsPlayed: legacy.totalCardsPlayed,
    })
    expect(record?.run.map.kind).toBe('legacy-linear')
    expect(record?.run.map.tiers.map((entry) => entry.nodes[0].opponent)).toEqual(legacy.opponentLineup)
    expect(slot).toEqual({ kind: 'legacy' })
    expect(snapshotStorage(store)).toEqual(before)
    expect(store.setCalls).toBe(0)
    expect(store.removeCalls).toBe(0)
  })

  it('gives each unsaved conversion a fresh run ID', () => {
    store.data.set(ADVENTURE_RUN_STORAGE_KEY, readV1Fixture().closedMidRound[ADVENTURE_RUN_STORAGE_KEY])

    const first = readStoredAdventureRunRecord()
    const second = readStoredAdventureRunRecord()

    expect(first?.run.runId).toMatch(/^[0-9a-f]{32}$/)
    expect(second?.run.runId).toMatch(/^[0-9a-f]{32}$/)
    expect(first?.run.runId).not.toBe(second?.run.runId)
    expect({ ...first?.run, runId: '' }).toEqual({ ...second?.run, runId: '' })
  })

  it('reuses a valid conversion run ID for version 1 saves only', () => {
    const kept = 'fedcba9876543210fedcba9876543210'
    store.data.set(ADVENTURE_RUN_STORAGE_KEY, readV1Fixture().closedMidRound[ADVENTURE_RUN_STORAGE_KEY])

    expect(readStoredAdventureRunRecord(kept)?.run.runId).toBe(kept)
    for (const invalid of ['', 'not-a-run-id', kept.toUpperCase(), `${kept}0`]) {
      const record = readStoredAdventureRunRecord(invalid)
      expect(record?.run.runId).toMatch(/^[0-9a-f]{32}$/)
      expect(record?.run.runId).not.toBe(invalid)
    }

    const run = encounterRun()
    expect(run.runId).not.toBe(kept)
    store.data.set(ADVENTURE_RUN_STORAGE_KEY, JSON.stringify(run))
    expect(readStoredAdventureRunRecord(kept)).toEqual({ run, migratedFromV1: false })
    expect(store.setCalls).toBe(0)
    expect(store.removeCalls).toBe(0)
  })

  it.each<[string, (run: AdventureRunStateV1) => void]>([
    ['currentRound 0', (run) => { run.currentRound = 0 }],
    ['currentRound 8', (run) => { run.currentRound = 8 }],
    ['negative remainingChances', (run) => { run.remainingChances = -1 }],
    ['negative winStreak', (run) => { run.winStreak = -3 }],
    ['negative totalRoundsPlayed', (run) => { run.totalRoundsPlayed = -1 }],
    ['negative totalCardsPlayed', (run) => { run.totalCardsPlayed = -2 }],
    ['negative currentOpponentIndex', (run) => { run.currentOpponentIndex = -1 }],
    ['currentOpponentIndex 7', (run) => { run.currentOpponentIndex = 7 }],
    ['negative baseSeed', (run) => { run.baseSeed = -1 }],
    ['fractional currentRound', (run) => { run.currentRound = 1.5 }],
    ['fractional remainingChances', (run) => { run.remainingChances = 1.5 }],
    ['fractional winStreak', (run) => { run.winStreak = 1.5 }],
    ['fractional totalRoundsPlayed', (run) => { run.totalRoundsPlayed = 1.5 }],
    ['fractional totalCardsPlayed', (run) => { run.totalCardsPlayed = 1.5 }],
    ['fractional currentOpponentIndex', (run) => { run.currentOpponentIndex = 1.5 }],
    ['negative activeGameSeed', (run) => { run.activeGameSeed = -1 }],
    ['fractional activeGameSeed', (run) => { run.activeGameSeed = 1.5 }],
    ['invalid status', (run) => { asRecord(run).status = 'waiting' }],
    ['wrong lineup length', (run) => { run.opponentLineup = run.opponentLineup.slice(0, 6) }],
    ['invalid opponent kind', (run) => { asRecord(run.opponentLineup[0]).kind = 'boss' }],
    ['invalid opponent lands', (run) => { asRecord(run.opponentLineup[0]).lands = ['Bogus'] }],
    ['wrong opponent deck length', (run) => { run.opponentLineup[0].deck = run.opponentLineup[0].deck.slice(0, 49) }],
    ['invalid nested card name', (run) => { asRecord(run.opponentLineup[0].deck[0]).name = 'Bogus' }],
    ['invalid nested card type', (run) => { asRecord(run.opponentLineup[0].deck[0]).type = 'spell' }],
    ['invalid nested card id', (run) => { asRecord(run.opponentLineup[0].deck[0]).id = 7 }],
  ])('rejects version 1 runs that fail the strict version 1 guard: %s', (_label, mutate) => {
    const run = v1Run()
    mutate(run)
    const serialized = JSON.stringify(run)
    store.data.set(ADVENTURE_RUN_STORAGE_KEY, serialized)

    expect(isLegacyAdventureRunState(run)).toBe(false)
    expect(readStoredAdventureRun()).toBeNull()
    expect(store.data.get(ADVENTURE_RUN_STORAGE_KEY)).toBe(serialized)
  })

  it('rejects version 1 runs that break a stricter version 2 limit', () => {
    const run = v1Run()
    run.opponentLineup[0].deck[1].id = run.opponentLineup[0].deck[0].id
    store.data.set(ADVENTURE_RUN_STORAGE_KEY, JSON.stringify(run))

    expect(isLegacyAdventureRunState(run)).toBe(true)
    expect(readStoredAdventureRun()).toBeNull()
  })

  it.each([1, 3, '2', null, 0, 2.5, true])('treats schemaVersion %j as unavailable without repairing it', (version) => {
    for (const payload of [{ ...v1Run(), schemaVersion: version }, { ...encounterRun(), schemaVersion: version }]) {
      const serialized = JSON.stringify(payload)
      store.data.set(ADVENTURE_RUN_STORAGE_KEY, serialized)

      expect(readStoredAdventureRunRecord()).toBeNull()
      expect(store.data.get(ADVENTURE_RUN_STORAGE_KEY)).toBe(serialized)
    }
    expect(store.setCalls).toBe(0)
  })

  it.each(['[]', '7', '"run"', 'null'])('rejects non-object run payload %s', (payload) => {
    store.data.set(ADVENTURE_RUN_STORAGE_KEY, payload)

    expect(readStoredAdventureRunRecord()).toBeNull()
  })
})

describe('adventure game snapshot envelope', () => {
  let store: MemoryStore

  beforeEach(() => {
    store = installMemoryLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('round-trips the identity-bound envelope for the current attempt', () => {
    const run = applyAdventureEncounterResult(encounterRun(), 'draw', 9001)
    const resumed = beginAdventureEncounter(run, 1)
    const game = createInitialGame(9001)

    expect(persistAdventureGameSnapshot(resumed, game)).toBe(true)
    const envelope = expectEnvelope(readStoredAdventureGameSnapshot())

    expect(envelope).toEqual({
      schemaVersion: 2,
      runId: RUN_ID,
      nodeId: 'tier-1-center',
      attemptOrdinal: 1,
      attemptSeed: 9001,
      game,
    })
    expect(isAdventureGameSnapshotForRun(envelope, resumed)).toBe(true)
  })

  it('refuses to save a game for a run outside an encounter', () => {
    expect(persistAdventureGameSnapshot(newRun(), createInitialGame(1))).toBe(false)
    expect(store.data.has(ADVENTURE_GAME_STORAGE_KEY)).toBe(false)
  })

  it.each<[string, (run: AdventureRunState) => AdventureRunState]>([
    ['run', (run) => ({ ...run, runId: OTHER_RUN_ID })],
    ['node', (run) => {
      const next = beginAdventureEncounter(applyAdventureEncounterResult(run, 'win', run.attemptSeed!), 1)
      return { ...next, attemptSeed: run.attemptSeed }
    }],
    ['attempt number', (run) => ({ ...run, attemptOrdinal: run.attemptOrdinal + 1 })],
    ['attempt seed', (run) => ({ ...run, attemptSeed: run.attemptSeed! + 1 })],
  ])('does not match a run with a different %s', (_label, change) => {
    const run = encounterRun()
    persistAdventureGameSnapshot(run, createInitialGame(2))
    const envelope = expectEnvelope(readStoredAdventureGameSnapshot())

    expect(isAdventureGameSnapshotForRun(envelope, run)).toBe(true)
    expect(isAdventureGameSnapshotForRun(envelope, change(run))).toBe(false)
  })

  it.each(compatibilityDecisions)('preserves pending identities and legal targets for $label', ({ index }) => {
    const { steps } = compatibilityTimeline()
    const pending = steps[index].before
    persistAdventureGameSnapshot(encounterRun(), pending)
    const serialized = store.data.get(ADVENTURE_GAME_STORAGE_KEY)
    expect(serialized).toBeTruthy()
    expect(serialized).not.toMatch(/"displayName"|"assetSlug"|Gravebloom|Doppelgänger|Vampire/)

    let restored: GameState = expectEnvelope(readStoredAdventureGameSnapshot()).game
    expect(restored).toEqual(pending)
    for (const step of steps.slice(index)) {
      expect(getLegalActions(restored, step.action.actor)).toEqual(
        getLegalActions(step.before, step.action.actor),
      )
      expect(isLegalActionForState(restored, step.action)).toBe(true)
      restored = applyAction(restored, step.action)
      expect(restored).toEqual(step.state)
      if (restored.phase === 'main' || restored.phase === 'gameOver') break
    }
    expect(restored.pendingLandPlay).toBeNull()
    expect(restored.pendingPlainsReuse).toBeNull()
    expect(restored.pendingSwampDiscard).toBeNull()
    expect(store.data.get(ADVENTURE_GAME_STORAGE_KEY)).toBe(serialized)
  })

  it('classifies the captured version 1 bare game as legacy without restoring or rewriting it', () => {
    const bare = readV1Fixture().pausedMidRound[ADVENTURE_GAME_STORAGE_KEY]
    store.data.set(ADVENTURE_GAME_STORAGE_KEY, bare)

    expect(readStoredAdventureGameSnapshot()).toEqual({ kind: 'legacy' })
    expect(store.data.get(ADVENTURE_GAME_STORAGE_KEY)).toBe(bare)
  })

  it.each([
    ['empty slot', null, 'none'],
    ['invalid JSON', '{not json', 'invalid'],
    ['JSON null', 'null', 'invalid'],
    ['an array', '[]', 'invalid'],
    ['a number', '7', 'invalid'],
    ['a string', '"game"', 'invalid'],
    ['an unversioned non-game object', '{"turn":1}', 'invalid'],
  ])('classifies %s as %s', (_label, raw, kind) => {
    if (raw !== null) {
      store.data.set(ADVENTURE_GAME_STORAGE_KEY, raw)
    }

    expect(readStoredAdventureGameSnapshot()).toEqual({ kind })
    expect(store.setCalls).toBe(0)
    expect(store.removeCalls).toBe(0)
  })

  it.each<[string, (envelope: MutableRecord) => void]>([
    ['schemaVersion 1', (envelope) => { envelope.schemaVersion = 1 }],
    ['schemaVersion 3', (envelope) => { envelope.schemaVersion = 3 }],
    ['string schemaVersion', (envelope) => { envelope.schemaVersion = '2' }],
    ['null schemaVersion', (envelope) => { envelope.schemaVersion = null }],
    ['missing schemaVersion', (envelope) => { delete envelope.schemaVersion }],
    ['invalid runId', (envelope) => { envelope.runId = 'run-1' }],
    ['missing runId', (envelope) => { delete envelope.runId }],
    ['invalid nodeId', (envelope) => { envelope.nodeId = 'tier-8-center' }],
    ['null nodeId', (envelope) => { envelope.nodeId = null }],
    ['negative attemptOrdinal', (envelope) => { envelope.attemptOrdinal = -1 }],
    ['fractional attemptOrdinal', (envelope) => { envelope.attemptOrdinal = 0.5 }],
    ['negative attemptSeed', (envelope) => { envelope.attemptSeed = -1 }],
    ['fractional attemptSeed', (envelope) => { envelope.attemptSeed = 1.5 }],
    ['null attemptSeed', (envelope) => { envelope.attemptSeed = null }],
    ['missing game', (envelope) => { delete envelope.game }],
    ['invalid game', (envelope) => { envelope.game = { turn: 1 } }],
  ])('classifies an envelope with %s as invalid', (_label, mutate) => {
    const envelope = envelopeFor(encounterRun(), createInitialGame(98))
    mutate(envelope)
    store.data.set(ADVENTURE_GAME_STORAGE_KEY, JSON.stringify(envelope))

    expect(readStoredAdventureGameSnapshot()).toEqual({ kind: 'invalid' })
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
    ['pending Swamp discard outside swamp_target', (state: Record<string, unknown>) => {
      state.phase = 'main'
      state.pendingSwampDiscard = { actor: 0 }
    }],
    ['missing pending Swamp discard during swamp_target', (state: Record<string, unknown>) => {
      state.phase = 'swamp_target'
      state.pendingSwampDiscard = null
    }],
    ['invalid nested card', (state: Record<string, unknown>) => {
      const deck = playerOf(state, 0).deck as Array<Record<string, unknown>>
      deck[0] = { ...deck[0], name: 'Bogus' }
    }],
    ['malformed battlefield entry', (state: Record<string, unknown>) => { playerOf(state, 0).battlefield = [{ instanceId: 'bf-1' }] }],
  ])('rejects structurally corrupted adventure game snapshots: %s', (_label, mutate) => {
    const state = createInitialGame(99) as unknown as Record<string, unknown>
    mutate(state)

    store.data.set(ADVENTURE_GAME_STORAGE_KEY, JSON.stringify(envelopeFor(encounterRun(), state)))
    expect(readStoredAdventureGameSnapshot()).toEqual({ kind: 'invalid' })

    // A corrupted bare game is not even a recognizable version 1 save.
    store.data.set(ADVENTURE_GAME_STORAGE_KEY, JSON.stringify(state))
    expect(readStoredAdventureGameSnapshot()).toEqual({ kind: 'invalid' })
  })

  it('back-fills missing events on valid enveloped games', () => {
    const state = createInitialGame(100) as unknown as Record<string, unknown>
    delete state.events
    store.data.set(ADVENTURE_GAME_STORAGE_KEY, JSON.stringify(envelopeFor(encounterRun(), state)))

    const envelope = expectEnvelope(readStoredAdventureGameSnapshot())

    expect(envelope.game.events).toEqual([])
  })

  it('sanitizes oversized enveloped game events from the tail', () => {
    const state = createInitialGame(101) as unknown as Record<string, unknown>
    const trailingMalformedEvents = Array.from({ length: 300 }, () => ({ kind: 'unknown_event' }))
    state.events = [
      ...validOversizedEvents(),
      ...trailingMalformedEvents,
    ]
    store.data.set(ADVENTURE_GAME_STORAGE_KEY, JSON.stringify(envelopeFor(encounterRun(), state)))

    const envelope = expectEnvelope(readStoredAdventureGameSnapshot())

    expect(envelope.game.events).toHaveLength(9700)
    expect(envelope.game.events[0]).toEqual({ kind: 'turn_start', turn: 301, actor: 0 })
    expect(envelope.game.events).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ kind: 'unknown_event' }),
      ]),
    )
  })

  it('clears the slot on a best-effort basis', () => {
    persistAdventureGameSnapshot(encounterRun(), createInitialGame(3))

    store.shouldThrowOnRemove = true
    expect(clearStoredAdventureGameSnapshot()).toBe(false)
    expect(store.data.has(ADVENTURE_GAME_STORAGE_KEY)).toBe(true)

    store.shouldThrowOnRemove = false
    expect(clearStoredAdventureGameSnapshot()).toBe(true)
    expect(readStoredAdventureGameSnapshot()).toEqual({ kind: 'none' })
  })
})
