import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createStarterDeck } from '../game/cards'
import { BASIC_LANDS } from '../game/types'
import {
  ADVENTURE_SCHEMA_VERSION,
  ADVENTURE_TIER_COUNT,
  adventureNodeId,
  applyAdventureEncounterResult,
  beginAdventureEncounter,
  buildAdventureLineup,
  cloneAdventureRun,
  computeAdventureScore,
  createAdventureRun,
  createAdventureRunId,
  createInactiveAdventureState,
  currentAdventureNode,
  deckPairForAdventureGame,
  isAdventureRunState,
  isLegacyAdventureRunState,
  isResumableAdventureRun,
  migrateLegacyAdventureRun,
  normalizeAdventureRun,
  pauseAdventureRun,
  type AdventureRunState,
  type AdventureRunStateV1,
  type AdventureRunStatus,
} from '../app/adventure'
import { generateBranchingAdventureMap, isAdventureMap, isAdventureRouteState } from '../app/adventure-map'

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
    const run = createAdventureRun(22, RUN_ID)
    run.remainingChances = 4
    run.scoreEligibleChances = 4
    run.totalCardsPlayed = 17
    run.totalRoundsPlayed = 6
    expect(computeAdventureScore(run)).toBe(4 * 100 - 17 + 6 * 5)
  })

  it('scores only score-eligible chances', () => {
    const run = createAdventureRun(22, RUN_ID)
    run.remainingChances = 9
    run.scoreEligibleChances = 2
    run.totalCardsPlayed = 17
    run.totalRoundsPlayed = 6
    expect(computeAdventureScore(run)).toBe(2 * 100 - 17 + 6 * 5)
  })
})

const RUN_ID = '0123456789abcdef0123456789abcdef'
const RUN_ID_PATTERN = /^[0-9a-f]{32}$/

interface V1Fixture {
  closedMidRound: Record<string, string>
  pausedMidRound: Record<string, string>
}

function readV1Fixture(): V1Fixture {
  return JSON.parse(readFileSync(resolve(__dirname, 'fixtures', 'adventure-v1-saves.json'), 'utf8')) as V1Fixture
}

/** The real version 1 run captured mid-run with the pre-migration code. */
function v1Run(): AdventureRunStateV1 {
  return JSON.parse(readV1Fixture().closedMidRound['cardgame.adventure-run']) as AdventureRunStateV1
}

function migrated(legacy: AdventureRunStateV1 = v1Run()): AdventureRunState {
  const run = migrateLegacyAdventureRun(legacy, RUN_ID)
  if (!run) throw new Error('Expected the version 1 run to migrate.')
  return run
}

function encounterAt(tierIndex: number, run = createAdventureRun(500, RUN_ID)): AdventureRunState {
  let current = beginAdventureEncounter(run, 1)
  for (let tier = current.currentTierIndex; tier < tierIndex; tier += 1) {
    current = beginAdventureEncounter(applyAdventureEncounterResult(current, 'win', 1000 + tier), 1)
  }
  return current
}

