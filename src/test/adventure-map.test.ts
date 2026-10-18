import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStarterDeck } from '../game/cards'
import { BASIC_LANDS } from '../game/types'
import {
  beginAdventureEncounter,
  createAdventureRun,
  migrateLegacyAdventureRun,
  type AdventureRunState,
  type AdventureRunStateV1,
} from '../app/adventure'
import {
  ADVENTURE_FORK_PATTERNS,
  ADVENTURE_NODE_ID_PATTERN,
  ADVENTURE_SEED_PURPOSE,
  ADVENTURE_TIER_COUNT,
  adventureAttemptSeed,
  adventureNodeId,
  adventureRouteNodes,
  buildAdventureLineup,
  buildAdventureOpponentPools,
  completeAdventureNode,
  deriveAdventureSeed,
  generateBranchingAdventureMap,
  isAdventureMap,
  isAdventureRouteState,
  linearAdventureTiers,
  retryAdventureNode,
  selectAdventureNode,
  type AdventureMap,
  type AdventureMapNode,
  type AdventureNodeLane,
  type AdventureNodeStatus,
  type AdventureOpponentDeck,
  type AdventureRouteState,
} from '../app/adventure-map'

const RUN_ID = '0123456789abcdef0123456789abcdef'
const CLOCK_SEED = 1_760_000_000_000
const EDGE_SEEDS = [
  0,
  1,
  2 ** 31 - 1,
  2 ** 31,
  2 ** 31 + 1,
  2 ** 32 - 1,
  2 ** 32,
  2 ** 32 + 1,
  Number.MAX_SAFE_INTEGER,
  CLOCK_SEED,
]
const CONTIGUOUS_SEEDS = Array.from({ length: 96 }, (_, index) => 1_000 + index)
const CLOCK_LIKE_SEEDS = Array.from({ length: 96 }, (_, index) => CLOCK_SEED + index * 997)
const SEED_TABLE = [...EDGE_SEEDS, ...CONTIGUOUS_SEEDS, ...CLOCK_LIKE_SEEDS]

let seedTableMaps: Array<[number, AdventureMap]> | null = null

function tableMaps(): Array<[number, AdventureMap]> {
  seedTableMaps ??= SEED_TABLE.map((seed) => [seed, generateBranchingAdventureMap(seed)])
  return seedTableMaps
}

type V1FixtureName = 'closedMidRound' | 'pausedMidRound'

function v1Run(name: V1FixtureName = 'closedMidRound'): AdventureRunStateV1 {
  const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures', 'adventure-v1-saves.json'), 'utf8')) as Record<
    V1FixtureName,
    Record<string, string>
  >
  return JSON.parse(fixture[name]['cardgame.adventure-run']) as AdventureRunStateV1
}

function forkTierIndexes(map: AdventureMap): number[] {
  return map.tiers.flatMap((tier, tierIndex) => (tier.nodes.length === 2 ? [tierIndex] : []))
}

function mapNodes(map: AdventureMap): Array<{ tierIndex: number; node: AdventureMapNode }> {
  return map.tiers.flatMap((tier, tierIndex) => tier.nodes.map((node) => ({ tierIndex, node })))
}

function collectObjects(value: unknown, into = new Set<object>()): Set<object> {
  if (typeof value === 'object' && value !== null && !into.has(value)) {
    into.add(value)
    for (const child of Object.values(value)) {
      collectObjects(child, into)
    }
  }
  return into
}

function flipBit(value: number, bit: number): number {
  const mask = 2 ** bit
  return Math.floor(value / mask) % 2 === 1 ? value - mask : value + mask
}

function landCounts(opponent: AdventureOpponentDeck): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(BASIC_LANDS.map((land) => [land, 0]))
  for (const card of opponent.deck) {
    counts[card.name] += 1
  }
  return counts
}

function mapNode(tierIndex: number, lane: AdventureNodeLane, opponent: AdventureOpponentDeck): AdventureMapNode {
  return {
    id: adventureNodeId(tierIndex, lane),
    lane,
    opponent: { ...opponent, id: `adventure-opponent-${tierIndex + 1}-${opponent.id}` },
  }
}

/** A branching-kind map with forks on the given 0-based tiers, built from pool opponents. */
function branchingMapWithForks(forks: readonly number[]): AdventureMap {
  const pools = buildAdventureOpponentPools(7)
  let pick = 0
  const tiers = Array.from({ length: ADVENTURE_TIER_COUNT }, (_, tierIndex) => {
    const lanes: AdventureNodeLane[] = forks.includes(tierIndex) ? ['left', 'right'] : ['center']
    const boss = tierIndex === ADVENTURE_TIER_COUNT - 1
    return {
      nodes: lanes.map((lane, laneIndex) => {
        const opponent = boss ? pools.boss[laneIndex] : pools.nonBoss[pick]
        if (!boss) pick += 1
        return mapNode(tierIndex, lane, opponent)
      }),
    }
  })
  return { kind: 'branching', tiers }
}

function routeState(map: AdventureMap, overrides: Partial<AdventureRouteState> = {}): AdventureRouteState {
  return {
    status: 'active',
    stage: 'map',
    baseSeed: CLOCK_SEED,
    map,
    currentTierIndex: 0,
    completedNodeIds: [],
    selectedNodeId: null,
    attemptOrdinal: 0,
    attemptSeed: null,
    ...overrides,
  }
}

/** Selects a node and starts its encounter, as the run transitions will. */
function select(state: AdventureRouteState, nodeId: string): AdventureRouteState {
  const progress = selectAdventureNode(state, nodeId)
  if (progress === null) throw new Error(`Expected ${nodeId} to be selectable.`)
  return { ...state, ...progress, status: 'active', stage: 'encounter' }
}

