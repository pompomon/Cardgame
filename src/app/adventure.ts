import { createStarterDeck } from '../game/cards'
import { isBasicLand, type Card, type GameState } from '../game/types'
import {
  ADVENTURE_NODE_ID_PATTERN,
  ADVENTURE_TIER_COUNT,
  buildAdventureLineup,
  cloneAdventureDeck,
  cloneAdventureMap,
  isAdventureCard,
  isAdventureMap,
  linearAdventureTiers,
  type AdventureMap,
  type AdventureMapNode,
  type AdventureOpponentDeck,
  type AdventureRunStage,
  type AdventureRunStatus,
} from './adventure-map'
import { sanitizeLogEvents } from './game-recording'
import {
  isFiniteInteger as validatorsIsFiniteInteger,
  isIntegerInRange,
  isNonNegativeInteger as validatorsIsNonNegativeInteger,
  isRecordObject,
} from './validators'
import {
  readStorageItem,
  removeStorageItem,
  writeStorageItem,
  writeJsonStorageItem,
} from './safe-storage'
import type { AdventureState } from './types'

export { ADVENTURE_TIER_COUNT, adventureNodeId, buildAdventureLineup } from './adventure-map'
export type {
  AdventureMap,
  AdventureMapKind,
  AdventureMapNode,
  AdventureMapTier,
  AdventureNodeLane,
  AdventureOpponentDeck,
  AdventureOpponentKind,
  AdventureRunStage,
  AdventureRunStatus,
} from './adventure-map'

export const ADVENTURE_HIGH_SCORE_STORAGE_KEY = 'cardgame.adventure-high-score'
export const ADVENTURE_GAME_STORAGE_KEY = 'cardgame.adventure-game'

/** Schema version of the persisted run and of the mid-game snapshot envelope. */
export const ADVENTURE_SCHEMA_VERSION = 2

const ADVENTURE_STARTING_CHANCES = 3
const ADVENTURE_RUN_ID_PATTERN = /^[0-9a-f]{32}$/

export type AdventureEncounterOutcome = 'win' | 'loss' | 'draw'

/**
 * Unversioned run written before schema version 2. It is only read and
 * migrated in memory; the app never writes this shape.
 */
export interface AdventureRunStateV1 {
  baseSeed: number
  currentRound: number
  remainingChances: number
  winStreak: number
  totalRoundsPlayed: number
  totalCardsPlayed: number
  currentOpponentIndex: number
  activeGameSeed: number | null
  status: AdventureRunStatus
  opponentLineup: AdventureOpponentDeck[]
}

export interface AdventureRunState {
  schemaVersion: typeof ADVENTURE_SCHEMA_VERSION
  runId: string
  baseSeed: number
  status: AdventureRunStatus
  stage: AdventureRunStage | null
  map: AdventureMap
  currentTierIndex: number
  completedNodeIds: string[]
  selectedNodeId: string | null
  attemptOrdinal: number
  attemptSeed: number | null
  remainingChances: number
  scoreEligibleChances: number
  winStreak: number
  scoreEligibleWinStreak: number
  totalRoundsPlayed: number
  totalCardsPlayed: number
  // Reserved for rewards and relics; always empty in schema version 2 runs
  // written by this milestone.
  relics: []
  rewardHistory: []
}

/** Identity-bound mid-game save stored under `ADVENTURE_GAME_STORAGE_KEY`. */
export interface AdventureGameSnapshotEnvelope {
  schemaVersion: typeof ADVENTURE_SCHEMA_VERSION
  runId: string
  nodeId: string
  attemptOrdinal: number
  attemptSeed: number
  game: GameState
}

export type StoredAdventureGameSnapshot =
  | { kind: 'none' }
  | { kind: 'envelope'; envelope: AdventureGameSnapshotEnvelope }
  | { kind: 'legacy' }
  | { kind: 'invalid' }

let fallbackRunIdCounter = 0

function fallbackAdventureRunId(): string {
  fallbackRunIdCounter = (fallbackRunIdCounter + 1) % 0x100000000
  const now = Date.now()
  const clock = Number.isFinite(now) && now > 0 ? Math.floor(now) % 0x1000000000000 : 0
  let random = ''
  while (random.length < 12) {
    random += Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  }
  return `${clock.toString(16).padStart(12, '0')}${fallbackRunIdCounter.toString(16).padStart(8, '0')}${random.slice(0, 12)}`
}