describe('schema version 2 Adventure runs', () => {
  it('wraps the unchanged lineup builder in seven linear tiers', () => {
    const run = createAdventureRun(12345, RUN_ID)

    expect(run).toEqual({
      schemaVersion: ADVENTURE_SCHEMA_VERSION,
      runId: RUN_ID,
      baseSeed: 12345,
      status: 'active',
      stage: 'map',
      map: {
        kind: 'linear',
        tiers: buildAdventureLineup(12345).map((opponent, tierIndex) => ({
          nodes: [{ id: `tier-${tierIndex + 1}-center`, lane: 'center', opponent }],
        })),
      },
      currentTierIndex: 0,
      completedNodeIds: [],
      selectedNodeId: null,
      attemptOrdinal: 0,
      attemptSeed: 12345,
      remainingChances: 3,
      scoreEligibleChances: 3,
      winStreak: 0,
      scoreEligibleWinStreak: 0,
      totalRoundsPlayed: 0,
      totalCardsPlayed: 0,
      relics: [],
      rewardHistory: [],
    })
    expect(run.map.tiers).toHaveLength(ADVENTURE_TIER_COUNT)
    expect(isAdventureRunState(run)).toBe(true)
  })

  it('builds the same opponents and decks as the version 1 run for the same seed', () => {
    const legacy = v1Run()
    const run = createAdventureRun(legacy.baseSeed, RUN_ID)

    expect(run.map.tiers.map((tier) => tier.nodes[0].opponent)).toEqual(legacy.opponentLineup)
    expect(createAdventureRun(legacy.baseSeed, createAdventureRunId()).map).toEqual(run.map)
  })

  it('keeps new runs on linear maps instead of the branching generator', () => {
    for (const seed of [0, 12345, 2 ** 32 + 1, 1_760_000_000_000]) {
      const run = createAdventureRun(seed, RUN_ID)

      expect(run.map.kind).toBe('linear')
      expect(run.map.tiers.map((tier) => tier.nodes.map((node) => node.lane))).toEqual(
        Array.from({ length: ADVENTURE_TIER_COUNT }, () => ['center']),
      )
      expect(run.map).not.toEqual(generateBranchingAdventureMap(seed))
    }
  })

  it('rejects runs on a branching map even when the map and route are valid', () => {
    const seed = 1_760_000_000_000
    const created = createAdventureRun(seed, RUN_ID)
    const runs = [
      { ...created, map: generateBranchingAdventureMap(seed) },
      { ...beginAdventureEncounter(created, 1), map: generateBranchingAdventureMap(seed) },
    ]

    for (const run of runs) {
      expect(isAdventureMap(run.map)).toBe(true)
      expect(isAdventureRouteState(run)).toBe(true)
      expect(isAdventureRunState(run)).toBe(false)
      expect(normalizeAdventureRun(run)).toBeNull()
    }
  })

  it('launches the version 1 deck pair from the current node without sharing decks', () => {
    const run = beginAdventureEncounter(createAdventureRun(321, RUN_ID), 1)
    const [playerDeck, opponentDeck] = deckPairForAdventureGame(run, 777)

    expect(playerDeck).toEqual(createStarterDeck(0, 777))
    expect(opponentDeck).toEqual(buildAdventureLineup(321)[0].deck)
    expect(opponentDeck).not.toBe(run.map.tiers[0].nodes[0].opponent.deck)
    expect(opponentDeck[0]).not.toBe(run.map.tiers[0].nodes[0].opponent.deck[0])
  })

  it('creates the inactive baseline without a run', () => {
    expect(createInactiveAdventureState()).toEqual({ run: null, highScore: 0, hasSavedRun: false })
    expect(createInactiveAdventureState(42, true)).toEqual({ run: null, highScore: 42, hasSavedRun: true })
  })
})

