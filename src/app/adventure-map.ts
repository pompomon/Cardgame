// Adventure map data: opponent pools, decks, map shape and map validation.
//
// This is a leaf module. It imports only game cards and types and the shared
// validators, never `adventure.ts`, persistence, the controller, storage or
// the DOM. `adventure.ts` uses this module and re-exports the names other
// modules already import from it.

import { lcg, shuffle } from '../game/cards'
import { BASIC_LANDS, isBasicLand, type BasicLand, type Card } from '../game/types'
import { isIntegerInRange, isNonNegativeInteger, isRecordObject } from './validators'

export const ADVENTURE_TIER_COUNT = 7
export const ADVENTURE_NODE_ID_PATTERN = /^tier-[1-7]-(?:center|left|right)$/

const ADVENTURE_DECK_SIZE = 50
const ADVENTURE_MAX_ID_LENGTH = 128
const ADVENTURE_MAX_LABEL_LENGTH = 256

export type AdventureOpponentKind = 'standard' | 'dual' | 'mono' | 'random'
export type AdventureRunStatus = 'active' | 'paused' | 'completed' | 'failed'
/** Resumable runs are at `map` or `encounter`; finished runs have no stage. */
export type AdventureRunStage = 'map' | 'encounter'
/**
 * `linear` maps are generated for new runs: six non-boss tiers and a mono
 * boss. `legacy-linear` maps hold a migrated version 1 lineup verbatim, so
 * any known opponent kind may be the final tier. `branching` maps fork three
 * non-boss tiers into `[left, right]` (see `ADVENTURE_FORK_PATTERNS`) and
 * converge on a single mono boss.
 */
export type AdventureMapKind = 'linear' | 'legacy-linear' | 'branching'
export type AdventureNodeLane = 'center' | 'left' | 'right'

export interface AdventureOpponentDeck {
  id: string
  label: string
  kind: AdventureOpponentKind
  lands: BasicLand[]
  deck: Card[]
}

export interface AdventureMapNode {
  id: string
  lane: AdventureNodeLane
  opponent: AdventureOpponentDeck
}

export interface AdventureMapTier {
  nodes: AdventureMapNode[]
}

export interface AdventureMap {
  kind: AdventureMapKind
  tiers: AdventureMapTier[]
}

/** Opponent pools before any are picked: twelve non-boss decks and five mono bosses. */
export interface AdventureOpponentPools {
  nonBoss: AdventureOpponentDeck[]
  boss: AdventureOpponentDeck[]
}

/**
 * The run fields the route rules read. A full `AdventureRunState` fits this
 * shape, so callers can pass a run directly.
 */
export interface AdventureRouteState {
  readonly status: AdventureRunStatus
  readonly stage: AdventureRunStage | null
  readonly baseSeed: number
  readonly map: AdventureMap
  readonly currentTierIndex: number
  readonly completedNodeIds: readonly string[]
  readonly selectedNodeId: string | null
  readonly attemptOrdinal: number
  readonly attemptSeed: number | null
}

/**
 * Fork tiers of a branching map, as 0-based tier indexes: exactly three
 * forks, never adjacent and never on the boss tier. In 1-based tier numbers
 * these are {1,3,5}, {1,3,6}, {1,4,6} and {2,4,6}.
 */
export const ADVENTURE_FORK_PATTERNS: readonly (readonly number[])[] = Object.freeze([
  Object.freeze([0, 2, 4]),
  Object.freeze([0, 2, 5]),
  Object.freeze([0, 3, 5]),
  Object.freeze([1, 3, 5]),
])

const CENTER_LANES: readonly AdventureNodeLane[] = Object.freeze(['center'])
const FORK_LANES: readonly AdventureNodeLane[] = Object.freeze(['left', 'right'])

export function cloneAdventureDeck(deck: Card[]): Card[] {
  return deck.map((card) => ({ id: card.id, name: card.name, type: card.type }))
}