function win(state: AdventureRouteState): AdventureRouteState {
  const { finished, ...progress } = completeAdventureNode(state)
  return finished
    ? { ...state, ...progress, status: 'completed', stage: null }
    : { ...state, ...progress, status: 'paused', stage: 'map' }
}

function lose(state: AdventureRouteState): AdventureRouteState {
  return { ...state, ...retryAdventureNode(state), status: 'paused', stage: 'map' }
}

/** Wins every tier before `tierIndex` on its first node. */
function routeAt(map: AdventureMap, tierIndex: number): AdventureRouteState {
  let state = routeState(map)
  while (state.currentTierIndex < tierIndex) {
    state = win(select(state, map.tiers[state.currentTierIndex].nodes[0].id))
  }
  return state
}

/** Wins every tier, taking the right lane at fork `n` when bit `n` of `choices` is set. */
function walkRoute(map: AdventureMap, choices: number): { state: AdventureRouteState; encounters: number } {
  let state = routeState(map)
  let encounters = 0
  let fork = 0
  while (state.status !== 'completed' && encounters <= ADVENTURE_TIER_COUNT) {
    const tierIndex = state.currentTierIndex
    let lane: AdventureNodeLane = 'center'
    if (map.tiers[tierIndex].nodes.length === 2) {
      lane = Math.floor(choices / 2 ** fork) % 2 === 1 ? 'right' : 'left'
      fork += 1
    }
    state = win(select(state, adventureNodeId(tierIndex, lane)))
    expect(isAdventureRouteState(state)).toBe(true)
    encounters += 1
  }
  return { state, encounters }
}

function statuses(state: AdventureRouteState): Record<string, AdventureNodeStatus> {
  return Object.fromEntries(adventureRouteNodes(state).flat().map((node) => [node.id, node.status]))
}

function statusCounts(state: AdventureRouteState): Partial<Record<AdventureNodeStatus, number>> {
  const counts: Partial<Record<AdventureNodeStatus, number>> = {}
  for (const status of Object.values(statuses(state))) {
    counts[status] = (counts[status] ?? 0) + 1
  }
  return counts
}

function progressOf(state: AdventureRouteState) {
  return {
    currentTierIndex: state.currentTierIndex,
    completedNodeIds: [...state.completedNodeIds],
    selectedNodeId: state.selectedNodeId,
    attemptOrdinal: state.attemptOrdinal,
    attemptSeed: state.attemptSeed,
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) {
      deepFreeze(child)
    }
  }
  return value
}

function migratedRun(legacy: AdventureRunStateV1): AdventureRunState {
  const run = migrateLegacyAdventureRun(legacy, RUN_ID)
  if (run === null) throw new Error('Expected the version 1 run to migrate.')
  return run
}

describe('Adventure seed derivation', () => {
  it('uses fixed numeric purpose tags, including one reserved for reward offers', () => {
    expect(ADVENTURE_SEED_PURPOSE).toEqual({
      forkPattern: 1,
      nonBossPick: 2,
      bossPick: 3,
      deckOrder: 4,
      attempt: 5,
      rewardOffer: 6,
    })
    expect(Object.isFrozen(ADVENTURE_SEED_PURPOSE)).toBe(true)
  })

  it('derives deterministic 32-bit unsigned seeds that differ by purpose', () => {
    const purposes = Object.values(ADVENTURE_SEED_PURPOSE)
    for (const seed of EDGE_SEEDS) {
      const derived = purposes.map((purpose) => deriveAdventureSeed(purpose, seed))
      for (const value of derived) {
        expect(Number.isInteger(value) && value >= 0 && value < 2 ** 32, `seed ${seed}`).toBe(true)
      }
      expect(new Set(derived).size, `seed ${seed}`).toBe(purposes.length)
      expect(purposes.map((purpose) => deriveAdventureSeed(purpose, seed))).toEqual(derived)
    }
  })

  it('counts every bit of a safe-integer base seed', () => {
    for (const seed of [0, CLOCK_SEED, Number.MAX_SAFE_INTEGER]) {
      const derived = deriveAdventureSeed(ADVENTURE_SEED_PURPOSE.nonBossPick, seed)
      for (let bit = 0; bit < 53; bit += 1) {
        const flipped = flipBit(seed, bit)
        expect(Number.isSafeInteger(flipped)).toBe(true)
        expect(deriveAdventureSeed(ADVENTURE_SEED_PURPOSE.nonBossPick, flipped), `seed ${seed} bit ${bit}`).not.toBe(derived)
      }
    }
  })

  it('rejects base seeds and words that are not unsigned integers', () => {
    for (const baseSeed of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => deriveAdventureSeed(ADVENTURE_SEED_PURPOSE.forkPattern, baseSeed)).toThrow(RangeError)
    }
    for (const word of [-1, 0.5, 2 ** 32, Number.NaN]) {
      expect(() => deriveAdventureSeed(ADVENTURE_SEED_PURPOSE.attempt, CLOCK_SEED, [word])).toThrow(RangeError)
    }
  })
})

