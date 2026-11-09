import { createStarterDeck } from '../game/cards'
import { isBasicLand, type Card, type GameState } from '../game/types'
import {
  ADVENTURE_NODE_ID_PATTERN,
  ADVENTURE_TIER_COUNT,
  cloneAdventureDeck,
  cloneAdventureMap,
  completeAdventureNode,
  generateBranchingAdventureMap,
  isAdventureAttemptOrdinal,
  isAdventureCard,
  isAdventureRouteState,
  isAdventureRunStatus,
  linearAdventureTiers,
  retryAdventureNode,
  selectAdventureNode,
  type AdventureEncounterOutcome,
  type AdventureMap,
  type AdventureMapNode,
  type AdventureOpponentDeck,
  type AdventureRouteProgress,
  type AdventureRouteState,
  type AdventureRunStage,
  type AdventureRunStatus,
} from './adventure-map'
import {
  applyAdventureLossProtection,
  chooseAdventureReward,
  cloneAdventureRelics,
  cloneAdventureRewardHistory,
  cloneAdventureRewardOffer,
  eligibleAdventureRewardIds,
  generateAdventureRewardOffer,
  isAdventureRewardHoldings,
  isAdventureRewardOffer,
  skipAdventureReward,
  type AdventureRelic,
  type AdventureRewardHistoryEntry,
  type AdventureRewardHoldings,
  type AdventureRewardOffer,
  type AdventureRewardProgress,
} from './adventure-rewards'
import {
  adventureEncounterGameSetup,
  cloneAdventureEncounterSetup,
  isAdventureEncounterSetup,
  planAdventureEncounterSetup,
  type AdventureEncounterGameSetup,
  type AdventureEncounterSetup,
} from './adventure-setup'
import { sanitizeLogEvents } from './game-recording'
import {
  isFiniteInteger as validatorsIsFiniteInteger,
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

export { ADVENTURE_TIER_COUNT, adventureNodeId, adventureRouteNodes, buildAdventureLineup } from './adventure-map'
export type {
  AdventureEncounterOutcome,
  AdventureMap,
  AdventureMapKind,
  AdventureMapNode,
  AdventureMapTier,
  AdventureNodeLane,
  AdventureNodeStatus,
  AdventureOpponentDeck,
  AdventureOpponentKind,
  AdventureRouteNode,
  AdventureRunStage,
  AdventureRunStatus,
} from './adventure-map'

export const ADVENTURE_HIGH_SCORE_STORAGE_KEY = 'cardgame.adventure-high-score'
export const ADVENTURE_GAME_STORAGE_KEY = 'cardgame.adventure-game'

/** Schema version of the persisted run and of the mid-game snapshot envelope. */
export const ADVENTURE_SCHEMA_VERSION = 2

const ADVENTURE_STARTING_CHANCES = 3
const ADVENTURE_RUN_ID_PATTERN = /^[0-9a-f]{32}$/

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
  /** Owned relics in catalog order. */
  relics: AdventureRelic[]
  /**
   * One entry for each resolved offer. The sources are the latest completed
   * non-boss nodes in route order; runs from before rewards existed have no
   * entries for the tiers they had already completed.
   */
  rewardHistory: AdventureRewardHistoryEntry[]
  /** The offer earned by the last won node: set at the `reward` stage only. */
  pendingReward: AdventureRewardOffer | null
  /**
   * Opening-hand setup of the committed attempt, planned once when its node
   * starts and kept for its restarts. Every result clears it.
   */
  encounterSetup: AdventureEncounterSetup | null
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
 * Creates a schema version 2 run on a seeded `branching` map, open at the
 * `map` stage. No node is selected and no attempt seed exists yet: selecting
 * a node derives the seed for that node and attempt.
 */
export function createAdventureRun(seed: number, runId: string): AdventureRunState {
  return checkedAdventureRun({
    schemaVersion: ADVENTURE_SCHEMA_VERSION,
    runId,
    baseSeed: seed,
    status: 'active',
    stage: 'map',
    map: generateBranchingAdventureMap(seed),
    currentTierIndex: 0,
    completedNodeIds: [],
    selectedNodeId: null,
    attemptOrdinal: 0,
    attemptSeed: null,
    remainingChances: ADVENTURE_STARTING_CHANCES,
    scoreEligibleChances: ADVENTURE_STARTING_CHANCES,
    winStreak: 0,
    scoreEligibleWinStreak: 0,
    totalRoundsPlayed: 0,
    totalCardsPlayed: 0,
    relics: [],
    rewardHistory: [],
    pendingReward: null,
    encounterSetup: null,
  })
}

/** Inactive baseline shared by the controller constructor, refresh and reset paths. */
export function createInactiveAdventureState(highScore = 0, hasSavedRun = false): AdventureState {
  return { run: null, highScore, hasSavedRun, pendingCompletion: null, lastResult: null }
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

/** The committed node of the current tier, or null before a node is selected. */
export function selectedAdventureNode(run: AdventureRunState): AdventureMapNode | null {
  if (run.selectedNodeId === null) {
    return null
  }
  return run.map.tiers[run.currentTierIndex]?.nodes.find((node) => node.id === run.selectedNodeId) ?? null
}

/**
 * Decks for the selected node's encounter: the player's starter deck for
 * `seed` and a detached copy of the node's stored opponent deck. Throws when
 * no node is selected rather than substituting another opponent.
 */
export function deckPairForAdventureGame(run: AdventureRunState, seed: number): [Card[], Card[]] {
  const node = selectedAdventureNode(run)
  if (!node) {
    throw new Error('An Adventure encounter needs a selected node.')
  }
  return [createStarterDeck(0, seed), cloneAdventureDeck(node.opponent.deck)]
}

/** `createInitialGame` arguments for a new game of the committed attempt. */
export interface AdventureEncounterLaunch extends AdventureEncounterGameSetup {
  seed: number
}

/**
 * The seed, decks and options for a new game of the run's committed
 * attempt. The saved encounter setup arranges the player's deck and opening
 * hand, so restarts of the same attempt deal the same opening. Throws
 * unless the run is at the `encounter` stage with a seed and a setup.
 */
export function adventureEncounterLaunch(run: AdventureRunState): AdventureEncounterLaunch {
  const seed = run.attemptSeed
  if (run.stage !== 'encounter' || seed === null || run.encounterSetup === null) {
    throw new Error('An Adventure encounter needs a committed attempt with its setup.')
  }
  return { seed, ...adventureEncounterGameSetup(run.encounterSetup, deckPairForAdventureGame(run, seed)) }
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

function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0
}

const ADVENTURE_COUNTER_KEYS = [
  'remainingChances',
  'scoreEligibleChances',
  'winStreak',
  'scoreEligibleWinStreak',
  'totalRoundsPlayed',
  'totalCardsPlayed',
] as const

/**
 * Completed non-boss nodes whose offers were resolved. At the `reward`
 * stage the last completed node's offer is still pending.
 */
function resolvedRewardSourceCount(completedCount: number, stage: AdventureRunStage | null): number {
  return stage === 'reward' ? completedCount - 1 : Math.min(completedCount, ADVENTURE_TIER_COUNT - 1)
}

/**
 * The history names the latest resolved sources in route order, with no
 * gaps. Runs from before rewards existed may lack entries for their earliest
 * completed tiers, but never for a tier after a resolved one.
 */
function isRewardHistoryOnRoute(
  history: readonly AdventureRewardHistoryEntry[],
  completedNodeIds: readonly string[],
  stage: AdventureRunStage | null,
): boolean {
  const end = resolvedRewardSourceCount(completedNodeIds.length, stage)
  const start = end - history.length
  return start >= 0 && history.every((entry, index) => entry.sourceNodeId === completedNodeIds[start + index])
}

/**
 * An offer is pending exactly at the `reward` stage. It was earned by the
 * last completed node, is the run's next offer, and offers only rewards the
 * run can still take, so no choice can be a no-op.
 */
function isPendingRewardForRun(offer: unknown, run: AdventureRouteState & AdventureRewardHoldings): boolean {
  if (run.stage !== 'reward') return offer === null
  if (!isAdventureRewardOffer(offer)) return false
  if (offer.sourceNodeId !== run.completedNodeIds.at(-1)) return false
  if (offer.rewardOrdinal !== run.rewardHistory.length) return false
  const eligible = eligibleAdventureRewardIds(run)
  return offer.choices.every((choice) => eligible.includes(choice))
}

/**
 * A setup belongs to a committed attempt: it is required at the `encounter`
 * stage and allowed at the `map` stage only while a node and its seed are
 * kept for a restart. Reward and terminal stages have none.
 */
function isEncounterSetupForRun(setup: unknown, run: AdventureRouteState): boolean {
  if (setup === null) return run.stage !== 'encounter'
  if (!isAdventureEncounterSetup(setup)) return false
  return run.stage === 'encounter' || (run.stage === 'map' && run.selectedNodeId !== null && run.attemptSeed !== null)
}

/** Strict guard for schema version 2 runs. Unknown versions fail closed. */
export function isAdventureRunState(value: unknown): value is AdventureRunState {
  if (!isRecordObject(value)) return false
  if (value.schemaVersion !== ADVENTURE_SCHEMA_VERSION) return false
  if (!isAdventureRunId(value.runId)) return false
  if (!isAdventureRouteState(value)) return false
  if (!ADVENTURE_COUNTER_KEYS.every((key) => isNonNegativeInteger(value[key]))) return false
  if (!isAdventureRewardHoldings(value)) return false
  if (!isRewardHistoryOnRoute(value.rewardHistory, value.completedNodeIds, value.stage)) return false
  return isPendingRewardForRun(value.pendingReward, value) && isEncounterSetupForRun(value.encounterSetup, value)
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
    relics: cloneAdventureRelics(run.relics),
    rewardHistory: cloneAdventureRewardHistory(run.rewardHistory),
    pendingReward: run.pendingReward === null ? null : cloneAdventureRewardOffer(run.pendingReward),
    encounterSetup: run.encounterSetup === null ? null : cloneAdventureEncounterSetup(run.encounterSetup),
  }
}

/** Validates an untrusted value and returns a detached copy, or null. */
export function normalizeAdventureRun(value: unknown): AdventureRunState | null {
  return isAdventureRunState(value) ? cloneAdventureRun(value) : null
}

/**
 * Fills in the two fields that schema version 2 runs saved before rewards
 * existed lack, so those saves stay playable without a schema change. It
 * applies only when both `pendingReward` and `encounterSetup` are absent and
 * the run holds no relics or reward history. `pendingReward` becomes null,
 * and a run saved at the `encounter` stage gets the setup it was launched
 * with: the default opening hand. Any other value, including a run missing
 * only one of the fields, is returned unchanged for the strict guard to
 * judge. The result is never written back; the next committed transition
 * saves the full shape.
 */
export function backfillPreRewardAdventureRun(value: Record<string, unknown>): Record<string, unknown> {
  if ('pendingReward' in value || 'encounterSetup' in value) return value
  if (!isEmptyArray(value.relics) || !isEmptyArray(value.rewardHistory)) return value
  return {
    ...value,
    pendingReward: null,
    encounterSetup: value.stage === 'encounter' ? planAdventureEncounterSetup([]).setup : null,
  }
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
    pendingReward: null,
    encounterSetup: null,
  })
}