function buildDeckFromCounts(
  ownerKey: string,
  counts: Partial<Record<BasicLand, number>>,
  seed: number,
): Card[] {
  const cards: Card[] = []
  for (const land of BASIC_LANDS) {
    const amount = counts[land] ?? 0
    for (let index = 0; index < amount; index += 1) {
      cards.push({
        id: `${ownerKey}-${land.toLowerCase()}-${index}`,
        name: land,
        type: 'land',
      })
    }
  }
  return shuffle(cards, seed)
}

function createStandardDeck(ownerKey: string, seed: number): Card[] {
  const counts: Partial<Record<BasicLand, number>> = {}
  for (const land of BASIC_LANDS) {
    counts[land] = 10
  }
  return buildDeckFromCounts(ownerKey, counts, seed)
}

function createDualDeck(ownerKey: string, first: BasicLand, second: BasicLand, seed: number): Card[] {
  return buildDeckFromCounts(ownerKey, { [first]: 25, [second]: 25 }, seed)
}

function createMonoDeck(ownerKey: string, land: BasicLand, seed: number): Card[] {
  return buildDeckFromCounts(ownerKey, { [land]: 50 }, seed)
}

function createRandomDeck(ownerKey: string, seed: number): Card[] {
  const random = lcg(seed)
  const cards: Card[] = []
  for (let index = 0; index < 50; index += 1) {
    const land = BASIC_LANDS[Math.floor(random() * BASIC_LANDS.length)]
    cards.push({
      id: `${ownerKey}-${land.toLowerCase()}-${index}`,
      name: land,
      type: 'land',
    })
  }
  return shuffle(cards, seed + 17)
}

function dualLandPairs(): Array<[BasicLand, BasicLand]> {
  const pairs: Array<[BasicLand, BasicLand]> = []
  for (let i = 0; i < BASIC_LANDS.length; i += 1) {
    for (let j = i + 1; j < BASIC_LANDS.length; j += 1) {
      pairs.push([BASIC_LANDS[i], BASIC_LANDS[j]])
    }
  }
  return pairs
}

/**
 * Builds every opponent deck for `seed`. Card IDs are unique across both
 * pools, and pool IDs (`standard`, `dual-…`, `random`, `boss-…`) are unique.
 */
export function buildAdventureOpponentPools(seed: number): AdventureOpponentPools {
  const nonBoss: AdventureOpponentDeck[] = []
  nonBoss.push({
    id: 'standard',
    label: 'Standard Deck (10 of each land)',
    kind: 'standard',
    lands: [...BASIC_LANDS],
    deck: createStandardDeck('opp-standard', seed + 100),
  })

  const pairs = dualLandPairs()
  pairs.forEach((pair, index) => {
    nonBoss.push({
      id: `dual-${pair[0]}-${pair[1]}`,
      label: `Dual ${pair[0]}/${pair[1]} Deck`,
      kind: 'dual',
      lands: [pair[0], pair[1]],
      deck: createDualDeck(`opp-dual-${index}`, pair[0], pair[1], seed + 200 + index * 13),
    })
  })

  nonBoss.push({
    id: 'random',
    label: 'Fully Random Deck',
    kind: 'random',
    lands: [...BASIC_LANDS],
    deck: createRandomDeck('opp-random', seed + 600),
  })

  const boss: AdventureOpponentDeck[] = BASIC_LANDS.map((land, index) => ({
    id: `boss-${land}`,
    label: `Boss: Mono ${land} Deck`,
    kind: 'mono',
    lands: [land],
    deck: createMonoDeck(`opp-boss-${index}`, land, seed + 900 + index * 13),
  }))

  return { nonBoss, boss }
}

/** The version 1 lineup: six non-boss opponents, then a mono boss. */
export function buildAdventureLineup(seed: number): AdventureOpponentDeck[] {
  const pools = buildAdventureOpponentPools(seed)
  const chosenNonBoss = shuffle(pools.nonBoss, seed + 300).slice(0, 6)
  const chosenBoss = shuffle(pools.boss, seed + 301)[0]
  return [...chosenNonBoss, chosenBoss].map((entry, index) => ({
    ...entry,
    id: `adventure-opponent-${index + 1}-${entry.id}`,
    deck: cloneAdventureDeck(entry.deck),
  }))
}