describe('Adventure attempt seeds', () => {
  it('gives every attempt number on a node a different, repeatable seed', () => {
    const nodes: Array<[number, AdventureNodeLane]> = [[0, 'center'], [1, 'left'], [1, 'right'], [6, 'center']]
    for (const [tierIndex, lane] of nodes) {
      const ordinals = [...Array.from({ length: 2_048 }, (_, ordinal) => ordinal), 2 ** 31, 2 ** 32 - 1]
      const seeds = ordinals.map((ordinal) => adventureAttemptSeed(CLOCK_SEED, tierIndex, lane, ordinal))
      expect(new Set(seeds).size, `${adventureNodeId(tierIndex, lane)}`).toBe(ordinals.length)
      expect(ordinals.map((ordinal) => adventureAttemptSeed(CLOCK_SEED, tierIndex, lane, ordinal))).toEqual(seeds)
    }
  })

  it('separates tiers, lanes and base seeds', () => {
    const seeds = new Set<number>()
    for (let tierIndex = 0; tierIndex < ADVENTURE_TIER_COUNT; tierIndex += 1) {
      for (const lane of ['center', 'left', 'right'] as const) {
        seeds.add(adventureAttemptSeed(CLOCK_SEED, tierIndex, lane, 0))
      }
    }
    expect(seeds.size).toBe(ADVENTURE_TIER_COUNT * 3)
    expect(adventureAttemptSeed(CLOCK_SEED + 2 ** 32, 0, 'center', 0)).not.toBe(adventureAttemptSeed(CLOCK_SEED, 0, 'center', 0))
  })

  it('rejects unknown tiers, lanes and attempt numbers', () => {
    expect(() => adventureAttemptSeed(CLOCK_SEED, -1, 'center', 0)).toThrow(RangeError)
    expect(() => adventureAttemptSeed(CLOCK_SEED, ADVENTURE_TIER_COUNT, 'center', 0)).toThrow(RangeError)
    expect(() => adventureAttemptSeed(CLOCK_SEED, 0.5, 'center', 0)).toThrow(RangeError)
    expect(() => adventureAttemptSeed(CLOCK_SEED, 0, 'middle' as AdventureNodeLane, 0)).toThrow(RangeError)
    expect(() => adventureAttemptSeed(CLOCK_SEED, 0, 'center', -1)).toThrow(RangeError)
    expect(() => adventureAttemptSeed(CLOCK_SEED, 0, 'center', 2 ** 53)).toThrow(RangeError)
    expect(() => adventureAttemptSeed(-1, 0, 'center', 0)).toThrow(RangeError)
  })
})