function applyAdventureRouteProgress(run: AdventureRunState, progress: AdventureRouteProgress): void {
  run.currentTierIndex = progress.currentTierIndex
  run.completedNodeIds = [...progress.completedNodeIds]
  run.selectedNodeId = progress.selectedNodeId
  run.attemptOrdinal = progress.attemptOrdinal
  run.attemptSeed = progress.attemptSeed
}

/**
 * Commits a node choice from untrusted input and opens its encounter. The
 * node must be `current` or `available` on a resumable run at the `map`
 * stage. The attempt number and any stored seed are kept; otherwise the seed
 * is derived for the node and attempt. A new attempt plans its encounter
 * setup from the relics, which uses a Scout's Cache charge; a restart of the
 * same attempt reuses the saved setup and uses nothing. Returns null, and
 * changes nothing, when the choice is rejected.
 */
export function startAdventureEncounter(run: AdventureRunState, nodeId: unknown): AdventureRunState | null {
  const progress = selectAdventureNode(run, nodeId)
  if (!progress) {
    return null
  }
  const next = cloneAdventureRun(run)
  applyAdventureRouteProgress(next, progress)
  if (next.encounterSetup === null) {
    const plan = planAdventureEncounterSetup(next.relics)
    next.encounterSetup = plan.setup
    next.relics = plan.relics
  }
  next.stage = 'encounter'
  next.status = 'active'
  return checkedAdventureRun(next)
}