export function adventureNodeId(tierIndex: number, lane: AdventureNodeLane): string {
  return `tier-${tierIndex + 1}-${lane}`
}

function cloneAdventureOpponent(opponent: AdventureOpponentDeck): AdventureOpponentDeck {
  return {
    id: opponent.id,
    label: opponent.label,
    kind: opponent.kind,
    lands: [...opponent.lands],
    deck: cloneAdventureDeck(opponent.deck),
  }
}

/** One centered tier per opponent, with detached opponent copies. */
export function linearAdventureTiers(opponents: AdventureOpponentDeck[]): AdventureMapTier[] {
  return opponents.map((opponent, tierIndex) => ({
    nodes: [{ id: adventureNodeId(tierIndex, 'center'), lane: 'center', opponent: cloneAdventureOpponent(opponent) }],
  }))
}

/** Deep copy of the known map fields; unknown keys are dropped. */
export function cloneAdventureMap(map: AdventureMap): AdventureMap {
  return {
    kind: map.kind,
    tiers: map.tiers.map((tier) => ({
      nodes: tier.nodes.map((node) => ({
        id: node.id,
        lane: node.lane,
        opponent: cloneAdventureOpponent(node.opponent),
      })),
    })),
  }
}

/** A basic land card with a string ID, the only card shape the game uses. */
export function isAdventureCard(value: unknown): value is Card {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const card = value as { id?: unknown; name?: unknown; type?: unknown }
  return typeof card.id === 'string' && isBasicLand(card.name) && card.type === 'land'
}

export function isAdventureRunStatus(value: unknown): value is AdventureRunStatus {
  return value === 'active' || value === 'paused' || value === 'completed' || value === 'failed'
}

/** Attempt ordinals are non-negative safe integers. */
export function isAdventureAttemptOrdinal(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isAdventureOpponent(value: unknown): value is AdventureOpponentDeck {
  if (!isRecordObject(value)) return false
  if (!isBoundedString(value.id, ADVENTURE_MAX_ID_LENGTH)) return false
  if (!isBoundedString(value.label, ADVENTURE_MAX_LABEL_LENGTH)) return false
  const kind = value.kind
  if (kind !== 'standard' && kind !== 'dual' && kind !== 'mono' && kind !== 'random') return false
  // Unique known lands, so at most five.
  const lands = value.lands
  if (!Array.isArray(lands) || lands.length === 0 || !lands.every((land) => isBasicLand(land))) return false
  if (new Set(lands).size !== lands.length) return false
  const deck = value.deck
  if (!Array.isArray(deck) || deck.length !== ADVENTURE_DECK_SIZE) return false
  const cardIds = new Set<string>()
  for (const card of deck) {
    if (!isAdventureCard(card) || !isBoundedString(card.id, ADVENTURE_MAX_ID_LENGTH) || cardIds.has(card.id)) return false
    cardIds.add(card.id)
  }
  return true
}

function isAdventureMapNode(
  value: unknown,
  tierIndex: number,
  lane: AdventureNodeLane,
  kind: AdventureMapKind,
): value is AdventureMapNode {
  if (!isRecordObject(value)) return false
  if (value.lane !== lane || value.id !== adventureNodeId(tierIndex, lane)) return false
  const opponent = value.opponent
  if (!isAdventureOpponent(opponent)) return false
  if (kind === 'legacy-linear') return true
  // Generated maps end with the mono boss and use no mono opponent before it.
  return (opponent.kind === 'mono') === (tierIndex === ADVENTURE_TIER_COUNT - 1)
}

function isAdventureForkPattern(forkTierIndexes: readonly number[]): boolean {
  return ADVENTURE_FORK_PATTERNS.some((pattern) => pattern.length === forkTierIndexes.length
    && pattern.every((tierIndex, index) => forkTierIndexes[index] === tierIndex))
}

/**
 * Strict map guard with rules per kind. Every kind has seven tiers, node IDs
 * recomputed from tier and lane, and valid opponents. `linear` and
 * `legacy-linear` maps hold one `center` node per tier. A `branching` map
 * holds `[center]` or `[left, right]` on tiers 1–6, forks on exactly one of
 * `ADVENTURE_FORK_PATTERNS`, ends with a single `center` mono boss, and never
 * repeats an opponent ID. Unknown kinds fail closed.
 */
export function isAdventureMap(value: unknown): value is AdventureMap {
  if (!isRecordObject(value)) return false
  const kind = value.kind
  if (kind !== 'linear' && kind !== 'legacy-linear' && kind !== 'branching') return false
  const tiers = value.tiers
  if (!Array.isArray(tiers) || tiers.length !== ADVENTURE_TIER_COUNT) return false
  const forkTierIndexes: number[] = []
  const opponentIds = new Set<string>()
  for (let tierIndex = 0; tierIndex < ADVENTURE_TIER_COUNT; tierIndex += 1) {
    const tier: unknown = tiers[tierIndex]
    if (!isRecordObject(tier) || !Array.isArray(tier.nodes)) return false
    const nodes: unknown[] = tier.nodes
    // Only the non-boss tiers of a branching map may fork.
    const fork = kind === 'branching' && tierIndex < ADVENTURE_TIER_COUNT - 1 && nodes.length === FORK_LANES.length
    const lanes = fork ? FORK_LANES : CENTER_LANES
    if (nodes.length !== lanes.length) return false
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      const node = nodes[laneIndex]
      if (!isAdventureMapNode(node, tierIndex, lanes[laneIndex], kind)) return false
      if (kind === 'branching') {
        if (opponentIds.has(node.opponent.id)) return false
        opponentIds.add(node.opponent.id)
      }
    }
    if (fork) forkTierIndexes.push(tierIndex)
  }
  return kind !== 'branching' || isAdventureForkPattern(forkTierIndexes)
}