describe('branching map generation', () => {
  it('returns the same map for the same seed, even with other seeds generated in between', () => {
    const first = JSON.stringify(generateBranchingAdventureMap(CLOCK_SEED))
    for (const seed of [0, 1, 2 ** 32, CLOCK_SEED + 1]) {
      generateBranchingAdventureMap(seed)
    }
    expect(JSON.stringify(generateBranchingAdventureMap(CLOCK_SEED))).toBe(first)
  })

  it('returns maps that share no objects', () => {
    const first = collectObjects(generateBranchingAdventureMap(CLOCK_SEED))
    const second = collectObjects(generateBranchingAdventureMap(CLOCK_SEED))

    expect([...first].filter((object) => second.has(object))).toEqual([])
  })

  it('matches the pinned derivation for a clock seed', () => {
    const map = generateBranchingAdventureMap(CLOCK_SEED)

    expect(forkTierIndexes(map).map((tierIndex) => tierIndex + 1)).toEqual([2, 4, 6])
    expect(Object.fromEntries(mapNodes(map).map(({ node }) => [node.id, node.opponent.id]))).toEqual({
      'tier-1-center': 'adventure-opponent-1-dual-Forest-Island',
      'tier-2-left': 'adventure-opponent-2-dual-Island-Swamp',
      'tier-2-right': 'adventure-opponent-2-dual-Forest-Swamp',
      'tier-3-center': 'adventure-opponent-3-dual-Mountain-Plains',
      'tier-4-left': 'adventure-opponent-4-dual-Mountain-Swamp',
      'tier-4-right': 'adventure-opponent-4-standard',
      'tier-5-center': 'adventure-opponent-5-dual-Forest-Plains',
      'tier-6-left': 'adventure-opponent-6-dual-Island-Plains',
      'tier-6-right': 'adventure-opponent-6-dual-Forest-Mountain',
      'tier-7-center': 'adventure-opponent-7-boss-Swamp',
    })
    expect(map.tiers[0].nodes[0].opponent.deck.slice(0, 3).map((card) => card.id)).toEqual([
      'opp-dual-0-forest-23',
      'opp-dual-0-island-19',
      'opp-dual-0-island-4',
    ])
    expect({
      'tier-1-center#0': adventureAttemptSeed(CLOCK_SEED, 0, 'center', 0),
      'tier-2-left#0': adventureAttemptSeed(CLOCK_SEED, 1, 'left', 0),
      'tier-2-right#0': adventureAttemptSeed(CLOCK_SEED, 1, 'right', 0),
      'tier-2-left#1': adventureAttemptSeed(CLOCK_SEED, 1, 'left', 1),
      'tier-7-center#0': adventureAttemptSeed(CLOCK_SEED, 6, 'center', 0),
    }).toEqual({
      'tier-1-center#0': 4105715502,
      'tier-2-left#0': 1821200878,
      'tier-2-right#0': 3453996723,
      'tier-2-left#1': 2506994686,
      'tier-7-center#0': 230274698,
    })
  })

  it('builds seven tiers, ten nodes, three non-adjacent forks and one final mono boss for every table seed', () => {
    for (const [seed, map] of tableMaps()) {
      const forks = forkTierIndexes(map)
      expect(map.kind).toBe('branching')
      expect(map.tiers, `seed ${seed}`).toHaveLength(ADVENTURE_TIER_COUNT)
      expect(mapNodes(map), `seed ${seed}`).toHaveLength(10)
      expect(ADVENTURE_FORK_PATTERNS, `seed ${seed}`).toContainEqual(forks)
      expect(forks.every((tierIndex, index) => index === 0 || tierIndex - forks[index - 1] > 1), `seed ${seed}`).toBe(true)
      for (const tierIndex of forks) {
        expect(map.tiers[tierIndex].nodes.map((node) => node.lane), `seed ${seed}`).toEqual(['left', 'right'])
      }
      expect(
        mapNodes(map).filter(({ node }) => node.opponent.kind === 'mono').map(({ node }) => node.id),
        `seed ${seed}`,
      ).toEqual(['tier-7-center'])
      expect(isAdventureMap(map), `seed ${seed}`).toBe(true)
    }
  })

  it('uses all four fork patterns across the seed table', () => {
    const patterns = new Set(tableMaps().map(([, map]) => forkTierIndexes(map).join(',')))

    expect([...patterns].sort()).toEqual(ADVENTURE_FORK_PATTERNS.map((pattern) => pattern.join(',')).sort())
  })

  it('produces different maps for seeds that differ only above bit 32', () => {
    for (const seed of [0, 1, 2 ** 31, 2 ** 32 - 1, CLOCK_SEED]) {
      const maps = [seed, seed + 2 ** 32, seed + 2 ** 40].map((value) => JSON.stringify(generateBranchingAdventureMap(value)))
      expect(new Set(maps).size, `seed ${seed}`).toBe(3)
    }
  })

  it('keeps node, opponent and card IDs unique and well formed', () => {
    const pools = buildAdventureOpponentPools(0)
    const poolIds = new Set([...pools.nonBoss, ...pools.boss].map((opponent) => opponent.id))
    const starterIds = new Set([...createStarterDeck(0, 1), ...createStarterDeck(1, 1)].map((card) => card.id))
    for (const [seed, map] of tableMaps()) {
      const nodes = mapNodes(map)
      expect(new Set(nodes.map(({ node }) => node.id)).size, `seed ${seed}`).toBe(nodes.length)
      expect(new Set(nodes.map(({ node }) => node.opponent.id)).size, `seed ${seed}`).toBe(nodes.length)
      for (const { tierIndex, node } of nodes) {
        expect(node.id).toBe(adventureNodeId(tierIndex, node.lane))
        expect(node.id).toMatch(ADVENTURE_NODE_ID_PATTERN)
        const prefix = `adventure-opponent-${tierIndex + 1}-`
        expect(node.opponent.id.startsWith(prefix), node.opponent.id).toBe(true)
        expect(poolIds.has(node.opponent.id.slice(prefix.length)), node.opponent.id).toBe(true)
        const cardIds = node.opponent.deck.map((card) => card.id)
        expect(new Set(cardIds).size, `seed ${seed} ${node.id}`).toBe(cardIds.length)
        expect(cardIds.filter((id) => starterIds.has(id)), `seed ${seed} ${node.id}`).toEqual([])
      }
    }
  })

  it('builds 50-card decks with the land mix of each opponent kind', () => {
    for (const [seed, map] of tableMaps()) {
      for (const { node } of mapNodes(map)) {
        const { opponent } = node
        const counts = landCounts(opponent)
        const used = BASIC_LANDS.filter((land) => counts[land] > 0)
        expect(opponent.deck, `seed ${seed} ${node.id}`).toHaveLength(50)
        expect(used.every((land) => opponent.lands.includes(land)), `seed ${seed} ${node.id}`).toBe(true)
        switch (opponent.kind) {
          case 'standard':
            expect(Object.values(counts)).toEqual([10, 10, 10, 10, 10])
            break
          case 'dual':
            expect(used).toHaveLength(2)
            expect(used.map((land) => counts[land])).toEqual([25, 25])
            break
          case 'mono':
            expect(used).toEqual(opponent.lands)
            expect(counts[used[0]]).toBe(50)
            break
          case 'random':
            expect(opponent.lands).toEqual([...BASIC_LANDS])
            break
          default:
            throw new Error(`Unexpected opponent kind ${String(opponent.kind)}`)
        }
      }
    }
  })
})