/**
 * Opens the hub for a resumable run as an active run. A pending reward stays
 * at the `reward` stage; anything else opens the `map` stage, with the
 * committed node, attempt number, seed and setup kept for a retry. A run
 * saved mid-encounter whose game cannot be restored replays the same
 * attempt.
 */
export function openAdventureMap(run: AdventureRunState): AdventureRunState {
  if (!isResumableAdventureRun(run)) {
    throw new Error('Only a resumable Adventure run can open the map.')
  }
  const next = cloneAdventureRun(run)
  next.stage = run.stage === 'reward' ? 'reward' : 'map'
  next.status = 'active'
  return checkedAdventureRun(next)
}

/** Marks a run saved mid-encounter active again, for a restored game. */
export function resumeAdventureEncounter(run: AdventureRunState): AdventureRunState {
  if (!isResumableAdventureRun(run) || run.stage !== 'encounter') {
    throw new Error('Only a saved Adventure encounter can be resumed.')
  }
  const next = cloneAdventureRun(run)
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

/** A finished encounter applied to its run, and which losses relics prevented. */
export interface AdventureEncounterResolution {
  run: AdventureRunState
  /** Guardian Sigil kept the chance a loss would have cost. */
  chanceLossPrevented: boolean
  /** Streak Anchor kept the win streak a loss would have reset. */
  streakResetPrevented: boolean
}

/**
 * Applies a finished encounter with the route and reward rules. Every result
 * counts a round and clears the attempt's encounter setup; a draw does not
 * refund a Scout's Cache charge. A win completes the selected node. After
 * the boss it completes the run; otherwise the route moves to the next tier
 * and waits at the `reward` stage with the offer that node earned. The offer
 * depends only on the run, so applying the same result again gives the same
 * offer. A loss lets Guardian Sigil keep the chance and Streak Anchor keep
 * the streak, then fails the run when no chance remains. A loss or draw
 * otherwise retries the same node with the next attempt number and its
 * derived seed, back at the `map` stage. The score-eligible counters follow
 * a reward-free run: relics never protect them.
 */
export function resolveAdventureEncounterResult(
  run: AdventureRunState,
  outcome: AdventureEncounterOutcome,
): AdventureEncounterResolution {
  if (run.status !== 'active' || run.stage !== 'encounter' || run.selectedNodeId === null) {
    throw new Error('Only an active Adventure encounter can finish.')
  }
  const next = cloneAdventureRun(run)
  next.totalRoundsPlayed += 1
  next.encounterSetup = null
  let chanceLossPrevented = false
  let streakResetPrevented = false
  if (outcome === 'win') {
    next.winStreak += 1
    if (next.winStreak % 3 === 0) {
      next.remainingChances += 1
    }
    next.scoreEligibleWinStreak += 1
    if (next.scoreEligibleWinStreak % 3 === 0) {
      next.scoreEligibleChances += 1
    }
    const completion = completeAdventureNode(run)
    applyAdventureRouteProgress(next, completion)
    if (completion.finished) {
      next.status = 'completed'
      next.stage = null
    } else {
      next.pendingReward = generateAdventureRewardOffer(next.baseSeed, run.selectedNodeId, next)
      next.stage = 'reward'
      next.status = 'active'
    }
    return { run: checkedAdventureRun(next), chanceLossPrevented, streakResetPrevented }
  }
  if (outcome === 'loss') {
    const protectedLoss = applyAdventureLossProtection(next, outcome)
    next.remainingChances = protectedLoss.remainingChances
    next.winStreak = protectedLoss.winStreak
    next.relics = protectedLoss.relics
    chanceLossPrevented = protectedLoss.preventedChanceLoss
    streakResetPrevented = protectedLoss.preventedStreakReset
    next.scoreEligibleChances = Math.max(0, next.scoreEligibleChances - 1)
    next.scoreEligibleWinStreak = 0
    if (next.remainingChances <= 0) {
      next.status = 'failed'
      next.stage = null
      next.selectedNodeId = null
      next.attemptSeed = null
      return { run: checkedAdventureRun(next), chanceLossPrevented, streakResetPrevented }
    }
  }
  applyAdventureRouteProgress(next, retryAdventureNode(run))
  next.stage = 'map'
  next.status = 'active'
  return { run: checkedAdventureRun(next), chanceLossPrevented, streakResetPrevented }
}

/** The run after a finished encounter; see `resolveAdventureEncounterResult`. */
export function applyAdventureEncounterResult(
  run: AdventureRunState,
  outcome: AdventureEncounterOutcome,
): AdventureRunState {
  return resolveAdventureEncounterResult(run, outcome).run
}

// Resolves the pending offer once, then opens the next tier's map.
function resolveAdventureRunReward(
  run: AdventureRunState,
  offerId: unknown,
  resolve: (offer: AdventureRewardOffer) => AdventureRewardProgress | null,
): AdventureRunState | null {
  const offer = run.pendingReward
  if (!isResumableAdventureRun(run) || run.stage !== 'reward' || offer === null || offerId !== offer.offerId) {
    return null
  }
  const progress = resolve(offer)
  if (!progress) {
    return null
  }
  const next = cloneAdventureRun(run)
  next.remainingChances = progress.remainingChances
  next.relics = progress.relics
  next.rewardHistory = progress.rewardHistory
  next.pendingReward = null
  next.stage = 'map'
  next.status = 'active'
  return checkedAdventureRun(next)
}

/**
 * Takes one reward of the pending offer from untrusted input: Second Wind
 * adds a chance (never a score-eligible one), and a relic joins the
 * inventory or gains a charge. The history records the choice, the offer
 * clears and the map opens at the next tier. Returns null, changing
 * nothing, unless the run is resumable at the `reward` stage, `offerId`
 * names its pending offer and `rewardId` is one of that offer's choices.
 */
export function chooseAdventureRunReward(
  run: AdventureRunState,
  offerId: unknown,
  rewardId: unknown,
): AdventureRunState | null {
  return resolveAdventureRunReward(run, offerId, (offer) => chooseAdventureReward(run, offer, rewardId))
}

/**
 * Skips the pending offer from untrusted input: only the history changes,
 * recording the skip, and the map opens at the next tier. Returns null
 * under the same conditions as `chooseAdventureRunReward`, apart from the
 * reward.
 */
export function skipAdventureRunReward(run: AdventureRunState, offerId: unknown): AdventureRunState | null {
  return resolveAdventureRunReward(run, offerId, (offer) => skipAdventureReward(run, offer))
}

export function readStoredAdventureHighScore(): number {
  const raw = readStorageItem(ADVENTURE_HIGH_SCORE_STORAGE_KEY)
  if (raw === null) {
    return 0
  }
  const value = Number(raw)
  return Number.isFinite(value) ? value : 0
}

/** Returns whether the high score reached storage. */
export function persistAdventureHighScore(score: number): boolean {
  return writeStorageItem(ADVENTURE_HIGH_SCORE_STORAGE_KEY, String(score))
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
  if (!isAdventureAttemptOrdinal(attemptOrdinal) || !isNonNegativeInteger(attemptSeed)) return null
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