/**
 * Creates a random run ID of 32 lowercase hexadecimal characters. It uses
 * `crypto.getRandomValues`, which (unlike `crypto.randomUUID`) also exists on
 * insecure LAN origins. The fallback mixes a counter, the clock and
 * `Math.random`, so IDs still differ when the clock is frozen. Run IDs are
 * never derived from a seed.
 */
export function createAdventureRunId(): string {
  try {
    const bytes = new Uint8Array(16)
    globalThis.crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    return fallbackAdventureRunId()
  }
}

export function isAdventureRunId(value: unknown): value is string {
  return typeof value === 'string' && ADVENTURE_RUN_ID_PATTERN.test(value)
}

function checkedAdventureRun(run: AdventureRunState): AdventureRunState {
  if (!isAdventureRunState(run)) {
    throw new Error('Adventure run change produced an invalid run.')
  }
  return run
}

/**
 * Creates a schema version 2 run on a `linear` map. For the same seed, the
 * opponents, decks and first encounter seed match the version 1 run.
 */
export function createAdventureRun(seed: number, runId: string): AdventureRunState {
  return checkedAdventureRun({
    schemaVersion: ADVENTURE_SCHEMA_VERSION,
    runId,
    baseSeed: seed,
    status: 'active',
    stage: 'map',
    map: { kind: 'linear', tiers: linearAdventureTiers(buildAdventureLineup(seed)) },
    currentTierIndex: 0,
    completedNodeIds: [],
    selectedNodeId: null,
    attemptOrdinal: 0,
    attemptSeed: seed,
    remainingChances: ADVENTURE_STARTING_CHANCES,
    scoreEligibleChances: ADVENTURE_STARTING_CHANCES,
    winStreak: 0,
    scoreEligibleWinStreak: 0,
    totalRoundsPlayed: 0,
    totalCardsPlayed: 0,
    relics: [],
    rewardHistory: [],
  })
}

/** Inactive baseline shared by the controller constructor, refresh and reset paths. */
export function createInactiveAdventureState(highScore = 0, hasSavedRun = false): AdventureState {
  return { run: null, highScore, hasSavedRun }
}

export function isResumableAdventureRun(run: AdventureRunState): boolean {
  return run.status === 'active' || run.status === 'paused'
}

/** The selected node, or the current tier's only node before selection. */
export function currentAdventureNode(run: AdventureRunState): AdventureMapNode | null {
  const nodes = run.map.tiers[run.currentTierIndex]?.nodes ?? []
  if (run.selectedNodeId !== null) {
    return nodes.find((node) => node.id === run.selectedNodeId) ?? null
  }
  return nodes.length === 1 ? nodes[0] : null
}

export function deckPairForAdventureGame(run: AdventureRunState, seed: number): [Card[], Card[]] {
  const node = currentAdventureNode(run)
  const playerDeck = createStarterDeck(0, seed)
  const opponentDeck = node ? cloneAdventureDeck(node.opponent.deck) : createStarterDeck(1, seed + 1)
  return [playerDeck, opponentDeck]
}

/**
 * Legacy score formula. It reads the score-eligible chances, which equal the
 * real chances until rewards can add chances that must not raise the score.
 */
export function computeAdventureScore(run: AdventureRunState): number {
  return run.scoreEligibleChances * 100 - run.totalCardsPlayed + run.totalRoundsPlayed * 5
}

function isLegacyAdventureOpponentDeck(value: unknown): value is AdventureOpponentDeck {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const entry = value as {
    id?: unknown
    label?: unknown
    kind?: unknown
    lands?: unknown
    deck?: unknown
  }
  return typeof entry.id === 'string'
    && typeof entry.label === 'string'
    && (entry.kind === 'standard' || entry.kind === 'dual' || entry.kind === 'mono' || entry.kind === 'random')
    && Array.isArray(entry.lands)
    && entry.lands.every((land) => isBasicLand(land))
    && Array.isArray(entry.deck)
    && entry.deck.length === 50
    && entry.deck.every((card) => isAdventureCard(card))
}

function isAdventureRunStatus(value: unknown): value is AdventureRunStatus {
  return value === 'active' || value === 'paused' || value === 'completed' || value === 'failed'
}