describe('Adventure map validation', () => {
  it('accepts every fork pattern', () => {
    for (const pattern of ADVENTURE_FORK_PATTERNS) {
      expect(isAdventureMap(branchingMapWithForks(pattern)), pattern.join(',')).toBe(true)
    }
  })

  it.each<[string, () => unknown]>([
    ['no forks', () => branchingMapWithForks([])],
    ['two forks', () => branchingMapWithForks([0, 3])],
    ['four forks', () => branchingMapWithForks([0, 2, 3, 5])],
    ['adjacent forks', () => branchingMapWithForks([0, 1, 3])],
    ['adjacent forks at the end', () => branchingMapWithForks([1, 4, 5])],
    ['a fork at tier 7', () => branchingMapWithForks([0, 2, 6])],
    ['three forks and a fork at tier 7', () => branchingMapWithForks([0, 2, 4, 6])],
  ])('rejects a branching map with %s', (_label, build) => {
    expect(isAdventureMap(build())).toBe(false)
  })

  it.each<[string, (map: AdventureMap) => void]>([
    ['right before left', (map) => { map.tiers[1].nodes.reverse() }],
    ['a center node in a fork tier', (map) => {
      map.tiers[1].nodes[0] = { ...map.tiers[1].nodes[0], id: 'tier-2-center', lane: 'center' }
    }],
    ['two left nodes in a fork tier', (map) => {
      map.tiers[1].nodes[1] = { ...map.tiers[1].nodes[1], id: 'tier-2-left', lane: 'left' }
    }],
    ['a lone side lane', (map) => {
      map.tiers[0].nodes[0] = { ...map.tiers[0].nodes[0], id: 'tier-1-left', lane: 'left' }
    }],
    ['three nodes in a tier', (map) => {
      map.tiers[1].nodes.push({ ...map.tiers[0].nodes[0], id: 'tier-2-center', lane: 'center' })
    }],
    ['an empty tier', (map) => { map.tiers[2].nodes = [] }],
    ['six tiers', (map) => { map.tiers.pop() }],
    ['eight tiers', (map) => { map.tiers.push(map.tiers[6]) }],
    ['a node ID for the sibling lane', (map) => { map.tiers[1].nodes[0].id = 'tier-2-right' }],
    ['a node ID from another tier', (map) => { map.tiers[1].nodes[0].id = 'tier-3-left' }],
    ['an uppercase node ID', (map) => { map.tiers[1].nodes[0].id = 'TIER-2-LEFT' }],
    ['an unknown lane', (map) => {
      ;(map.tiers[1].nodes[0] as unknown as Record<string, unknown>).lane = 'middle'
    }],
    ['a duplicate opponent across tiers', (map) => { map.tiers[2].nodes[0].opponent = map.tiers[0].nodes[0].opponent }],
    ['a duplicate opponent within a fork', (map) => { map.tiers[1].nodes[1].opponent = map.tiers[1].nodes[0].opponent }],
    ['a non-mono boss', (map) => {
      map.tiers[6].nodes[0].opponent = { ...map.tiers[0].nodes[0].opponent, id: 'adventure-opponent-7-standard' }
    }],
    ['a mono opponent before the boss', (map) => {
      map.tiers[2].nodes[0].opponent = { ...map.tiers[6].nodes[0].opponent, id: 'adventure-opponent-3-boss' }
    }],
    ['an invalid opponent deck', (map) => {
      map.tiers[1].nodes[0].opponent.deck = map.tiers[1].nodes[0].opponent.deck.slice(0, 49)
    }],
    ['an unknown map kind', (map) => { (map as unknown as Record<string, unknown>).kind = 'graph' }],
    ['a missing map kind', (map) => { delete (map as unknown as Record<string, unknown>).kind }],
  ])('rejects a branching map with %s', (_label, mutate) => {
    const map = branchingMapWithForks([1, 3, 5])
    expect(isAdventureMap(map)).toBe(true)

    mutate(map)

    expect(isAdventureMap(map)).toBe(false)
  })

  it('keeps the linear and legacy-linear rules unchanged', () => {
    const lineup = buildAdventureLineup(CLOCK_SEED)
    const linear = createAdventureRun(CLOCK_SEED, RUN_ID).map
    const nonMonoFinal = linearAdventureTiers([...lineup.slice(0, 6), lineup[0]])
    const repeated = linearAdventureTiers([lineup[0], ...lineup.slice(0, 6)].slice(0, 6).concat(lineup[6]))
    const forked = linearAdventureTiers(lineup)
    forked[2].nodes = [mapNode(2, 'left', lineup[2]), mapNode(2, 'right', lineup[3])]

    expect(isAdventureMap(linear)).toBe(true)
    expect(isAdventureMap({ kind: 'legacy-linear', tiers: linearAdventureTiers(v1Run().opponentLineup) })).toBe(true)
    expect(isAdventureMap({ kind: 'legacy-linear', tiers: nonMonoFinal })).toBe(true)
    expect(isAdventureMap({ kind: 'linear', tiers: nonMonoFinal })).toBe(false)
    // Repeated opponents stay allowed on linear kinds, as before.
    expect(isAdventureMap({ kind: 'linear', tiers: repeated })).toBe(true)
    expect(isAdventureMap({ kind: 'legacy-linear', tiers: repeated })).toBe(true)
    expect(isAdventureMap({ kind: 'linear', tiers: forked })).toBe(false)
    expect(isAdventureMap({ kind: 'legacy-linear', tiers: forked })).toBe(false)
    expect(isAdventureMap({ kind: 'branching', tiers: linear.tiers })).toBe(false)
  })
})

