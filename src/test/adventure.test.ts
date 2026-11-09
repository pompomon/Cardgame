import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createStarterDeck } from '../game/cards'
import { BASIC_LANDS } from '../game/types'
import {
  ADVENTURE_SCHEMA_VERSION,
  ADVENTURE_TIER_COUNT,
  adventureNodeId,
  adventureRouteNodes,
  applyAdventureEncounterResult,
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
  openAdventureMap,
  pauseAdventureRun,
  resumeAdventureEncounter,
  selectedAdventureNode,
  skipAdventureRunReward,
  startAdventureEncounter,
  type AdventureRunState,
  type AdventureRunStateV1,
  type AdventureRunStatus,
} from '../app/adventure'
import {
  adventureAttemptSeed,
  generateBranchingAdventureMap,
  isAdventureMap,
  isAdventureRouteState,
  linearAdventureTiers,
} from '../app/adventure-map'

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

/** Starts a node, by default the first node of the current tier (left at a fork). */
function started(run: AdventureRunState, nodeId = run.map.tiers[run.currentTierIndex].nodes[0].id): AdventureRunState {
  const next = startAdventureEncounter(run, nodeId)
  if (!next) throw new Error(`Expected ${nodeId} to start.`)
  return next
}

/** Wins the open encounter and skips the reward it earns, back at the map stage. */
function wonAndSkipped(run: AdventureRunState): AdventureRunState {
  const won = applyAdventureEncounterResult(run, 'win')
  if (won.pendingReward === null) return won
  const skipped = skipAdventureRunReward(won, won.pendingReward.offerId)
  if (!skipped) throw new Error('Expected the reward to be skipped.')
  return skipped
}

/** Wins the first node of each tier until the encounter on `tierIndex` is open. */
function encounterAt(tierIndex: number, run = createAdventureRun(500, RUN_ID)): AdventureRunState {
  let current = started(run)
  for (let tier = current.currentTierIndex; tier < tierIndex; tier += 1) {
    current = started(wonAndSkipped(current))
  }
  return current
}

/** A linear run as Milestone 2 wrote it, with the first attempt seed stored. */
function savedLinearRun(seed: number): AdventureRunState {
  return {
    ...createAdventureRun(seed, RUN_ID),
    map: { kind: 'linear', tiers: linearAdventureTiers(buildAdventureLineup(seed)) },
    attemptSeed: seed,
  }
}

function forkTiers(run: AdventureRunState): number[] {
  return run.map.tiers.flatMap((tier, tierIndex) => (tier.nodes.length === 2 ? [tierIndex] : []))
}