function tierHasNode(map: AdventureMap, tierIndex: number, nodeId: unknown): boolean {
  return map.tiers[tierIndex].nodes.some((node) => node.id === nodeId)
}

/**
 * Strict guard for the route fields of a run, shared by the run guard and
 * the route rules. It checks the lifecycle, the map and route consistency:
 * the tier index is in range, completed tiers form a strict prefix with one
 * node from each tier, and a selected node belongs to the current tier. It
 * accepts every map kind; callers decide which kinds a run may use.
 */
export function isAdventureRouteState(value: unknown): value is AdventureRouteState {
  if (!isRecordObject(value)) return false
  if (!isNonNegativeInteger(value.baseSeed)) return false
  const status = value.status
  if (!isAdventureRunStatus(status)) return false
  const terminal = status === 'completed' || status === 'failed'
  const stage = value.stage
  if (terminal ? stage !== null : stage !== 'map' && stage !== 'encounter') return false
  const map = value.map
  if (!isAdventureMap(map)) return false
  const tierIndex = value.currentTierIndex
  if (!isIntegerInRange(tierIndex, 0, ADVENTURE_TIER_COUNT - 1)) return false
  if (status === 'completed' && tierIndex !== ADVENTURE_TIER_COUNT - 1) return false
  // Completed tiers form a strict prefix with one node from each tier.
  const completed = value.completedNodeIds
  const completedCount = status === 'completed' ? ADVENTURE_TIER_COUNT : tierIndex
  if (!Array.isArray(completed) || completed.length !== completedCount) return false
  if (!completed.every((nodeId, index) => tierHasNode(map, index, nodeId))) return false
  const selected = value.selectedNodeId
  if (selected === null) {
    if (stage === 'encounter') return false
  } else if (terminal || !tierHasNode(map, tierIndex, selected)) {
    return false
  }
  if (!isAdventureAttemptOrdinal(value.attemptOrdinal)) return false
  const attemptSeed = value.attemptSeed
  if (attemptSeed === null) {
    if (stage === 'encounter') return false
  } else if (terminal || !isNonNegativeInteger(attemptSeed)) {
    return false
  }
  return true
}