describe('Adventure route statuses', () => {
  const map = branchingMapWithForks([1, 3, 5])

  it('marks a single first node current, fork nodes available and later tiers locked', () => {
    expect(statuses(routeState(map))).toEqual({
      'tier-1-center': 'current',
      'tier-2-left': 'locked',
      'tier-2-right': 'locked',
      'tier-3-center': 'locked',
      'tier-4-left': 'locked',
      'tier-4-right': 'locked',
      'tier-5-center': 'locked',
      'tier-6-left': 'locked',
      'tier-6-right': 'locked',
      'tier-7-center': 'locked',
    })
    expect(statuses(routeState(branchingMapWithForks([0, 2, 4])))).toEqual({
      'tier-1-left': 'available',
      'tier-1-right': 'available',
      'tier-2-center': 'locked',
      'tier-3-left': 'locked',
      'tier-3-right': 'locked',
      'tier-4-center': 'locked',
      'tier-5-left': 'locked',
      'tier-5-right': 'locked',
      'tier-6-center': 'locked',
      'tier-7-center': 'locked',
    })
  })

  it('lists every node by tier and lane, flags only the final tier as the boss and holds no opponents', () => {
    const tiers = adventureRouteNodes(routeState(map))
    const nodes = tiers.flat()

    expect(tiers.map((tier) => tier.length)).toEqual(map.tiers.map((tier) => tier.nodes.length))
    expect(nodes.map(({ id, tierIndex, lane }) => [id, tierIndex, lane])).toEqual(
      mapNodes(map).map(({ tierIndex, node }) => [node.id, tierIndex, node.lane]),
    )
    expect(nodes.filter((node) => node.boss).map((node) => node.id)).toEqual(['tier-7-center'])
    for (const node of nodes) {
      expect(Object.keys(node).sort()).toEqual(['boss', 'id', 'lane', 'status', 'tierIndex'])
    }
    expect(JSON.stringify(tiers)).not.toMatch(/opponent|deck|label/)
  })

  it('commits a fork when a node is selected, retried or won', () => {
    const atFork = routeAt(map, 1)
    const chosen = select(atFork, 'tier-2-right')

    expect(statuses(atFork)).toMatchObject({
      'tier-1-center': 'completed',
      'tier-2-left': 'available',
      'tier-2-right': 'available',
      'tier-3-center': 'locked',
    })
    expect(statuses(chosen)).toMatchObject({ 'tier-2-left': 'bypassed', 'tier-2-right': 'current' })
    expect(statuses(lose(chosen))).toMatchObject({ 'tier-2-left': 'bypassed', 'tier-2-right': 'current' })
    expect(statuses(win(chosen))).toMatchObject({
      'tier-2-left': 'bypassed',
      'tier-2-right': 'completed',
      'tier-3-center': 'current',
      'tier-4-left': 'locked',
    })
  })

  it('leaves a completed run with seven completed and three bypassed nodes', () => {
    const { state } = walkRoute(map, 0b101)

    expect(statusCounts(state)).toEqual({ completed: 7, bypassed: 3 })
  })

  it('gives a failed run no actionable nodes', () => {
    const failed: AdventureRouteState = { ...routeAt(map, 1), status: 'failed', stage: null }

    expect(isAdventureRouteState(failed)).toBe(true)
    expect(statuses(failed)).toEqual({
      'tier-1-center': 'completed',
      'tier-2-left': 'locked',
      'tier-2-right': 'locked',
      'tier-3-center': 'locked',
      'tier-4-left': 'locked',
      'tier-4-right': 'locked',
      'tier-5-center': 'locked',
      'tier-6-left': 'locked',
      'tier-6-right': 'locked',
      'tier-7-center': 'locked',
    })
    for (const { node } of mapNodes(map)) {
      expect(selectAdventureNode(failed, node.id)).toBeNull()
    }
  })

  it('throws for an invalid route state', () => {
    const state = routeState(map)

    expect(() => adventureRouteNodes({ ...state, currentTierIndex: 7 })).toThrow()
    expect(() => adventureRouteNodes({ ...state, selectedNodeId: 'tier-3-center' })).toThrow()
    expect(() => adventureRouteNodes({ ...state, map: { ...map, kind: 'graph' } as unknown as AdventureMap })).toThrow()
  })
})

describe('Adventure routes', () => {
  it('walks all eight choice combinations in exactly seven encounters to the boss', () => {
    const maps = [...ADVENTURE_FORK_PATTERNS.map((pattern) => branchingMapWithForks(pattern)), generateBranchingAdventureMap(CLOCK_SEED)]
    for (const map of maps) {
      const paths = new Set<string>()
      for (let choices = 0; choices < 8; choices += 1) {
        const { state, encounters } = walkRoute(map, choices)

        expect(encounters).toBe(ADVENTURE_TIER_COUNT)
        expect(state.status).toBe('completed')
        expect(state.completedNodeIds).toHaveLength(ADVENTURE_TIER_COUNT)
        expect(state.completedNodeIds[ADVENTURE_TIER_COUNT - 1]).toBe('tier-7-center')
        expect(statusCounts(state)).toEqual({ completed: 7, bypassed: 3 })
        paths.add(state.completedNodeIds.join(' > '))
      }
      expect(paths.size).toBe(8)
    }
  })

  it('returns fresh results without changing or sharing the input', () => {
    const map = generateBranchingAdventureMap(CLOCK_SEED)
    const atFork = deepFreeze(routeAt(map, 1))
    const atForkJson = JSON.stringify(atFork)
    const selected = selectAdventureNode(atFork, 'tier-2-left')
    const encounter = deepFreeze(select(atFork, 'tier-2-left'))
    const encounterJson = JSON.stringify(encounter)
    const results = [selected, retryAdventureNode(encounter), completeAdventureNode(encounter), adventureRouteNodes(encounter)]

    expect(JSON.stringify(atFork)).toBe(atForkJson)
    expect(JSON.stringify(encounter)).toBe(encounterJson)
    const inputs = new Set([...collectObjects(atFork), ...collectObjects(encounter)])
    for (const result of results) {
      expect([...collectObjects(result)].filter((object) => inputs.has(object))).toEqual([])
    }
  })
})