describe('schema version 2 Adventure runs', () => {
  it('creates new runs on the seeded branching map, open at the map stage without a seed', () => {
    const run = createAdventureRun(12345, RUN_ID)

    expect(run).toEqual({
      schemaVersion: ADVENTURE_SCHEMA_VERSION,
      runId: RUN_ID,
      baseSeed: 12345,
      status: 'active',
      stage: 'map',
      map: generateBranchingAdventureMap(12345),
      currentTierIndex: 0,
      completedNodeIds: [],
      selectedNodeId: null,
      attemptOrdinal: 0,
      attemptSeed: null,
      remainingChances: 3,
      scoreEligibleChances: 3,
      winStreak: 0,
      scoreEligibleWinStreak: 0,
      totalRoundsPlayed: 0,
      totalCardsPlayed: 0,
      relics: [],
      rewardHistory: [],
      pendingReward: null,
      encounterSetup: null,
    })
    expect(run.map.tiers).toHaveLength(ADVENTURE_TIER_COUNT)
    expect(isAdventureRunState(run)).toBe(true)
  })

  it('builds the same map for the same seed whatever the run ID', () => {
    const run = createAdventureRun(1_760_000_000_000, RUN_ID)
    const again = createAdventureRun(1_760_000_000_000, createAdventureRunId())

    expect(again.map).toEqual(run.map)
    expect(again.map).not.toBe(run.map)
    expect(again.map.tiers[0].nodes[0].opponent.deck).not.toBe(run.map.tiers[0].nodes[0].opponent.deck)
  })

  it('puts every new run on three forks that converge on one mono boss', () => {
    for (const seed of [0, 12345, 2 ** 32 + 1, 1_760_000_000_000]) {
      const run = createAdventureRun(seed, RUN_ID)

      expect(run.map.kind).toBe('branching')
      expect(run.map.tiers).toHaveLength(ADVENTURE_TIER_COUNT)
      expect(forkTiers(run)).toHaveLength(3)
      expect(run.map.tiers[ADVENTURE_TIER_COUNT - 1].nodes).toHaveLength(1)
      expect(run.map.tiers[ADVENTURE_TIER_COUNT - 1].nodes[0].opponent.kind).toBe('mono')
      expect(isAdventureRunState(run)).toBe(true)
    }
  })

  it('accepts branching runs and saved linear runs alike', () => {
    const seed = 1_760_000_000_000
    const runs = [
      createAdventureRun(seed, RUN_ID),
      started(createAdventureRun(seed, RUN_ID)),
      savedLinearRun(seed),
      started(savedLinearRun(seed)),
    ]

    for (const run of runs) {
      expect(isAdventureMap(run.map)).toBe(true)
      expect(isAdventureRouteState(run)).toBe(true)
      expect(isAdventureRunState(run)).toBe(true)
      expect(normalizeAdventureRun(run)).toEqual(run)
    }
  })

  it("launches the selected node's deck pair without sharing decks", () => {
    const created = createAdventureRun(321, RUN_ID)
    const fork = forkTiers(created)[0]
    const map = fork === 0 ? created : wonAndSkipped(encounterAt(fork - 1, created))

    for (const node of map.map.tiers[fork].nodes) {
      const chosen = started(map, node.id)
      const [playerDeck, opponentDeck] = deckPairForAdventureGame(chosen, 777)

      expect(selectedAdventureNode(chosen)?.id).toBe(node.id)
      expect(playerDeck).toEqual(createStarterDeck(0, 777))
      expect(opponentDeck).toEqual(node.opponent.deck)
      expect(opponentDeck).not.toBe(selectedAdventureNode(chosen)?.opponent.deck)
      expect(opponentDeck[0]).not.toBe(selectedAdventureNode(chosen)?.opponent.deck[0])
    }
  })

  it('refuses a deck pair when no node is selected instead of substituting an opponent', () => {
    const run = createAdventureRun(321, RUN_ID)
    const migratedRun = migrated()

    expect(selectedAdventureNode(run)).toBeNull()
    expect(selectedAdventureNode(migratedRun)).toBeNull()
    expect(() => deckPairForAdventureGame(run, 1)).toThrow()
    expect(() => deckPairForAdventureGame(migratedRun, 1)).toThrow()
  })

  it('creates the inactive baseline without a run', () => {
    expect(createInactiveAdventureState()).toEqual({
      run: null,
      highScore: 0,
      hasSavedRun: false,
      pendingCompletion: null,
      lastResult: null,
    })
    expect(createInactiveAdventureState(42, true)).toEqual({
      run: null,
      highScore: 42,
      hasSavedRun: true,
      pendingCompletion: null,
      lastResult: null,
    })
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
    const run = started(createAdventureRun(44, RUN_ID))
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
  it('starts a chosen node without changing its input', () => {
    const run = createAdventureRun(46, RUN_ID)
    const before = JSON.stringify(run)
    const nodes = run.map.tiers[0].nodes
    const node = nodes[nodes.length - 1]

    const begun = started(run, node.id)

    expect(JSON.stringify(run)).toBe(before)
    expect(begun).toMatchObject({
      status: 'active',
      stage: 'encounter',
      currentTierIndex: 0,
      selectedNodeId: node.id,
      attemptOrdinal: 0,
      attemptSeed: adventureAttemptSeed(46, 0, node.lane, 0),
    })
    expect(selectedAdventureNode(begun)).toBe(begun.map.tiers[0].nodes[nodes.length - 1])
    expect(currentAdventureNode(begun)).toBe(selectedAdventureNode(begun))
    expect(isAdventureRunState(begun)).toBe(true)
  })

  it('rejects unknown, future, non-string and repeated choices without changing the run', () => {
    const run = createAdventureRun(46, RUN_ID)
    const before = JSON.stringify(run)

    for (const nodeId of ['tier-9-center', 'tier-7-center', run.map.tiers[1].nodes[0].id, '', null, 7, {}, ['tier-1-left']]) {
      expect(startAdventureEncounter(run, nodeId)).toBeNull()
    }
    expect(JSON.stringify(run)).toBe(before)

    const begun = started(run)
    expect(startAdventureEncounter(begun, begun.selectedNodeId)).toBeNull()
    expect(startAdventureEncounter(pauseAdventureRun(begun), begun.selectedNodeId)).toBeNull()
  })

  it('keeps a stored seed and derives one only when the attempt has none', () => {
    const legacy = v1Run()
    legacy.activeGameSeed = null
    const run = migrated(legacy)
    const nodeId = adventureNodeId(run.currentTierIndex, 'center')

    expect(run.attemptSeed).toBeNull()
    expect(started(run, nodeId).attemptSeed).toBe(adventureAttemptSeed(run.baseSeed, run.currentTierIndex, 'center', 0))
    expect(started(migrated(), nodeId).attemptSeed).toBe(v1Run().activeGameSeed)
    expect(started(savedLinearRun(4321)).attemptSeed).toBe(4321)
  })

  it('keeps the selected node and attempt identity while pausing', () => {
    const begun = started(createAdventureRun(47, RUN_ID))

    const paused = pauseAdventureRun(begun)

    expect(paused).toEqual({ ...begun, status: 'paused' })
    expect(begun.status).toBe('active')
    expect(resumeAdventureEncounter(paused)).toEqual(begun)
    const map = openAdventureMap(paused)
    expect(map).toEqual({ ...begun, stage: 'map' })
    expect(started(map, begun.selectedNodeId!)).toEqual(begun)
  })

  it('opens the map and resumes encounters only for resumable runs at the right stage', () => {
    const run = createAdventureRun(47, RUN_ID)
    const failing = encounterAt(1)
    failing.remainingChances = 1
    const failed = applyAdventureEncounterResult(failing, 'loss')

    expect(openAdventureMap(pauseAdventureRun(run))).toEqual(run)
    expect(() => resumeAdventureEncounter(run)).toThrow()
    expect(() => resumeAdventureEncounter(pauseAdventureRun(run))).toThrow()
    expect(failed.status).toBe('failed')
    expect(() => openAdventureMap(failed)).toThrow()
    expect(() => resumeAdventureEncounter(failed)).toThrow()
    expect(() => pauseAdventureRun(failed)).toThrow()
  })

  it('advances to the next tier after a win and waits at the reward stage', () => {
    const begun = started(createAdventureRun(48, RUN_ID))
    const before = JSON.stringify(begun)

    const next = applyAdventureEncounterResult(begun, 'win')

    expect(JSON.stringify(begun)).toBe(before)
    expect(next).toMatchObject({
      status: 'active',
      stage: 'reward',
      currentTierIndex: 1,
      completedNodeIds: [begun.selectedNodeId],
      selectedNodeId: null,
      attemptOrdinal: 0,
      attemptSeed: null,
      remainingChances: 3,
      scoreEligibleChances: 3,
      winStreak: 1,
      scoreEligibleWinStreak: 1,
      totalRoundsPlayed: 1,
      encounterSetup: null,
      pendingReward: { sourceNodeId: begun.selectedNodeId, rewardOrdinal: 0 },
    })
    expect(next.pendingReward?.choices).toHaveLength(3)
    expect(isAdventureRunState(next)).toBe(true)
  })

  it('awards a chance on every third consecutive win on both counters', () => {
    let run = encounterAt(2)
    expect(run.winStreak).toBe(2)

    run = applyAdventureEncounterResult(run, 'win')

    expect(run.winStreak).toBe(3)
    expect(run.scoreEligibleWinStreak).toBe(3)
    expect(run.remainingChances).toBe(4)
    expect(run.scoreEligibleChances).toBe(4)
  })

  it('applies the chance bonus to the real and score-eligible streaks separately', () => {
    const run = started(createAdventureRun(49, RUN_ID))
    run.winStreak = 2
    run.scoreEligibleWinStreak = 0

    const next = applyAdventureEncounterResult(run, 'win')

    expect(next.remainingChances).toBe(4)
    expect(next.scoreEligibleChances).toBe(3)
    expect(next.winStreak).toBe(3)
    expect(next.scoreEligibleWinStreak).toBe(1)
  })

  it('retries the same node with a new attempt after a loss', () => {
    const run = encounterAt(2)
    const node = selectedAdventureNode(run)!
    const before = JSON.stringify(run)

    const next = applyAdventureEncounterResult(run, 'loss')

    expect(JSON.stringify(run)).toBe(before)
    expect(next).toMatchObject({
      status: 'active',
      stage: 'map',
      currentTierIndex: 2,
      completedNodeIds: run.completedNodeIds,
      selectedNodeId: node.id,
      attemptOrdinal: 1,
      attemptSeed: adventureAttemptSeed(500, 2, node.lane, 1),
      remainingChances: 2,
      scoreEligibleChances: 2,
      winStreak: 0,
      scoreEligibleWinStreak: 0,
      totalRoundsPlayed: 3,
    })
    const retried = started(next, node.id)
    expect(retried.selectedNodeId).toBe(node.id)
    expect(retried.attemptOrdinal).toBe(1)
    expect(retried.attemptSeed).toBe(next.attemptSeed)
    expect(retried.attemptSeed).not.toBe(run.attemptSeed)
    expect(isAdventureRunState(next)).toBe(true)
  })

  it.each(['loss', 'draw'] as const)('locks the committed fork node after a %s and rejects its sibling', (outcome) => {
    const created = createAdventureRun(500, RUN_ID)
    const fork = forkTiers(created)[0]
    const [left, right] = created.map.tiers[fork].nodes
    const run = encounterAt(fork, created)
    expect(run.selectedNodeId).toBe(left.id)

    const next = applyAdventureEncounterResult(run, outcome)

    expect(next.selectedNodeId).toBe(left.id)
    expect(adventureRouteNodes(next)[fork].map((node) => [node.id, node.status])).toEqual([
      [left.id, 'current'],
      [right.id, 'bypassed'],
    ])
    expect(startAdventureEncounter(next, right.id)).toBeNull()
    expect(startAdventureEncounter(pauseAdventureRun(next), right.id)).toBeNull()
    const retried = started(next, left.id)
    expect(retried.attemptOrdinal).toBe(1)
    expect(retried.attemptSeed).toBe(adventureAttemptSeed(500, fork, 'left', 1))
  })

  it('never lowers chance counters below zero', () => {
    const run = started(createAdventureRun(50, RUN_ID))
    run.remainingChances = 2
    run.scoreEligibleChances = 0

    const next = applyAdventureEncounterResult(run, 'loss')

    expect(next.remainingChances).toBe(1)
    expect(next.scoreEligibleChances).toBe(0)
    expect(next.status).toBe('active')
    expect(next.stage).toBe('map')
  })

  it('fails the run when the last real chance is lost', () => {
    const run = encounterAt(1)
    run.remainingChances = 1
    run.scoreEligibleChances = 1

    const next = applyAdventureEncounterResult(run, 'loss')

    expect(next).toMatchObject({
      status: 'failed',
      stage: null,
      currentTierIndex: 1,
      completedNodeIds: run.completedNodeIds,
      selectedNodeId: null,
      attemptSeed: null,
      remainingChances: 0,
      scoreEligibleChances: 0,
    })
    expect(isResumableAdventureRun(next)).toBe(false)
    expect(isAdventureRunState(next)).toBe(true)
    expect(run.completedNodeIds).toHaveLength(1)
    expect(startAdventureEncounter(next, run.selectedNodeId)).toBeNull()
    expect(adventureRouteNodes(next).flat().some((node) => node.status === 'current' || node.status === 'available')).toBe(false)
  })

  it('replays the same node with a new attempt after a draw', () => {
    const run = encounterAt(1)
    const node = selectedAdventureNode(run)!

    const next = applyAdventureEncounterResult(run, 'draw')

    expect(next).toMatchObject({
      status: 'active',
      stage: 'map',
      currentTierIndex: 1,
      completedNodeIds: run.completedNodeIds,
      selectedNodeId: node.id,
      attemptOrdinal: 1,
      attemptSeed: adventureAttemptSeed(500, 1, node.lane, 1),
      remainingChances: run.remainingChances,
      scoreEligibleChances: run.scoreEligibleChances,
      winStreak: run.winStreak,
      scoreEligibleWinStreak: run.scoreEligibleWinStreak,
      totalRoundsPlayed: run.totalRoundsPlayed + 1,
    })
  })

  it('completes the run after winning the final tier', () => {
    const run = encounterAt(6)

    const next = applyAdventureEncounterResult(run, 'win')

    expect(next).toMatchObject({
      status: 'completed',
      stage: null,
      currentTierIndex: 6,
      selectedNodeId: null,
      attemptOrdinal: 0,
      attemptSeed: null,
      totalRoundsPlayed: 7,
    })
    expect(next.completedNodeIds).toEqual(run.map.tiers.map((tier) => tier.nodes[0].id))
    expect(isAdventureRunState(next)).toBe(true)
  })

  it('completes every route through the forks at the shared boss', () => {
    const created = createAdventureRun(500, RUN_ID)
    const forks = forkTiers(created)
    const boss = created.map.tiers[ADVENTURE_TIER_COUNT - 1].nodes[0]
    const routes = new Set<string>()

    for (let route = 0; route < 2 ** forks.length; route += 1) {
      let run = created
      const chosen: string[] = []
      while (run.status !== 'completed') {
        const nodes = run.map.tiers[run.currentTierIndex].nodes
        const forkIndex = forks.indexOf(run.currentTierIndex)
        const node = forkIndex === -1 ? nodes[0] : nodes[(route >> forkIndex) & 1]
        chosen.push(node.id)
        run = wonAndSkipped(started(run, node.id))
        expect(isAdventureRunState(run)).toBe(true)
      }

      expect(run.completedNodeIds).toEqual(chosen)
      expect(chosen).toHaveLength(ADVENTURE_TIER_COUNT)
      expect(chosen[ADVENTURE_TIER_COUNT - 1]).toBe(boss.id)
      expect(adventureRouteNodes(run).flat().filter((node) => node.status === 'bypassed')).toHaveLength(forks.length)
      routes.add(chosen.join(','))
    }
    expect(routes.size).toBe(2 ** forks.length)
  })

  it('completes a migrated run whose final opponent is not a mono boss', () => {
    const legacy = v1Run()
    legacy.opponentLineup[6] = { ...legacy.opponentLineup[0], id: 'adventure-opponent-7-dual-final' }
    const run = encounterAt(6, migrated(legacy))

    const next = applyAdventureEncounterResult(run, 'win')

    expect(next.status).toBe('completed')
    expect(next.map.tiers[6].nodes[0].opponent.kind).toBe('dual')
    expect(isAdventureRunState(next)).toBe(true)
  })

  it('only finishes active encounters', () => {
    const run = createAdventureRun(51, RUN_ID)
    const paused = pauseAdventureRun(started(run))

    expect(() => applyAdventureEncounterResult(run, 'win')).toThrow()
    expect(() => applyAdventureEncounterResult(paused, 'win')).toThrow()
    expect(() => applyAdventureEncounterResult(openAdventureMap(paused), 'loss')).toThrow()
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
      pendingReward: null,
      encounterSetup: null,
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
    const begun = started(run)
    expect(begun.selectedNodeId).toBe('tier-3-center')
    expect(deckPairForAdventureGame(begun, 1)[1]).toEqual(legacy.opponentLineup[2].deck)
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
            expect(startAdventureEncounter(run!, adventureNodeId(index, 'center'))?.selectedNodeId)
              .toBe(adventureNodeId(index, 'center'))
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