describe('Adventure run IDs', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('creates 32-character lowercase hexadecimal run IDs', () => {
    expect(createAdventureRunId()).toMatch(RUN_ID_PATTERN)
  })

  it('creates different run IDs for runs started with a frozen clock and the same seed', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_760_000_000_000)
    const first = createAdventureRun(1_760_000_000_000, createAdventureRunId())
    const second = createAdventureRun(1_760_000_000_000, createAdventureRunId())

    expect(first.runId).not.toBe(second.runId)
    expect(first.map).toEqual(second.map)
  })

  it.each([
    ['throws', { getRandomValues: () => { throw new Error('insecure context') } }],
    ['is missing', undefined],
  ])('falls back to unique run IDs when crypto %s', (_label, crypto) => {
    vi.stubGlobal('crypto', crypto)
    vi.spyOn(Date, 'now').mockReturnValue(1_760_000_000_000)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    const ids = Array.from({ length: 5 }, () => createAdventureRunId())

    for (const id of ids) {
      expect(id).toMatch(RUN_ID_PATTERN)
    }
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('Adventure run copies', () => {
  it('deep-copies known fields and drops unknown keys', () => {
    const run = beginAdventureEncounter(createAdventureRun(44, RUN_ID), 1)
    const tagged = run as unknown as Record<string, unknown>
    tagged.extra = 'top'
    ;(run.map as unknown as Record<string, unknown>).extra = 'map'
    ;(run.map.tiers[0] as unknown as Record<string, unknown>).extra = 'tier'
    ;(run.map.tiers[0].nodes[0] as unknown as Record<string, unknown>).extra = 'node'
    ;(run.map.tiers[0].nodes[0].opponent as unknown as Record<string, unknown>).extra = 'opponent'
    ;(run.map.tiers[0].nodes[0].opponent.deck[0] as unknown as Record<string, unknown>).extra = 'card'

    const copy = cloneAdventureRun(run)

    expect(JSON.stringify(copy)).not.toContain('extra')
    expect(copy).not.toBe(run)
    expect(copy.map).not.toBe(run.map)
    expect(copy.map.tiers).not.toBe(run.map.tiers)
    expect(copy.map.tiers[0]).not.toBe(run.map.tiers[0])
    expect(copy.map.tiers[0].nodes).not.toBe(run.map.tiers[0].nodes)
    expect(copy.map.tiers[0].nodes[0]).not.toBe(run.map.tiers[0].nodes[0])
    expect(copy.map.tiers[0].nodes[0].opponent).not.toBe(run.map.tiers[0].nodes[0].opponent)
    expect(copy.map.tiers[0].nodes[0].opponent.lands).not.toBe(run.map.tiers[0].nodes[0].opponent.lands)
    expect(copy.map.tiers[0].nodes[0].opponent.deck).not.toBe(run.map.tiers[0].nodes[0].opponent.deck)
    expect(copy.map.tiers[0].nodes[0].opponent.deck[0]).not.toBe(run.map.tiers[0].nodes[0].opponent.deck[0])
    expect(copy.completedNodeIds).not.toBe(run.completedNodeIds)
    expect(copy.relics).not.toBe(run.relics)
    expect(copy.rewardHistory).not.toBe(run.rewardHistory)
    expect(isAdventureRunState(copy)).toBe(true)
  })

  it('normalizes only valid runs into detached copies', () => {
    const run = createAdventureRun(45, RUN_ID)

    const normalized = normalizeAdventureRun(run)

    expect(normalized).toEqual(run)
    expect(normalized).not.toBe(run)
    expect(normalizeAdventureRun({ ...run, runId: 'not-a-run-id' })).toBeNull()
    expect(normalizeAdventureRun(null)).toBeNull()
    expect(normalizeAdventureRun([run])).toBeNull()
  })
})

describe('Adventure run changes', () => {
  it('begins the current encounter without changing its input', () => {
    const run = createAdventureRun(46, RUN_ID)
    const before = JSON.stringify(run)

    const begun = beginAdventureEncounter(run, 999)

    expect(JSON.stringify(run)).toBe(before)
    expect(begun).toMatchObject({
      status: 'active',
      stage: 'encounter',
      selectedNodeId: 'tier-1-center',
      attemptOrdinal: 0,
      attemptSeed: 46,
    })
    expect(currentAdventureNode(begun)).toBe(begun.map.tiers[0].nodes[0])
    expect(isAdventureRunState(begun)).toBe(true)
  })

  it('assigns the fallback seed only when the attempt has none', () => {
    const legacy = v1Run()
    legacy.activeGameSeed = null
    const run = migrated(legacy)

    expect(run.attemptSeed).toBeNull()
    expect(beginAdventureEncounter(run, 4321).attemptSeed).toBe(4321)
    expect(beginAdventureEncounter(migrated(), 4321).attemptSeed).toBe(v1Run().activeGameSeed)
  })

  it('keeps the selected node and attempt identity while pausing', () => {
    const begun = beginAdventureEncounter(createAdventureRun(47, RUN_ID), 1)

    const paused = pauseAdventureRun(begun)

    expect(paused).toEqual({ ...begun, status: 'paused' })
    expect(begun.status).toBe('active')
    expect(beginAdventureEncounter(paused, 5)).toEqual(begun)
  })

  it('advances to the next tier after a win', () => {
    const begun = beginAdventureEncounter(createAdventureRun(48, RUN_ID), 1)
    const before = JSON.stringify(begun)

    const next = applyAdventureEncounterResult(begun, 'win', 2222)

    expect(JSON.stringify(begun)).toBe(before)
    expect(next).toMatchObject({
      status: 'paused',
      stage: 'map',
      currentTierIndex: 1,
      completedNodeIds: ['tier-1-center'],
      selectedNodeId: null,
      attemptOrdinal: 0,
      attemptSeed: 2222,
      remainingChances: 3,
      scoreEligibleChances: 3,
      winStreak: 1,
      scoreEligibleWinStreak: 1,
      totalRoundsPlayed: 1,
    })
    expect(isAdventureRunState(next)).toBe(true)
  })

  it('awards a chance on every third consecutive win on both counters', () => {
    let run = encounterAt(2)
    expect(run.winStreak).toBe(2)

    run = applyAdventureEncounterResult(run, 'win', 3)

    expect(run.winStreak).toBe(3)
    expect(run.scoreEligibleWinStreak).toBe(3)
    expect(run.remainingChances).toBe(4)
    expect(run.scoreEligibleChances).toBe(4)
  })

  it('applies the chance bonus to the real and score-eligible streaks separately', () => {
    const run = beginAdventureEncounter(createAdventureRun(49, RUN_ID), 1)
    run.winStreak = 2
    run.scoreEligibleWinStreak = 0

    const next = applyAdventureEncounterResult(run, 'win', 3)

    expect(next.remainingChances).toBe(4)
    expect(next.scoreEligibleChances).toBe(3)
    expect(next.winStreak).toBe(3)
    expect(next.scoreEligibleWinStreak).toBe(1)
  })

  it('retries the same node with a new attempt after a loss', () => {
    const run = encounterAt(2)
    const before = JSON.stringify(run)

    const next = applyAdventureEncounterResult(run, 'loss', 3333)

    expect(JSON.stringify(run)).toBe(before)
    expect(next).toMatchObject({
      status: 'paused',
      stage: 'map',
      currentTierIndex: 2,
      completedNodeIds: ['tier-1-center', 'tier-2-center'],
      selectedNodeId: 'tier-3-center',
      attemptOrdinal: 1,
      attemptSeed: 3333,
      remainingChances: 2,
      scoreEligibleChances: 2,
      winStreak: 0,
      scoreEligibleWinStreak: 0,
      totalRoundsPlayed: 3,
    })
    const retried = beginAdventureEncounter(next, 1)
    expect(retried.selectedNodeId).toBe('tier-3-center')
    expect(retried.attemptOrdinal).toBe(1)
    expect(retried.attemptSeed).toBe(3333)
    expect(isAdventureRunState(next)).toBe(true)
  })

  it('never lowers chance counters below zero', () => {
    const run = beginAdventureEncounter(createAdventureRun(50, RUN_ID), 1)
    run.remainingChances = 2
    run.scoreEligibleChances = 0

    const next = applyAdventureEncounterResult(run, 'loss', 4)

    expect(next.remainingChances).toBe(1)
    expect(next.scoreEligibleChances).toBe(0)
    expect(next.status).toBe('paused')
  })

  it('fails the run when the last real chance is lost', () => {
    const run = encounterAt(1)
    run.remainingChances = 1
    run.scoreEligibleChances = 1

    const next = applyAdventureEncounterResult(run, 'loss', 5)

    expect(next).toMatchObject({
      status: 'failed',
      stage: null,
      currentTierIndex: 1,
      completedNodeIds: ['tier-1-center'],
      selectedNodeId: null,
      attemptSeed: null,
      remainingChances: 0,
      scoreEligibleChances: 0,
    })
    expect(isResumableAdventureRun(next)).toBe(false)
    expect(isAdventureRunState(next)).toBe(true)
    expect(() => beginAdventureEncounter(next, 1)).toThrow()
  })

  it('replays the same node with a new attempt after a draw', () => {
    const run = encounterAt(1)

    const next = applyAdventureEncounterResult(run, 'draw', 6666)

    expect(next).toMatchObject({
      status: 'paused',
      stage: 'map',
      currentTierIndex: 1,
      selectedNodeId: 'tier-2-center',
      attemptOrdinal: 1,
      attemptSeed: 6666,
      remainingChances: run.remainingChances,
      scoreEligibleChances: run.scoreEligibleChances,
      winStreak: run.winStreak,
      scoreEligibleWinStreak: run.scoreEligibleWinStreak,
      totalRoundsPlayed: run.totalRoundsPlayed + 1,
    })
  })

  it('completes the run after winning the final tier', () => {
    const run = encounterAt(6)

    const next = applyAdventureEncounterResult(run, 'win', 7)

    expect(next).toMatchObject({
      status: 'completed',
      stage: null,
      currentTierIndex: 6,
      selectedNodeId: null,
      attemptSeed: null,
      totalRoundsPlayed: 7,
    })
    expect(next.completedNodeIds).toEqual(
      Array.from({ length: 7 }, (_, tierIndex) => adventureNodeId(tierIndex, 'center')),
    )
    expect(isAdventureRunState(next)).toBe(true)
  })

  it('completes a migrated run whose final opponent is not a mono boss', () => {
    const legacy = v1Run()
    legacy.opponentLineup[6] = { ...legacy.opponentLineup[0], id: 'adventure-opponent-7-dual-final' }
    const run = encounterAt(6, migrated(legacy))

    const next = applyAdventureEncounterResult(run, 'win', 8)

    expect(next.status).toBe('completed')
    expect(next.map.tiers[6].nodes[0].opponent.kind).toBe('dual')
    expect(isAdventureRunState(next)).toBe(true)
  })

  it('only finishes active encounters', () => {
    const run = createAdventureRun(51, RUN_ID)
    const paused = pauseAdventureRun(beginAdventureEncounter(run, 1))

    expect(() => applyAdventureEncounterResult(run, 'win', 1)).toThrow()
    expect(() => applyAdventureEncounterResult(paused, 'win', 1)).toThrow()
  })
})

describe('version 1 Adventure migration', () => {
  it('converts the captured version 1 save field by field', () => {
    const legacy = v1Run()
    const before = JSON.stringify(legacy)

    const run = migrated(legacy)

    expect(JSON.stringify(legacy)).toBe(before)
    expect(legacy.currentOpponentIndex).toBe(2)
    expect(run).toEqual({
      schemaVersion: 2,
      runId: RUN_ID,
      baseSeed: legacy.baseSeed,
      status: legacy.status,
      stage: 'map',
      map: {
        kind: 'legacy-linear',
        tiers: legacy.opponentLineup.map((opponent, tierIndex) => ({
          nodes: [{ id: `tier-${tierIndex + 1}-center`, lane: 'center', opponent }],
        })),
      },
      currentTierIndex: legacy.currentOpponentIndex,
      completedNodeIds: ['tier-1-center', 'tier-2-center'],
      selectedNodeId: null,
      attemptOrdinal: 0,
      attemptSeed: legacy.activeGameSeed,
      remainingChances: legacy.remainingChances,
      scoreEligibleChances: legacy.remainingChances,
      winStreak: legacy.winStreak,
      scoreEligibleWinStreak: legacy.winStreak,
      totalRoundsPlayed: legacy.totalRoundsPlayed,
      totalCardsPlayed: legacy.totalCardsPlayed,
      relics: [],
      rewardHistory: [],
    })
    expect(run.map.tiers[0].nodes[0].opponent.deck).not.toBe(legacy.opponentLineup[0].deck)
    expect(computeAdventureScore(run)).toBe(
      legacy.remainingChances * 100 - legacy.totalCardsPlayed + legacy.totalRoundsPlayed * 5,
    )
    expect(isAdventureRunState(run)).toBe(true)
  })

  it('follows the opponent index when the version 1 round disagrees', () => {
    const legacy = v1Run()
    legacy.currentRound = 6
    legacy.currentOpponentIndex = 2

    const run = migrated(legacy)

    expect(run.currentTierIndex).toBe(2)
    expect(run.completedNodeIds).toEqual(['tier-1-center', 'tier-2-center'])
    expect(deckPairForAdventureGame(run, 1)[1]).toEqual(legacy.opponentLineup[2].deck)
  })

  it('accepts any known final opponent on legacy-linear maps only', () => {
    const legacy = v1Run()
    legacy.opponentLineup[6] = { ...legacy.opponentLineup[3], id: 'adventure-opponent-7-random' }

    const run = migrated(legacy)

    expect(run.map.kind).toBe('legacy-linear')
    expect(run.map.tiers[6].nodes[0].opponent.kind).toBe('random')
    expect(isAdventureRunState({ ...run, map: { ...run.map, kind: 'linear' } })).toBe(false)
  })

  it.each<[AdventureRunStatus, number, number]>([
    ['completed', 6, 7],
    ['failed', 3, 3],
  ])('converts a finished version 1 run (%s) to a finished run that cannot be resumed', (status, tierIndex, completedCount) => {
    const legacy = v1Run()
    legacy.status = status
    legacy.currentOpponentIndex = tierIndex === 6 ? 5 : tierIndex
    legacy.currentRound = legacy.currentOpponentIndex + 1

    const run = migrated(legacy)

    expect(run).toMatchObject({ status, stage: null, currentTierIndex: tierIndex, selectedNodeId: null, attemptSeed: null })
    expect(run.completedNodeIds).toHaveLength(completedCount)
    expect(isResumableAdventureRun(run)).toBe(false)
    expect(isAdventureRunState(run)).toBe(true)
  })

  it('converts every app-written version 1 progress shape into a valid run', () => {
    for (const seed of [0, 1, 99, 123_456_789, 1_760_000_000_000]) {
      const lineup = buildAdventureLineup(seed)
      for (let index = 0; index < 7; index += 1) {
        for (const status of ['active', 'paused'] as const) {
          for (const activeGameSeed of [seed, seed + index, null]) {
            const legacy: AdventureRunStateV1 = {
              baseSeed: seed,
              currentRound: index + 1,
              remainingChances: index % 4,
              winStreak: index,
              totalRoundsPlayed: index * 2,
              totalCardsPlayed: index * 7,
              currentOpponentIndex: index,
              activeGameSeed,
              status,
              opponentLineup: lineup,
            }
            expect(isLegacyAdventureRunState(legacy)).toBe(true)
            const run = migrateLegacyAdventureRun(legacy, RUN_ID)
            expect(run).not.toBeNull()
            expect(isAdventureRunState(run)).toBe(true)
            expect(beginAdventureEncounter(run!, 1).selectedNodeId).toBe(adventureNodeId(index, 'center'))
          }
        }
      }
    }
  })

  it.each<[string, (legacy: AdventureRunStateV1) => void]>([
    ['an empty opponent label', (legacy) => { legacy.opponentLineup[1].label = '' }],
    ['an oversized opponent label', (legacy) => { legacy.opponentLineup[1].label = 'x'.repeat(257) }],
    ['an empty opponent id', (legacy) => { legacy.opponentLineup[1].id = '' }],
    ['an oversized opponent id', (legacy) => { legacy.opponentLineup[1].id = 'x'.repeat(129) }],
    ['no opponent lands', (legacy) => { legacy.opponentLineup[1].lands = [] }],
    ['repeated opponent lands', (legacy) => { legacy.opponentLineup[1].lands = ['Forest', 'Forest'] }],
    ['duplicate card ids', (legacy) => { legacy.opponentLineup[1].deck[1].id = legacy.opponentLineup[1].deck[0].id }],
    ['an empty card id', (legacy) => { legacy.opponentLineup[1].deck[0].id = '' }],
    ['an oversized card id', (legacy) => { legacy.opponentLineup[1].deck[0].id = 'x'.repeat(129) }],
  ])('rejects hand-edited version 1 data with %s', (_label, edit) => {
    const legacy = v1Run()
    edit(legacy)

    expect(isLegacyAdventureRunState(legacy)).toBe(true)
    expect(migrateLegacyAdventureRun(legacy, RUN_ID)).toBeNull()
  })
})