describe('Adventure node selection', () => {
  const map = branchingMapWithForks([1, 3, 5])
  const atFork = routeAt(map, 1)
  const midRun = deepFreeze(win(select(atFork, 'tier-2-left')))

  it('selects the current node or either fork node and derives a seed only when none is stored', () => {
    expect(selectAdventureNode(routeState(map), 'tier-1-center')).toEqual({
      currentTierIndex: 0,
      completedNodeIds: [],
      selectedNodeId: 'tier-1-center',
      attemptOrdinal: 0,
      attemptSeed: adventureAttemptSeed(CLOCK_SEED, 0, 'center', 0),
    })
    expect(selectAdventureNode(atFork, 'tier-2-left')).toEqual({
      currentTierIndex: 1,
      completedNodeIds: ['tier-1-center'],
      selectedNodeId: 'tier-2-left',
      attemptOrdinal: 0,
      attemptSeed: adventureAttemptSeed(CLOCK_SEED, 1, 'left', 0),
    })
    expect(selectAdventureNode(atFork, 'tier-2-right')?.attemptSeed).toBe(adventureAttemptSeed(CLOCK_SEED, 1, 'right', 0))
    expect(selectAdventureNode({ ...atFork, status: 'active', attemptOrdinal: 3, attemptSeed: 42 }, 'tier-2-right')).toEqual({
      currentTierIndex: 1,
      completedNodeIds: ['tier-1-center'],
      selectedNodeId: 'tier-2-right',
      attemptOrdinal: 3,
      attemptSeed: 42,
    })
    expect(selectAdventureNode(midRun, 'tier-3-center')?.selectedNodeId).toBe('tier-3-center')
  })

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['null', null],
    ['a number', 3],
    ['NaN', Number.NaN],
    ['a boolean', true],
    ['an object', {}],
    ['an array holding the ID', ['tier-3-center']],
    ['a String object', new String('tier-3-center')],
    ['an object whose toString returns the ID', { toString: () => 'tier-3-center' }],
    ['a symbol', Symbol('tier-3-center')],
    ['an empty string', ''],
    ['an unknown ID', 'tier-3'],
    ['a tier past the boss', 'tier-8-center'],
    ['tier zero', 'tier-0-center'],
    ['an opponent ID', midRun.map.tiers[2].nodes[0].opponent.id],
    ['an uppercase ID', 'TIER-3-CENTER'],
    ['a mixed-case ID', 'Tier-3-Center'],
    ['a leading space', ' tier-3-center'],
    ['a trailing space', 'tier-3-center '],
    ['a trailing newline', 'tier-3-center\n'],
    ['a zero-width space', 'tier-3-center\u200b'],
    ['__proto__', '__proto__'],
    ['constructor', 'constructor'],
    ['prototype', 'prototype'],
    ['toString', 'toString'],
    ['hasOwnProperty', 'hasOwnProperty'],
    ['valueOf', 'valueOf'],
    ['a left lane missing from the current tier', 'tier-3-left'],
    ['a right lane missing from the current tier', 'tier-3-right'],
    ['the bypassed sibling', 'tier-2-right'],
    ['the completed fork node', 'tier-2-left'],
    ['the first completed node', 'tier-1-center'],
    ['a future fork node', 'tier-4-left'],
    ['a future center node', 'tier-5-center'],
    ['the boss early', 'tier-7-center'],
  ])('rejects %s without changing the run', (_label, nodeId) => {
    const before = JSON.stringify(midRun)

    expect(selectAdventureNode(midRun, nodeId)).toBeNull()
    expect(JSON.stringify(midRun)).toBe(before)
  })

  it('rejects every node on finished runs and at the encounter stage', () => {
    const encounter = select(atFork, 'tier-2-left')
    const states: Array<[string, AdventureRouteState]> = [
      ['a completed run', walkRoute(map, 0).state],
      ['a failed run', { ...atFork, status: 'failed', stage: null }],
      ['an active encounter', encounter],
      ['a paused encounter', { ...encounter, status: 'paused' }],
    ]
    for (const [label, state] of states) {
      deepFreeze(state)
      const before = JSON.stringify(state)
      expect(isAdventureRouteState(state), label).toBe(true)
      for (const { node } of mapNodes(map)) {
        expect(selectAdventureNode(state, node.id), `${label} ${node.id}`).toBeNull()
      }
      expect(JSON.stringify(state), label).toBe(before)
    }
  })

  it('rejects invalid route states without throwing', () => {
    for (const state of [
      null,
      undefined,
      {},
      { ...atFork, currentTierIndex: 9 },
      { ...atFork, completedNodeIds: [] },
      { ...atFork, selectedNodeId: 'tier-3-center' },
      { ...atFork, baseSeed: -1 },
      { ...atFork, map: { ...map, kind: 'graph' } },
    ]) {
      expect(selectAdventureNode(state as unknown as AdventureRouteState, 'tier-2-left')).toBeNull()
    }
  })

  it('keeps a node locked in for retry, with its attempt number and seed, and rejects its sibling', () => {
    const retrying = deepFreeze(lose(select(atFork, 'tier-2-left')))
    const before = JSON.stringify(retrying)

    expect(retrying.attemptSeed).toBe(adventureAttemptSeed(CLOCK_SEED, 1, 'left', 1))
    expect(selectAdventureNode(retrying, 'tier-2-right')).toBeNull()
    expect(selectAdventureNode(retrying, 'tier-2-left')).toEqual({
      currentTierIndex: 1,
      completedNodeIds: ['tier-1-center'],
      selectedNodeId: 'tier-2-left',
      attemptOrdinal: 1,
      attemptSeed: retrying.attemptSeed,
    })
    expect(JSON.stringify(retrying)).toBe(before)
  })
})