function isFiniteInteger(value: unknown): value is number {
  return validatorsIsFiniteInteger(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return validatorsIsNonNegativeInteger(value)
}

/** Strict guard for the unversioned version 1 run; run before migration. */
export function isLegacyAdventureRunState(value: unknown): value is AdventureRunStateV1 {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const run = value as {
    baseSeed?: unknown
    currentRound?: unknown
    remainingChances?: unknown
    winStreak?: unknown
    totalRoundsPlayed?: unknown
    totalCardsPlayed?: unknown
    currentOpponentIndex?: unknown
    activeGameSeed?: unknown
    status?: unknown
    opponentLineup?: unknown
  }
  if (!isNonNegativeInteger(run.baseSeed)) return false
  if (!isFiniteInteger(run.currentRound) || run.currentRound < 1 || run.currentRound > 7) return false
  if (!isFiniteInteger(run.remainingChances) || run.remainingChances < 0) return false
  if (!isFiniteInteger(run.winStreak) || run.winStreak < 0) return false
  if (!isFiniteInteger(run.totalRoundsPlayed) || run.totalRoundsPlayed < 0) return false
  if (!isFiniteInteger(run.totalCardsPlayed) || run.totalCardsPlayed < 0) return false
  if (!isFiniteInteger(run.currentOpponentIndex) || run.currentOpponentIndex < 0 || run.currentOpponentIndex > 6) return false
  if (run.activeGameSeed !== null && !isNonNegativeInteger(run.activeGameSeed)) return false
  if (!isAdventureRunStatus(run.status)) return false
  if (!Array.isArray(run.opponentLineup) || run.opponentLineup.length !== 7) return false
  return run.opponentLineup.every((entry) => isLegacyAdventureOpponentDeck(entry))
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0
}

function tierHasNode(map: AdventureMap, tierIndex: number, nodeId: unknown): boolean {
  return map.tiers[tierIndex].nodes.some((node) => node.id === nodeId)
}

const ADVENTURE_COUNTER_KEYS = [
  'remainingChances',
  'scoreEligibleChances',
  'winStreak',
  'scoreEligibleWinStreak',
  'totalRoundsPlayed',
  'totalCardsPlayed',
] as const

/** Strict guard for schema version 2 runs. Unknown versions fail closed. */
export function isAdventureRunState(value: unknown): value is AdventureRunState {
  if (!isRecordObject(value)) return false
  if (value.schemaVersion !== ADVENTURE_SCHEMA_VERSION) return false
  if (!isAdventureRunId(value.runId)) return false
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
  if (!isNonNegativeSafeInteger(value.attemptOrdinal)) return false
  const attemptSeed = value.attemptSeed
  if (attemptSeed === null) {
    if (stage === 'encounter') return false
  } else if (terminal || !isNonNegativeInteger(attemptSeed)) {
    return false
  }
  if (!ADVENTURE_COUNTER_KEYS.every((key) => isNonNegativeInteger(value[key]))) return false
  return isEmptyArray(value.relics) && isEmptyArray(value.rewardHistory)
}

/** Deep copy of the known schema version 2 fields; unknown keys are dropped. */
export function cloneAdventureRun(run: AdventureRunState): AdventureRunState {
  return {
    schemaVersion: ADVENTURE_SCHEMA_VERSION,
    runId: run.runId,
    baseSeed: run.baseSeed,
    status: run.status,
    stage: run.stage,
    map: cloneAdventureMap(run.map),
    currentTierIndex: run.currentTierIndex,
    completedNodeIds: [...run.completedNodeIds],
    selectedNodeId: run.selectedNodeId,
    attemptOrdinal: run.attemptOrdinal,
    attemptSeed: run.attemptSeed,
    remainingChances: run.remainingChances,
    scoreEligibleChances: run.scoreEligibleChances,
    winStreak: run.winStreak,
    scoreEligibleWinStreak: run.scoreEligibleWinStreak,
    totalRoundsPlayed: run.totalRoundsPlayed,
    totalCardsPlayed: run.totalCardsPlayed,
    relics: [],
    rewardHistory: [],
  }
}

/** Validates an untrusted value and returns a detached copy, or null. */
export function normalizeAdventureRun(value: unknown): AdventureRunState | null {
  return isAdventureRunState(value) ? cloneAdventureRun(value) : null
}

/**
 * Converts a validated version 1 run to schema version 2 in memory. The seven
 * stored opponents become a `legacy-linear` map verbatim. The current tier
 * follows `currentOpponentIndex`, which chose the opponent deck, so a
 * contradictory `currentRound` is ignored. Returns null when hand-edited data
 * breaks a version 2 limit that app-written version 1 runs always meet.
 */
export function migrateLegacyAdventureRun(legacy: AdventureRunStateV1, runId: string): AdventureRunState | null {
  const completedRun = legacy.status === 'completed'
  const terminal = completedRun || legacy.status === 'failed'
  const tierIndex = completedRun ? ADVENTURE_TIER_COUNT - 1 : legacy.currentOpponentIndex
  const tiers = linearAdventureTiers(legacy.opponentLineup)
  const completedCount = completedRun ? ADVENTURE_TIER_COUNT : tierIndex
  return normalizeAdventureRun({
    schemaVersion: ADVENTURE_SCHEMA_VERSION,
    runId,
    baseSeed: legacy.baseSeed,
    status: legacy.status,
    stage: terminal ? null : 'map',
    map: { kind: 'legacy-linear', tiers },
    currentTierIndex: tierIndex,
    completedNodeIds: tiers.slice(0, completedCount).map((tier) => tier.nodes[0].id),
    selectedNodeId: null,
    attemptOrdinal: 0,
    attemptSeed: terminal ? null : legacy.activeGameSeed,
    remainingChances: legacy.remainingChances,
    scoreEligibleChances: legacy.remainingChances,
    winStreak: legacy.winStreak,
    scoreEligibleWinStreak: legacy.winStreak,
    totalRoundsPlayed: legacy.totalRoundsPlayed,
    totalCardsPlayed: legacy.totalCardsPlayed,
    relics: [],
    rewardHistory: [],
  })
}

/**
 * Starts or continues the current tier's encounter. Selects the tier's node
 * (kept through retries), keeps the attempt seed or assigns `fallbackSeed`,
 * and marks the run active at the `encounter` stage.
 */
export function beginAdventureEncounter(run: AdventureRunState, fallbackSeed: number): AdventureRunState {
  const node = isResumableAdventureRun(run) ? currentAdventureNode(run) : null
  if (!node) {
    throw new Error('This Adventure run has no encounter to start.')
  }
  const next = cloneAdventureRun(run)
  next.selectedNodeId = node.id
  next.attemptSeed = run.attemptSeed ?? fallbackSeed
  next.stage = 'encounter'
  next.status = 'active'
  return checkedAdventureRun(next)
}

/** Marks a resumable run paused, keeping its stage and attempt identity. */
export function pauseAdventureRun(run: AdventureRunState): AdventureRunState {
  if (!isResumableAdventureRun(run)) {
    throw new Error('Only a resumable Adventure run can be paused.')
  }
  const next = cloneAdventureRun(run)
  next.status = 'paused'
  return checkedAdventureRun(next)
}

/**
 * Applies a finished encounter. A win records the node, then advances to the
 * next tier or completes the run on the last tier. A loss costs a chance and
 * fails the run when none remain. Otherwise the same node is retried with a
 * new attempt number and `nextSeed`. Real and score-eligible counters change
 * separately.
 */
export function applyAdventureEncounterResult(
  run: AdventureRunState,
  outcome: AdventureEncounterOutcome,
  nextSeed: number,
): AdventureRunState {
  const nodeId = run.selectedNodeId
  if (run.status !== 'active' || run.stage !== 'encounter' || nodeId === null) {
    throw new Error('Only an active Adventure encounter can finish.')
  }
  const next = cloneAdventureRun(run)
  next.totalRoundsPlayed += 1
  if (outcome === 'win') {
    next.winStreak += 1
    if (next.winStreak % 3 === 0) {
      next.remainingChances += 1
    }
    next.scoreEligibleWinStreak += 1
    if (next.scoreEligibleWinStreak % 3 === 0) {
      next.scoreEligibleChances += 1
    }
    next.completedNodeIds.push(nodeId)
    next.selectedNodeId = null
    if (next.currentTierIndex >= ADVENTURE_TIER_COUNT - 1) {
      next.status = 'completed'
      next.stage = null
      next.attemptSeed = null
      return checkedAdventureRun(next)
    }
    next.currentTierIndex += 1
    next.attemptOrdinal = 0
  } else {
    if (outcome === 'loss') {
      next.remainingChances = Math.max(0, next.remainingChances - 1)
      next.scoreEligibleChances = Math.max(0, next.scoreEligibleChances - 1)
      next.winStreak = 0
      next.scoreEligibleWinStreak = 0
      if (next.remainingChances <= 0) {
        next.status = 'failed'
        next.stage = null
        next.selectedNodeId = null
        next.attemptSeed = null
        return checkedAdventureRun(next)
      }
    }
    next.attemptOrdinal = Math.min(next.attemptOrdinal + 1, Number.MAX_SAFE_INTEGER)
  }
  next.attemptSeed = nextSeed
  next.stage = 'map'
  next.status = 'paused'
  return checkedAdventureRun(next)
}

export function readStoredAdventureHighScore(): number {
  const raw = readStorageItem(ADVENTURE_HIGH_SCORE_STORAGE_KEY)
  if (raw === null) {
    return 0
  }
  const value = Number(raw)
  return Number.isFinite(value) ? value : 0
}

export function persistAdventureHighScore(score: number): void {
  writeStorageItem(ADVENTURE_HIGH_SCORE_STORAGE_KEY, String(score))
}

/**
 * Writes the identity-bound mid-game save for the run's current attempt.
 * Returns false (without writing) unless the run is at the `encounter` stage.
 */
export function persistAdventureGameSnapshot(run: AdventureRunState, game: GameState): boolean {
  if (run.stage !== 'encounter' || run.selectedNodeId === null || run.attemptSeed === null) {
    return false
  }
  const envelope: AdventureGameSnapshotEnvelope = {
    schemaVersion: ADVENTURE_SCHEMA_VERSION,
    runId: run.runId,
    nodeId: run.selectedNodeId,
    attemptOrdinal: run.attemptOrdinal,
    attemptSeed: run.attemptSeed,
    game,
  }
  return writeJsonStorageItem(ADVENTURE_GAME_STORAGE_KEY, envelope)
}

/** Best-effort removal; identity matching, not deletion, prevents stale restores. */
export function clearStoredAdventureGameSnapshot(): boolean {
  return removeStorageItem(ADVENTURE_GAME_STORAGE_KEY)
}

/** True only when all four identity fields equal the run's current attempt. */
export function isAdventureGameSnapshotForRun(
  envelope: AdventureGameSnapshotEnvelope,
  run: AdventureRunState,
): boolean {
  return envelope.runId === run.runId
    && envelope.nodeId === run.selectedNodeId
    && envelope.attemptOrdinal === run.attemptOrdinal
    && envelope.attemptSeed === run.attemptSeed
}

function isBattlefieldCard(value: unknown): value is { instanceId: string; card: Card } {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const entry = value as { instanceId?: unknown; card?: unknown }
  return typeof entry.instanceId === 'string' && isAdventureCard(entry.card)
}

function isPlayerStateSnapshot(value: unknown, expectedId: 0 | 1): boolean {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const player = value as {
    id?: unknown
    deck?: unknown
    hand?: unknown
    battlefield?: unknown
    graveyard?: unknown
    landsPlayedThisTurn?: unknown
  }
  return player.id === expectedId
    && Array.isArray(player.deck) && player.deck.every((entry) => isAdventureCard(entry))
    && Array.isArray(player.hand) && player.hand.every((entry) => isAdventureCard(entry))
    && Array.isArray(player.battlefield) && player.battlefield.every((entry) => isBattlefieldCard(entry))
    && Array.isArray(player.graveyard) && player.graveyard.every((entry) => isAdventureCard(entry))
    && isNonNegativeInteger(player.landsPlayedThisTurn)
    && (player.landsPlayedThisTurn === 0 || player.landsPlayedThisTurn === 1)
}

function isPendingLandPlaySnapshot(value: unknown): boolean {
  if (value === null) return true
  if (typeof value !== 'object') return false
  const pending = value as { actor?: unknown; card?: unknown; effectTargetId?: unknown }
  if (pending.actor !== 0 && pending.actor !== 1) return false
  if (!isAdventureCard(pending.card)) return false
  if (pending.effectTargetId !== undefined && typeof pending.effectTargetId !== 'string') return false
  return true
}

function isPendingPlainsReuseSnapshot(value: unknown): boolean {
  if (value === null) return true
  if (typeof value !== 'object') return false
  const pending = value as { actor?: unknown; reusedInstanceId?: unknown; reusedCardName?: unknown }
  if (pending.actor !== 0 && pending.actor !== 1) return false
  if (typeof pending.reusedInstanceId !== 'string') return false
  if (!isBasicLand(pending.reusedCardName) || pending.reusedCardName === 'Plains') return false
  return true
}

function isPendingSwampDiscardSnapshot(value: unknown): boolean {
  if (value === undefined) return true
  if (value === null) return true
  if (typeof value !== 'object') return false
  const pending = value as { actor?: unknown }
  return pending.actor === 0 || pending.actor === 1
}

function isGameStateSnapshot(value: unknown): value is GameState {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as {
    players?: unknown
    turn?: unknown
    currentPlayer?: unknown
    nextInstanceId?: unknown
    phase?: unknown
    pendingLandPlay?: unknown
    pendingPlainsReuse?: unknown
    pendingSwampDiscard?: unknown
    winner?: unknown
    log?: unknown
  }
  if (!Array.isArray(candidate.players) || candidate.players.length !== 2) return false
  if (!isPlayerStateSnapshot(candidate.players[0], 0)) return false
  if (!isPlayerStateSnapshot(candidate.players[1], 1)) return false
  if (!Number.isInteger(candidate.turn) || (candidate.turn as number) < 1) return false
  if (candidate.currentPlayer !== 0 && candidate.currentPlayer !== 1) return false
  if (!Number.isInteger(candidate.nextInstanceId) || (candidate.nextInstanceId as number) < 1) return false
  if (candidate.phase !== 'main' && candidate.phase !== 'respond' && candidate.phase !== 'plains_target' && candidate.phase !== 'swamp_target' && candidate.phase !== 'gameOver') return false
  if (!isPendingLandPlaySnapshot(candidate.pendingLandPlay)) return false
  if (candidate.phase === 'plains_target') {
    if (candidate.pendingPlainsReuse === null) return false
  } else if (candidate.pendingPlainsReuse !== null) {
    return false
  }
  if (!isPendingPlainsReuseSnapshot(candidate.pendingPlainsReuse)) return false
  if (candidate.phase === 'swamp_target') {
    if (candidate.pendingSwampDiscard === null || candidate.pendingSwampDiscard === undefined) return false
  } else if (candidate.pendingSwampDiscard !== null && candidate.pendingSwampDiscard !== undefined) {
    return false
  }
  if (!isPendingSwampDiscardSnapshot(candidate.pendingSwampDiscard)) return false
  if (candidate.winner !== null && candidate.winner !== 'draw' && candidate.winner !== 0 && candidate.winner !== 1) return false
  if (!Array.isArray(candidate.log) || !candidate.log.every((entry) => typeof entry === 'string')) return false
  return true
}

function normalizeGameSnapshot(value: unknown): GameState | null {
  if (!isGameStateSnapshot(value)) {
    return null
  }
  // Back-fill / sanitize `events` for snapshots persisted before LogEvent
  // existed and for any user-edited localStorage payload. Use the same
  // shape-check + cap as the recording loader so malformed/huge events
  // arrays can't reach the renderers and crash `formatLogEventTile` or
  // freeze the visual log on iteration. Keep raw `log` strings so the
  // legacy fallback path can still render them.
  const snapshot = value as GameState & { events?: unknown }
  return {
    ...snapshot,
    pendingSwampDiscard: snapshot.pendingSwampDiscard ?? null,
    events: sanitizeLogEvents(snapshot.events),
  }
}

function normalizeAdventureGameSnapshotEnvelope(value: unknown): AdventureGameSnapshotEnvelope | null {
  if (!isRecordObject(value) || value.schemaVersion !== ADVENTURE_SCHEMA_VERSION) {
    return null
  }
  const { runId, nodeId, attemptOrdinal, attemptSeed } = value
  if (!isAdventureRunId(runId)) return null
  if (typeof nodeId !== 'string' || !ADVENTURE_NODE_ID_PATTERN.test(nodeId)) return null
  if (!isNonNegativeSafeInteger(attemptOrdinal) || !isNonNegativeInteger(attemptSeed)) return null
  const game = normalizeGameSnapshot(value.game)
  if (!game) {
    return null
  }
  return { schemaVersion: ADVENTURE_SCHEMA_VERSION, runId, nodeId, attemptOrdinal, attemptSeed, game }
}

/**
 * Classifies the mid-game save slot without changing it: empty, a valid
 * identity-bound envelope, a valid version 1 bare `GameState` (which has no
 * identity and is never restored), or anything else.
 */
export function readStoredAdventureGameSnapshot(): StoredAdventureGameSnapshot {
  const raw = readStorageItem(ADVENTURE_GAME_STORAGE_KEY)
  if (raw === null) {
    return { kind: 'none' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'invalid' }
  }
  if (isRecordObject(parsed) && !('schemaVersion' in parsed)) {
    return isGameStateSnapshot(parsed) ? { kind: 'legacy' } : { kind: 'invalid' }
  }
  const envelope = normalizeAdventureGameSnapshotEnvelope(parsed)
  return envelope ? { kind: 'envelope', envelope } : { kind: 'invalid' }
}