describe('Adventure retries and completion', () => {
  const map = branchingMapWithForks([1, 3, 5])
  const atFork = routeAt(map, 1)

  it('retries the same node with the next attempt number and its derived seed only', () => {
    expect(retryAdventureNode(select(atFork, 'tier-2-left'))).toEqual({
      currentTierIndex: 1,
      completedNodeIds: ['tier-1-center'],
      selectedNodeId: 'tier-2-left',
      attemptOrdinal: 1,
      attemptSeed: adventureAttemptSeed(CLOCK_SEED, 1, 'left', 1),
    })
  })

  it('gives every retry on a node a distinct seed', () => {
    let state = select(atFork, 'tier-2-right')
    const seeds = new Set([state.attemptSeed])
    for (let attempt = 1; attempt <= 200; attempt += 1) {
      state = select(lose(state), 'tier-2-right')
      expect(state.attemptOrdinal).toBe(attempt)
      expect(state.selectedNodeId).toBe('tier-2-right')
      seeds.add(state.attemptSeed)
    }

    expect(seeds.size).toBe(201)
  })

  it('caps the attempt number like Milestone 1', () => {
    const capped = { ...select(atFork, 'tier-2-left'), attemptOrdinal: Number.MAX_SAFE_INTEGER }

    expect(retryAdventureNode(capped)).toMatchObject({
      attemptOrdinal: Number.MAX_SAFE_INTEGER,
      attemptSeed: adventureAttemptSeed(CLOCK_SEED, 1, 'left', Number.MAX_SAFE_INTEGER),
    })
  })

  it('completes a node by clearing the selection, attempt number and seed', () => {
    const encounter = { ...select(atFork, 'tier-2-left'), attemptOrdinal: 4, attemptSeed: 99 }

    expect(completeAdventureNode(encounter)).toEqual({
      currentTierIndex: 2,
      completedNodeIds: ['tier-1-center', 'tier-2-left'],
      selectedNodeId: null,
      attemptOrdinal: 0,
      attemptSeed: null,
      finished: false,
    })
  })

  it('reports a finished route after the boss tier and stays on it', () => {
    const atBoss = select(routeAt(map, ADVENTURE_TIER_COUNT - 1), 'tier-7-center')

    expect(completeAdventureNode(atBoss)).toEqual({
      currentTierIndex: ADVENTURE_TIER_COUNT - 1,
      completedNodeIds: [...atBoss.completedNodeIds, 'tier-7-center'],
      selectedNodeId: null,
      attemptOrdinal: 0,
      attemptSeed: null,
      finished: true,
    })
  })

  it('throws when the state is not an active encounter', () => {
    const encounter = select(atFork, 'tier-2-left')
    for (const state of [
      atFork,
      lose(encounter),
      { ...encounter, status: 'paused' },
      walkRoute(map, 0).state,
      { ...atFork, status: 'failed', stage: null },
      { ...encounter, currentTierIndex: 3 },
      { ...encounter, map: { ...map, kind: 'graph' } },
      null,
    ]) {
      expect(() => retryAdventureNode(state as AdventureRouteState)).toThrow('Only an active Adventure encounter')
      expect(() => completeAdventureNode(state as AdventureRouteState)).toThrow('Only an active Adventure encounter')
    }
  })
})

describe('linear and legacy-linear routes', () => {
  it('derives statuses and selection on a new linear run like beginAdventureEncounter', () => {
    const run = deepFreeze(createAdventureRun(CLOCK_SEED, RUN_ID))
    const begun = beginAdventureEncounter(run, 1)

    expect(statuses(run)).toEqual(Object.fromEntries(
      Array.from({ length: ADVENTURE_TIER_COUNT }, (_, tierIndex) => [
        adventureNodeId(tierIndex, 'center'),
        tierIndex === 0 ? 'current' : 'locked',
      ]),
    ))
    expect(selectAdventureNode(run, 'tier-1-center')).toEqual(progressOf(begun))
    expect(begun.attemptSeed).toBe(CLOCK_SEED)
    expect(selectAdventureNode(run, 'tier-1-left')).toBeNull()
    expect(selectAdventureNode(run, 'tier-2-center')).toBeNull()
    expect(retryAdventureNode(begun)).toEqual({
      ...progressOf(begun),
      attemptOrdinal: 1,
      attemptSeed: adventureAttemptSeed(CLOCK_SEED, 0, 'center', 1),
    })
    expect(completeAdventureNode(begun)).toEqual({
      currentTierIndex: 1,
      completedNodeIds: ['tier-1-center'],
      selectedNodeId: null,
      attemptOrdinal: 0,
      attemptSeed: null,
      finished: false,
    })
    const { state, encounters } = walkRoute(run.map, 0)
    expect(encounters).toBe(ADVENTURE_TIER_COUNT)
    expect(statusCounts(state)).toEqual({ completed: 7 })
  })

  it.each(['closedMidRound', 'pausedMidRound'] as const)('derives statuses and selection on the %s version 1 conversion', (name) => {
    const run = deepFreeze(migratedRun(v1Run(name)))
    const begun = beginAdventureEncounter(run, 1)
    const unseeded = migratedRun({ ...v1Run(name), activeGameSeed: null })

    expect(run.map.kind).toBe('legacy-linear')
    expect(statuses(run)).toEqual({
      'tier-1-center': 'completed',
      'tier-2-center': 'completed',
      'tier-3-center': 'current',
      'tier-4-center': 'locked',
      'tier-5-center': 'locked',
      'tier-6-center': 'locked',
      'tier-7-center': 'locked',
    })
    expect(selectAdventureNode(run, 'tier-3-center')).toEqual(progressOf(begun))
    expect(begun.attemptSeed).toBe(1_760_000_420_000)
    expect(selectAdventureNode(run, 'tier-2-center')).toBeNull()
    expect(selectAdventureNode(run, 'tier-4-center')).toBeNull()
    // Without a stored seed, selection derives one instead of reading the clock.
    expect(selectAdventureNode(unseeded, 'tier-3-center')?.attemptSeed).toBe(
      adventureAttemptSeed(CLOCK_SEED, 2, 'center', 0),
    )
  })
})

describe('adventure map module boundary', () => {
  const source = readFileSync(resolve(__dirname, '..', 'app', 'adventure-map.ts'), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it('imports only game cards, game types and the shared validators', () => {
    const specifiers = [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map((match) => match[1])

    expect(new Set(specifiers)).toEqual(new Set(['../game/cards', '../game/types', './validators']))
  })

  it('reads no randomness, clock, storage, DOM or string hashes', () => {
    for (const forbidden of [
      /\bMath\.random\b/,
      /\bDate\b/,
      /\bperformance\b/,
      /\bcrypto\b/,
      /\blocalStorage\b/,
      /\bdocument\b/,
      /\bwindow\b/,
      /\.charCodeAt\b/,
      /\.codePointAt\b/,
    ]) {
      expect(code).not.toMatch(forbidden)
    }
  })
})
