import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  ADVENTURE_GAME_STORAGE_KEY,
  ADVENTURE_HIGH_SCORE_STORAGE_KEY,
  adventureEncounterLaunch,
  applyAdventureEncounterResult,
  computeAdventureScore,
  deckPairForAdventureGame,
  pauseAdventureRun,
  type AdventureEncounterOutcome,
  type AdventureGameSnapshotEnvelope,
  type AdventureRunState,
  type AdventureRunStateV1,
} from '../app/adventure'
import {
  ADVENTURE_FORK_PATTERNS,
  adventureAttemptSeed,
  generateBranchingAdventureMap,
} from '../app/adventure-map'
import { ADVENTURE_RUN_STORAGE_KEY } from '../app/adventure-persistence'
import {
  ADVENTURE_REWARD_IDS,
  adventureRewardCatalogEntry,
  generateAdventureRewardOffer,
  type AdventureRewardId,
} from '../app/adventure-rewards'
import { planAdventureEncounterSetup } from '../app/adventure-setup'
import { AppController } from '../app/controller'
import { actionableAdventureNodes } from '../app/lobby-presentation'
import type { AdventureNodeSummary, AdventureRewardOfferSummary } from '../app/types'
import { createStarterDeck } from '../game/cards'
import { canAct, createInitialGame, getLegalActions, remainingCounterGrowth } from '../game/engine'
import type { GameState } from '../game/types'
import { claimed, malformedBase } from './fixtures/adventure-malformed-v2'
import { installFakeTimerHooks } from './helpers/timers'
import { installTrackedStorage, type TrackedStorage } from './helpers/tracked-storage'

interface V1Fixture {
  closedMidRound: Record<string, string>
  pausedMidRound: Record<string, string>
}

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'adventure-v1-saves.json'), 'utf8'),
) as V1Fixture

const RUN_KEY = ADVENTURE_RUN_STORAGE_KEY
const GAME_KEY = ADVENTURE_GAME_STORAGE_KEY
const HIGH_SCORE_KEY = ADVENTURE_HIGH_SCORE_STORAGE_KEY
const STORAGE_WARNING = 'Adventure progress could not be saved (storage unavailable).'
const STORAGE_WARNING_AGAIN = 'Adventure progress still could not be saved (storage unavailable).'
// A refused result still names its outcome first.
const RESULT_LEADS: Record<AdventureEncounterOutcome, string> = {
  win: 'Encounter won.',
  loss: 'Encounter lost.',
  draw: 'Encounter ended in a draw.',
}
const resultWarning = (outcome: AdventureEncounterOutcome): string =>
  `${RESULT_LEADS[outcome]} The result could not be saved (storage unavailable). Retry saving the result.`
const resultWarningAgain = (outcome: AdventureEncounterOutcome): string =>
  `${RESULT_LEADS[outcome]} The result still could not be saved (storage unavailable). Retry saving the result.`
const PENDING_NOTICE = 'Save the encounter result first: choose Retry Saving Result.'
const UNAVAILABLE_NODE = 'That encounter is not available. Choose a highlighted encounter.'
const RUN_ID_PATTERN = /^[0-9a-f]{32}$/

function recoveryMessage(tier: number, holdsChargedRelic = false): string {
  const relicCharge = holdsChargedRelic ? ' or a relic charge' : ''
  return `Adventure resumed at Tier ${tier}. The saved game could not be restored, so the encounter restarts without using a chance${relicCharge}.`
}

/** Writes and removals of the Adventure run and mid-game keys. */
function adventureCalls(storage: TrackedStorage): string[] {
  return storage.calls.filter((call) => call.endsWith(`:${RUN_KEY}`) || call.endsWith(`:${GAME_KEY}`))
}

interface ControllerInternals {
  state: {
    game: GameState | null
    seed: number
    adventure: { run: AdventureRunState | null }
  }
  onAdventureGameFinished: (previous: GameState) => void
}

function internals(controller: AppController): ControllerInternals {
  return controller as unknown as ControllerInternals
}

function currentRun(controller: AppController): AdventureRunState {
  const run = internals(controller).state.adventure.run
  if (!run) {
    throw new Error('Expected an Adventure run in memory.')
  }
  return run
}

function liveGame(controller: AppController): GameState {
  const game = internals(controller).state.game
  if (!game) {
    throw new Error('Expected a live Adventure game.')
  }
  return game
}

function actionableNodes(controller: AppController): readonly AdventureNodeSummary[] {
  return actionableAdventureNodes(controller.getViewModel().adventure)
}

function actionableIds(controller: AppController): string[] {
  return actionableNodes(controller).map((node) => node.id)
}

/** Starts the first actionable node of the current tier and returns it. */
function startFirstNode(controller: AppController): AdventureNodeSummary {
  const node = actionableNodes(controller)[0]
  if (!node) {
    throw new Error('Expected an actionable Adventure node.')
  }
  controller.startAdventureNode(node.id)
  return node
}

/** Skips the pending reward so the next tier's encounters open. */
function skipPendingReward(controller: AppController): void {
  const offer = controller.getViewModel().adventure.pendingReward
  if (!offer) {
    throw new Error('Expected a pending reward.')
  }
  controller.skipAdventureReward(offer.offerId)
  expect(controller.getViewModel().adventure.pendingReward).toBeNull()
}

/** Ends the live encounter the same way the engine does: gameOver with a winner. */
function finishEncounter(controller: AppController, winner: 0 | 1 | 'draw'): void {
  const game = liveGame(controller)
  const previous = structuredClone(game)
  game.winner = winner
  game.phase = 'gameOver'
  internals(controller).onAdventureGameFinished(previous)
}

function winnerFor(outcome: AdventureEncounterOutcome): 0 | 1 | 'draw' {
  return outcome === 'win' ? 0 : outcome === 'loss' ? 1 : 'draw'
}

/** Plays the human's first legal land so the board differs from a fresh launch. */
function playFirstLand(controller: AppController): void {
  const game = controller.getViewModel().game
  const action = game
    ? Object.values(game.legal.playLandByCard).find((options) => options.length > 0)?.[0]?.action
    : undefined
  if (!action) {
    throw new Error('Expected a playable land.')
  }
  controller.submitAction(action)
}

/**
 * Plays Player 1's turn (a land when one is allowed, then End Turn) and lets
 * the AI play its turn. True once Player 1 may act in a new turn, false when
 * the game has ended.
 */
function playTurnAgainstAi(controller: AppController): boolean {
  const startTurn = liveGame(controller).turn
  for (let guard = 0; guard < 500; guard += 1) {
    const game = internals(controller).state.game
    if (!game || game.phase === 'gameOver') return false
    if (!canAct(game, 0)) {
      vi.runOnlyPendingTimers()
      continue
    }
    if (game.phase === 'main' && game.turn > startTurn) return true
    const legal = getLegalActions(game, 0)
    controller.submitAction(legal.find((action) => action.type === 'play_land') ?? legal[0])
  }
  throw new Error('Expected the turn to finish.')
}

/** Wins encounters, skipping their rewards, until the current tier is an uncommitted fork. */
function advanceToFork(controller: AppController): [AdventureNodeSummary, AdventureNodeSummary] {
  for (let guard = 0; guard < 7; guard += 1) {
    const nodes = actionableNodes(controller)
    if (nodes.length === 2) {
      return [nodes[0], nodes[1]]
    }
    startFirstNode(controller)
    finishEncounter(controller, 0)
    skipPendingReward(controller)
  }
  throw new Error('Expected a fork.')
}

/** Wins the first six tiers, skipping their rewards, and starts the boss encounter. */
function reachBoss(controller: AppController): void {
  for (let tier = 1; tier < 7; tier += 1) {
    startFirstNode(controller)
    finishEncounter(controller, 0)
    skipPendingReward(controller)
  }
  expect(startFirstNode(controller).boss).toBe(true)
}

/** Loses two encounters on the first node and starts it again with one chance left. */
function reachLastChance(controller: AppController): void {
  const node = startFirstNode(controller)
  finishEncounter(controller, 1)
  controller.startAdventureNode(node.id)
  finishEncounter(controller, 1)
  controller.startAdventureNode(node.id)
  expect(controller.getViewModel().adventure.remainingChances).toBe(1)
}

/** Every way out of an encounter waits for the pending result, keeping the board. */
function expectPendingBlocksNavigation(controller: AppController, board: GameState): void {
  const attempts: Array<() => void> = [
    () => controller.backToLobby(),
    () => controller.pauseAdventure(),
    () => controller.startGame('local-hvh'),
    () => controller.startAdventure(),
    () => controller.resumeAdventure(),
    () => controller.importRecordingJson('{}'),
  ]
  for (const attempt of attempts) {
    controller.reportStatus('')
    attempt()
    const view = controller.getViewModel()
    expect(view.status).toBe(PENDING_NOTICE)
    expect(view.mode).toBe('adventure-hvai')
    expect(liveGame(controller)).toBe(board)
  }
}

function storedJson<T>(storage: TrackedStorage, key: string): T {
  const raw = storage.data.get(key)
  if (raw === undefined) {
    throw new Error(`Expected ${key} in storage.`)
  }
  return JSON.parse(raw) as T
}

/** The game a fresh launch of the run's committed attempt produces. */
function freshAttemptGame(run: AdventureRunState): GameState {
  const seed = run.attemptSeed
  if (seed === null) {
    throw new Error('Expected an attempt seed.')
  }
  return createInitialGame(seed, deckPairForAdventureGame(run, seed))
}

function v1Run(name: keyof V1Fixture = 'closedMidRound'): AdventureRunStateV1 {
  return JSON.parse(fixture[name][RUN_KEY]) as AdventureRunStateV1
}

/** The game the version 1 controller launched for a run: same seed, same decks. */
function v1LaunchGame(run: AdventureRunStateV1): GameState {
  const seed = run.activeGameSeed!
  return createInitialGame(seed, [
    createStarterDeck(0, seed),
    structuredClone(run.opponentLineup[run.currentOpponentIndex].deck),
  ])
}

function recordingJson(): string {
  installTrackedStorage()
  const source = new AppController()
  source.startGame('local-hvh')
  const json = source.exportRecordingJson()
  if (!json) {
    throw new Error('Expected an exported recording.')
  }
  return json
}

function forkTierIndexes(seed: number): number[] {
  return generateBranchingAdventureMap(seed).tiers.flatMap((tier, index) => (tier.nodes.length === 2 ? [index] : []))
}

/** A clock value whose branching map uses the given fork pattern. */
function seedForForkPattern(pattern: readonly number[]): number {
  for (let seed = 1_770_000_000_000; seed < 1_770_000_001_000; seed += 1) {
    if (forkTierIndexes(seed).join(',') === pattern.join(',')) {
      return seed
    }
  }
  throw new Error(`No seed found for fork pattern ${pattern.join(',')}.`)
}

describe('Adventure controller with version 1 saves', () => {
  installFakeTimerHooks()

  it.each(['closedMidRound', 'pausedMidRound'] as const)(
    'shows the %s version 1 save as a paused run on the map without writing on load, lobby return, import or another mode',
    (name) => {
      const json = recordingJson()
      const saved = fixture[name]
      const storage = installTrackedStorage(saved)

      const controller = new AppController()
      const expected = {
        status: 'paused',
        stage: 'map',
        currentTier: 3,
        attemptOrdinal: 0,
        remainingChances: 2,
        winStreak: 1,
        totalRoundsPlayed: 4,
        activeGameSeed: 1760000420000,
        hasSavedRun: true,
      }
      expect(controller.getViewModel().adventure).toMatchObject(expected)
      expect(controller.getViewModel().adventure.tiers.map((tier) => tier.nodes.map((node) => `${node.id}:${node.status}`)))
        .toEqual([
          ['tier-1-center:completed'],
          ['tier-2-center:completed'],
          ['tier-3-center:current'],
          ['tier-4-center:locked'],
          ['tier-5-center:locked'],
          ['tier-6-center:locked'],
          ['tier-7-center:locked'],
        ])

      controller.backToLobby()
      controller.importRecordingJson(json)
      controller.backToLobby()
      controller.startGame('local-hvh')
      controller.backToLobby()

      expect(adventureCalls(storage)).toEqual([])
      for (const [key, value] of Object.entries(saved)) {
        expect(storage.data.get(key)).toBe(value)
      }
      expect(controller.getViewModel().adventure).toMatchObject(expected)
      expect(actionableIds(controller)).toEqual(['tier-3-center'])
    },
  )

  it('writes version 2 when the converted encounter starts and keeps the run ID through pause, reload, retry and advance', () => {
    const legacy = v1Run()
    const storage = installTrackedStorage(fixture.closedMidRound)
    const controller = new AppController()
    const runId = currentRun(controller).runId
    expect(runId).toMatch(RUN_ID_PATTERN)

    controller.resumeAdventure()
    expect(controller.getViewModel().status).toBe('Adventure resumed at Tier 3.')
    expect(controller.getViewModel().mode).toBe('adventure-hvai')
    expect(internals(controller).state.game).toBeNull()
    expect(adventureCalls(storage)).toEqual([])

    const [node] = actionableNodes(controller)
    expect(node.id).toBe('tier-3-center')
    controller.startAdventureNode(node.id)
    expect(controller.getViewModel().status).toBe(`Tier 3 encounter started against ${node.opponent.label}.`)
    expect(adventureCalls(storage)).toEqual([`set:${RUN_KEY}`, `remove:${GAME_KEY}`])
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toMatchObject({
      schemaVersion: 2,
      runId,
      baseSeed: legacy.baseSeed,
      status: 'active',
      stage: 'encounter',
      map: { kind: 'legacy-linear' },
      currentTierIndex: 2,
      completedNodeIds: ['tier-1-center', 'tier-2-center'],
      selectedNodeId: 'tier-3-center',
      attemptOrdinal: 0,
      attemptSeed: legacy.activeGameSeed,
      remainingChances: 2,
      scoreEligibleChances: 2,
      winStreak: 1,
      scoreEligibleWinStreak: 1,
      totalRoundsPlayed: 4,
      totalCardsPlayed: 4,
      relics: [],
      rewardHistory: [],
    })
    // The converted encounter launches exactly as the version 1 code would.
    expect(internals(controller).state.seed).toBe(legacy.activeGameSeed)
    expect(liveGame(controller)).toEqual(v1LaunchGame(legacy))

    playFirstLand(controller)
    const pausedGame = structuredClone(liveGame(controller))
    controller.pauseAdventure()
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toMatchObject({
      runId,
      status: 'paused',
      stage: 'encounter',
      totalCardsPlayed: 5,
    })
    expect(storedJson<AdventureGameSnapshotEnvelope>(storage, GAME_KEY)).toMatchObject({
      schemaVersion: 2,
      runId,
      nodeId: 'tier-3-center',
      attemptOrdinal: 0,
      attemptSeed: legacy.activeGameSeed,
    })

    const reloaded = new AppController()
    expect(currentRun(reloaded).runId).toBe(runId)
    reloaded.resumeAdventure()
    expect(reloaded.getViewModel().status).toBe('Adventure resumed at Tier 3.')
    expect(liveGame(reloaded)).toEqual(pausedGame)

    finishEncounter(reloaded, 1)
    expect(reloaded.getViewModel().status).toBe('Encounter lost. 1 chance left. Retry Tier 3.')
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toMatchObject({
      runId,
      status: 'active',
      stage: 'map',
      currentTierIndex: 2,
      selectedNodeId: 'tier-3-center',
      attemptOrdinal: 1,
      attemptSeed: adventureAttemptSeed(legacy.baseSeed, 2, 'center', 1),
      remainingChances: 1,
      scoreEligibleChances: 1,
      winStreak: 0,
      scoreEligibleWinStreak: 0,
    })
    expect(actionableIds(reloaded)).toEqual(['tier-3-center'])

    reloaded.startAdventureNode('tier-3-center')
    expect(liveGame(reloaded)).toEqual(freshAttemptGame(currentRun(reloaded)))
    finishEncounter(reloaded, 0)
    expect(reloaded.getViewModel().status).toBe('Encounter won. Choose a reward or skip it to continue to Tier 4.')
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toMatchObject({
      runId,
      status: 'active',
      stage: 'reward',
      currentTierIndex: 3,
      completedNodeIds: ['tier-1-center', 'tier-2-center', 'tier-3-center'],
      selectedNodeId: null,
      attemptOrdinal: 0,
      attemptSeed: null,
      rewardHistory: [],
      // Tiers won before the conversion earn no retroactive offer.
      pendingReward: { offerId: 'reward-1-tier-3-center', sourceNodeId: 'tier-3-center', rewardOrdinal: 0 },
      encounterSetup: null,
    })

    skipPendingReward(reloaded)
    expect(reloaded.getViewModel().status).toBe('Reward skipped. Choose your Tier 4 encounter.')
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toMatchObject({
      runId,
      stage: 'map',
      currentTierIndex: 3,
      rewardHistory: [{ sourceNodeId: 'tier-3-center', rewardId: null }],
      pendingReward: null,
    })
    expect(actionableIds(reloaded)).toEqual(['tier-4-center'])
  })

  it('keeps the unsaved conversion ID through in-session refreshes until the first save', () => {
    const json = recordingJson()
    const storage = installTrackedStorage(fixture.closedMidRound)
    const controller = new AppController()
    const runId = currentRun(controller).runId

    controller.importRecordingJson(json)
    controller.backToLobby()
    controller.resumeAdventure()
    expect(currentRun(controller).runId).toBe(runId)
    expect(adventureCalls(storage)).toEqual([])

    controller.startAdventureNode('tier-3-center')
    expect(storedJson<AdventureRunState>(storage, RUN_KEY).runId).toBe(runId)
    expect(currentRun(controller).runId).toBe(runId)
  })

  it('opens a paused version 1 game on the map with a recovery warning and keeps the chance', () => {
    const legacy = v1Run('pausedMidRound')
    const storage = installTrackedStorage(fixture.pausedMidRound)
    const controller = new AppController()

    controller.resumeAdventure()

    expect(controller.getViewModel().status).toBe(recoveryMessage(3))
    expect(internals(controller).state.game).toBeNull()
    expect(controller.getViewModel().adventure).toMatchObject({
      status: 'active',
      stage: 'map',
      currentTier: 3,
      remainingChances: 2,
      activeGameSeed: legacy.activeGameSeed,
    })
    // Only the unusable game is removed; the run is written by the next transition.
    expect(adventureCalls(storage)).toEqual([`remove:${GAME_KEY}`])
    expect(storage.data.get(RUN_KEY)).toBe(fixture.pausedMidRound[RUN_KEY])
    expect(storage.data.has(GAME_KEY)).toBe(false)

    controller.startAdventureNode('tier-3-center')
    expect(liveGame(controller)).toEqual(v1LaunchGame(legacy))
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toMatchObject({ schemaVersion: 2, totalCardsPlayed: 5 })
  })

  it('quietly discards a corrupt mid-game slot next to a version 1 run', () => {
    const legacy = v1Run()
    const storage = installTrackedStorage({
      ...fixture.closedMidRound,
      [GAME_KEY]: '{not json',
    })
    const controller = new AppController()

    controller.resumeAdventure()

    expect(controller.getViewModel().status).toBe('Adventure resumed at Tier 3.')
    expect(storage.data.has(GAME_KEY)).toBe(false)
    controller.startAdventureNode('tier-3-center')
    expect(liveGame(controller)).toEqual(v1LaunchGame(legacy))
  })

  it('keeps the map and the same choice when the first version 2 write fails', () => {
    const legacy = v1Run('pausedMidRound')
    const storage = installTrackedStorage(fixture.pausedMidRound)
    storage.failingSets.add(RUN_KEY)
    const controller = new AppController()
    controller.resumeAdventure()
    const before = controller.getViewModel().adventure

    controller.startAdventureNode('tier-3-center')

    expect(controller.getViewModel().status).toBe(`${STORAGE_WARNING} The encounter did not start.`)
    expect(internals(controller).state.game).toBeNull()
    expect(controller.getViewModel().adventure).toEqual(before)
    expect(storage.data.get(RUN_KEY)).toBe(fixture.pausedMidRound[RUN_KEY])
    expect(actionableIds(controller)).toEqual(['tier-3-center'])

    storage.failingSets.delete(RUN_KEY)
    controller.startAdventureNode('tier-3-center')
    expect(liveGame(controller)).toEqual(v1LaunchGame(legacy))
    expect(storedJson<AdventureRunState>(storage, RUN_KEY).schemaVersion).toBe(2)
  })

  it('completes a converted run whose final opponent is not a mono boss and whose round disagrees with its opponent index', () => {
    const legacy = v1Run()
    legacy.currentOpponentIndex = 6
    legacy.currentRound = 4
    legacy.opponentLineup[6] = { ...structuredClone(legacy.opponentLineup[0]), id: legacy.opponentLineup[6].id }
    const storage = installTrackedStorage({ [RUN_KEY]: JSON.stringify(legacy) })
    const controller = new AppController()
    const adventure = controller.getViewModel().adventure
    expect(adventure).toMatchObject({ currentTier: 7, stage: 'map' })
    expect(adventure.tiers[6].nodes[0]).toMatchObject({ id: 'tier-7-center', boss: true, status: 'current' })
    expect(adventure.tiers[6].nodes[0].opponent.kind).toBe('dual')

    controller.resumeAdventure()
    expect(controller.getViewModel().status).toBe('Adventure resumed at Tier 7.')
    controller.startAdventureNode('tier-7-center')
    expect(liveGame(controller)).toEqual(v1LaunchGame(legacy))

    finishEncounter(controller, 0)

    const view = controller.getViewModel()
    const score = 2 * 100 - legacy.totalCardsPlayed + (legacy.totalRoundsPlayed + 1) * 5
    expect(view.status).toBe(`Adventure completed! Score: ${score}. High score: ${score}.`)
    // The hub shows the ending until the player leaves.
    expect(view.mode).toBe('adventure-hvai')
    expect(view.game).toBeNull()
    expect(view.adventure).toMatchObject({ status: 'completed', hasSavedRun: false, highScore: score })
    expect(view.adventure.lastResult).toMatchObject({ outcome: 'win', tierIndex: 6, score })
    expect(storage.data.has(RUN_KEY)).toBe(false)
    expect(storage.data.get(HIGH_SCORE_KEY)).toBe(String(score))
  })
})

describe('Adventure controller persistence and recovery', () => {
  installFakeTimerHooks()

  it('gives each new run a different ID even with a frozen clock and the same seed', () => {
    vi.setSystemTime(1_770_000_000_000)
    installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    const first = currentRun(controller)
    controller.abandonAdventure()
    controller.startAdventure()
    const second = currentRun(controller)

    expect(first.runId).toMatch(RUN_ID_PATTERN)
    expect(second.runId).toMatch(RUN_ID_PATTERN)
    expect(second.runId).not.toBe(first.runId)
    expect(second.baseSeed).toBe(first.baseSeed)
    expect(second.map).toEqual(first.map)
  })

  it('starts a run with one run write and clears any leftover mid-game save', () => {
    const storage = installTrackedStorage({ [GAME_KEY]: '{"stale":true}' })
    const controller = new AppController()

    controller.startAdventure()

    expect(adventureCalls(storage)).toEqual([`set:${RUN_KEY}`, `remove:${GAME_KEY}`])
    expect(storage.data.has(GAME_KEY)).toBe(false)
    expect(internals(controller).state.game).toBeNull()
  })

  it('pauses mid-encounter with one game write followed by one run write', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    startFirstNode(controller)
    playFirstLand(controller)
    storage.calls.length = 0

    controller.pauseAdventure()

    expect(adventureCalls(storage)).toEqual([`set:${GAME_KEY}`, `set:${RUN_KEY}`])
  })

  const mismatches: Array<[string, (envelope: AdventureGameSnapshotEnvelope) => void]> = [
    ['run', (envelope) => { envelope.runId = 'f'.repeat(32) }],
    ['node', (envelope) => { envelope.nodeId = 'tier-2-center' }],
    ['attempt', (envelope) => { envelope.attemptOrdinal += 1 }],
    ['seed', (envelope) => { envelope.attemptSeed += 1 }],
  ]

  it.each(mismatches)('opens the map with a recovery warning when the saved %s does not match', (_field, mutate) => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    const node = startFirstNode(controller)
    playFirstLand(controller)
    controller.pauseAdventure()
    const envelope = storedJson<AdventureGameSnapshotEnvelope>(storage, GAME_KEY)
    mutate(envelope)
    storage.data.set(GAME_KEY, JSON.stringify(envelope))
    const storedRun = storage.data.get(RUN_KEY)

    controller.resumeAdventure()

    expect(controller.getViewModel().mode).toBe('adventure-hvai')
    expect(internals(controller).state.game).toBeNull()
    expect(controller.getViewModel().status).toBe(recoveryMessage(1))
    expect(controller.getViewModel().adventure).toMatchObject({
      status: 'active',
      stage: 'map',
      remainingChances: 3,
      attemptOrdinal: 0,
    })
    expect(actionableIds(controller)).toEqual([node.id])
    expect(storage.data.has(GAME_KEY)).toBe(false)
    expect(storage.data.get(RUN_KEY)).toBe(storedRun)

    controller.startAdventureNode(node.id)
    expect(liveGame(controller)).toEqual(freshAttemptGame(currentRun(controller)))
    expect(currentRun(controller).attemptOrdinal).toBe(0)
  })

  it.each(mismatches)('never restores a mismatched %s save even when deleting it fails', (_field, mutate) => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    const node = startFirstNode(controller)
    playFirstLand(controller)
    controller.pauseAdventure()
    const envelope = storedJson<AdventureGameSnapshotEnvelope>(storage, GAME_KEY)
    mutate(envelope)
    const stale = JSON.stringify(envelope)
    storage.data.set(GAME_KEY, stale)
    storage.failingRemoves.add(GAME_KEY)

    controller.resumeAdventure()
    expect(internals(controller).state.game).toBeNull()
    expect(controller.getViewModel().status).toBe(recoveryMessage(1))
    expect(storage.data.get(GAME_KEY)).toBe(stale)

    controller.backToLobby()
    controller.resumeAdventure()
    expect(internals(controller).state.game).toBeNull()
    expect(controller.getViewModel().status).toBe(recoveryMessage(1))

    controller.startAdventureNode(node.id)
    expect(liveGame(controller)).toEqual(freshAttemptGame(currentRun(controller)))
    expect(controller.getViewModel().adventure).toMatchObject({ remainingChances: 3, attemptOrdinal: 0 })
  })

  it('keeps restoring a save that starts at both counter limits, with a Pause and a reload after every turn', () => {
    const storage = installTrackedStorage()
    const first = new AppController()
    first.startAdventure()
    startFirstNode(first)
    first.pauseAdventure()
    const envelope = storedJson<AdventureGameSnapshotEnvelope>(storage, GAME_KEY)
    const growth = remainingCounterGrowth(envelope.game)
    envelope.game.turn = Number.MAX_SAFE_INTEGER - growth.turn
    envelope.game.nextInstanceId = Number.MAX_SAFE_INTEGER - growth.nextInstanceId
    storage.data.set(GAME_KEY, JSON.stringify(envelope))

    let saved = envelope.game
    let turns = 0
    for (;;) {
      const controller = new AppController()
      controller.resumeAdventure()
      expect(controller.getViewModel().status).toBe('Adventure resumed at Tier 1.')
      expect(liveGame(controller)).toEqual(saved)
      if (!playTurnAgainstAi(controller)) break
      turns += 1
      const paused = structuredClone(liveGame(controller))
      expect([paused.turn, paused.nextInstanceId].every(Number.isSafeInteger)).toBe(true)
      controller.pauseAdventure()
      saved = storedJson<AdventureGameSnapshotEnvelope>(storage, GAME_KEY).game
      expect(saved).toEqual(paused)
    }

    expect(turns).toBeGreaterThan(3)
    expect(saved.turn).toBe(envelope.game.turn + turns * 2)
    expect(saved.nextInstanceId).toBeGreaterThan(envelope.game.nextInstanceId)
  })

  it.each(['turn', 'nextInstanceId'] as const)('restarts the encounter when the saved %s has no room for the rest of the game', (counter) => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    startFirstNode(controller)
    controller.pauseAdventure()
    const envelope = storedJson<AdventureGameSnapshotEnvelope>(storage, GAME_KEY)
    envelope.game[counter] = Number.MAX_SAFE_INTEGER - remainingCounterGrowth(envelope.game)[counter] + 1
    storage.data.set(GAME_KEY, JSON.stringify(envelope))

    controller.resumeAdventure()

    expect(internals(controller).state.game).toBeNull()
    expect(controller.getViewModel().status).toBe(recoveryMessage(1))
    expect(controller.getViewModel().adventure).toMatchObject({ stage: 'map', remainingChances: 3, attemptOrdinal: 0 })
  })

  const staleSources: Array<[string, (controller: AppController) => void]> = [
    ['a reset run', (controller) => {
      controller.abandonAdventure()
      controller.startAdventure()
    }],
    ['a completed node', (controller) => {
      finishEncounter(controller, 0)
      skipPendingReward(controller)
    }],
    ['an earlier attempt', (controller) => finishEncounter(controller, 1)],
  ]

  it.each(staleSources)('never restores a real save left behind by %s', (_source, advance) => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    startFirstNode(controller)
    playFirstLand(controller)
    controller.pauseAdventure()
    const stale = storage.data.get(GAME_KEY)
    expect(stale).toBeDefined()
    controller.resumeAdventure()
    advance(controller)
    const node = startFirstNode(controller)
    playFirstLand(controller)
    controller.pauseAdventure()
    // Simulate a removal that failed earlier: the older save is back in the slot.
    storage.data.set(GAME_KEY, stale!)

    controller.resumeAdventure()

    const tier = controller.getViewModel().adventure.currentTier
    expect(internals(controller).state.game).toBeNull()
    expect(controller.getViewModel().status).toBe(recoveryMessage(tier))
    expect(storage.data.has(GAME_KEY)).toBe(false)
    controller.startAdventureNode(node.id)
    expect(liveGame(controller)).toEqual(freshAttemptGame(currentRun(controller)))
  })

  it('opens the map with a recovery warning after a reload mid-encounter that left no save', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    const node = startFirstNode(controller)
    playFirstLand(controller)
    expect(storage.data.has(GAME_KEY)).toBe(false)

    const reloaded = new AppController()
    expect(reloaded.getViewModel().adventure).toMatchObject({ status: 'paused', stage: 'encounter' })
    reloaded.resumeAdventure()

    expect(internals(reloaded).state.game).toBeNull()
    expect(reloaded.getViewModel().status).toBe(recoveryMessage(1))
    expect(reloaded.getViewModel().adventure).toMatchObject({
      status: 'active',
      stage: 'map',
      remainingChances: 3,
      attemptOrdinal: 0,
    })
    expect(actionableIds(reloaded)).toEqual([node.id])

    reloaded.startAdventureNode(node.id)
    expect(liveGame(reloaded)).toEqual(freshAttemptGame(currentRun(reloaded)))
  })

  it('quietly discards a stale save when the run was waiting on the map', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    const node = startFirstNode(controller)
    playFirstLand(controller)
    controller.pauseAdventure()
    const stale = storage.data.get(GAME_KEY)!
    controller.resumeAdventure()
    finishEncounter(controller, 1)
    controller.pauseAdventure()
    // Simulate a removal that failed earlier: the previous attempt's save is still there.
    storage.data.set(GAME_KEY, stale)

    controller.resumeAdventure()

    expect(controller.getViewModel().status).toBe('Adventure resumed at Tier 1.')
    expect(internals(controller).state.game).toBeNull()
    expect(storage.data.has(GAME_KEY)).toBe(false)
    const run = currentRun(controller)
    expect(run.attemptOrdinal).toBe(1)
    expect(run.attemptSeed).toBe(adventureAttemptSeed(run.baseSeed, 0, node.lane, 1))
    controller.startAdventureNode(node.id)
    expect(liveGame(controller)).toEqual(freshAttemptGame(currentRun(controller)))
  })

  it('restores a matching save exactly once even when deleting it fails', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    startFirstNode(controller)
    playFirstLand(controller)
    const paused = structuredClone(liveGame(controller))
    controller.pauseAdventure()
    storage.failingRemoves.add(GAME_KEY)

    controller.resumeAdventure()
    expect(liveGame(controller)).toEqual(paused)
    expect(storage.data.has(GAME_KEY)).toBe(true)
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toMatchObject({ status: 'active', stage: 'encounter' })

    const reloaded = new AppController()
    reloaded.resumeAdventure()
    expect(internals(reloaded).state.game).toBeNull()
    expect(reloaded.getViewModel().status).toBe(recoveryMessage(1))
  })

  it('never restores a bare version 1 game next to a version 2 run', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    const node = startFirstNode(controller)
    playFirstLand(controller)
    const bare = JSON.stringify(liveGame(controller))
    controller.pauseAdventure()
    storage.data.set(GAME_KEY, bare)

    controller.resumeAdventure()

    expect(internals(controller).state.game).toBeNull()
    expect(controller.getViewModel().status).toBe(recoveryMessage(1))
    expect(storage.data.has(GAME_KEY)).toBe(false)
    expect(actionableIds(controller)).toEqual([node.id])
    controller.startAdventureNode(node.id)
    expect(liveGame(controller)).toEqual(freshAttemptGame(currentRun(controller)))
  })

  it('restores the exact map position after a map pause and a reload', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    const node = startFirstNode(controller)
    finishEncounter(controller, 1)
    const before = controller.getViewModel().adventure
    controller.pauseAdventure()
    expect(controller.getViewModel().status).toBe('Adventure paused at Tier 1.')
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toMatchObject({
      status: 'paused',
      stage: 'map',
      selectedNodeId: node.id,
      attemptOrdinal: 1,
    })

    const reloaded = new AppController()
    reloaded.resumeAdventure()

    expect(reloaded.getViewModel().status).toBe('Adventure resumed at Tier 1.')
    const after = reloaded.getViewModel().adventure
    expect(after.tiers).toEqual(before.tiers)
    expect(after).toMatchObject({
      runId: before.runId,
      status: 'active',
      stage: 'map',
      currentTier: 1,
      attemptOrdinal: 1,
      remainingChances: 2,
      activeGameSeed: before.activeGameSeed,
      lastResult: null,
    })
    expect(actionableIds(reloaded)).toEqual([node.id])
  })

  it('never writes Adventure progress when returning to the lobby or starting another mode', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    startFirstNode(controller)
    storage.calls.length = 0

    controller.backToLobby()
    controller.startGame('local-hvh')
    controller.backToLobby()

    expect(adventureCalls(storage)).toEqual([])
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toMatchObject({ status: 'active', stage: 'encounter' })
    expect(controller.getViewModel().adventure).toMatchObject({ status: 'paused', stage: 'encounter', hasSavedRun: true })
  })

  it.each([
    ['mid-game save', GAME_KEY, [`set:${GAME_KEY}`]],
    ['run', RUN_KEY, [`set:${GAME_KEY}`, `set:${RUN_KEY}`, `remove:${GAME_KEY}`]],
  ] as const)('keeps the encounter open when the %s write fails, then pauses exactly once on retry', (_name, key, refusedCalls) => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    startFirstNode(controller)
    playFirstLand(controller)
    const game = liveGame(controller)
    const paused = structuredClone(game)
    const storedRun = storage.data.get(RUN_KEY)
    storage.failingSets.add(key)
    storage.calls.length = 0

    controller.pauseAdventure()

    expect(adventureCalls(storage)).toEqual(refusedCalls)
    expect(controller.getViewModel().status).toBe(`${STORAGE_WARNING} The game was not paused.`)
    expect(controller.getViewModel().mode).toBe('adventure-hvai')
    expect(liveGame(controller)).toBe(game)
    expect(storage.data.get(RUN_KEY)).toBe(storedRun)
    expect(storage.data.has(GAME_KEY)).toBe(false)

    storage.failingSets.delete(key)
    storage.calls.length = 0
    controller.pauseAdventure()
    expect(adventureCalls(storage)).toEqual([`set:${GAME_KEY}`, `set:${RUN_KEY}`])
    expect(controller.getViewModel().mode).toBeNull()
    expect(controller.getViewModel().status).toBe('Adventure paused at Tier 1.')
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toMatchObject({ status: 'paused', stage: 'encounter' })
    expect(storage.data.has(GAME_KEY)).toBe(true)

    // A repeated Pause from a stale control changes nothing.
    storage.calls.length = 0
    controller.pauseAdventure()
    expect(adventureCalls(storage)).toEqual([])
    expect(controller.getViewModel().status).toBe('Adventure paused at Tier 1.')

    // Resume restores the paused game exactly once.
    controller.resumeAdventure()
    expect(adventureCalls(storage)).toEqual([`set:${RUN_KEY}`, `remove:${GAME_KEY}`])
    const restored = liveGame(controller)
    expect(restored).toEqual(paused)
    storage.calls.length = 0
    controller.resumeAdventure()
    expect(adventureCalls(storage)).toEqual([])
    expect(liveGame(controller)).toBe(restored)
  })

  it('never restores the save left by a refused run write whose removal also failed, even after a reload', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    const node = startFirstNode(controller)
    playFirstLand(controller)
    const storedRun = storage.data.get(RUN_KEY)
    storage.failingSets.add(RUN_KEY)
    storage.failingRemoves.add(GAME_KEY)

    controller.pauseAdventure()

    expect(controller.getViewModel().status).toBe(`${STORAGE_WARNING} The game was not paused.`)
    expect(controller.getViewModel().mode).toBe('adventure-hvai')
    // The leftover save names this attempt, but the run was never saved as paused.
    const leftover = storage.data.get(GAME_KEY)
    expect(leftover).toBeDefined()
    expect(storage.data.get(RUN_KEY)).toBe(storedRun)
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toMatchObject({ status: 'active', stage: 'encounter' })

    const reloaded = new AppController()
    reloaded.resumeAdventure()
    expect(internals(reloaded).state.game).toBeNull()
    expect(reloaded.getViewModel().status).toBe(recoveryMessage(1))
    expect(storage.data.get(GAME_KEY)).toBe(leftover)
    reloaded.backToLobby()
    reloaded.resumeAdventure()
    expect(internals(reloaded).state.game).toBeNull()
    expect(reloaded.getViewModel().status).toBe(recoveryMessage(1))

    // The committed attempt restarts, and a later Pause replaces the leftover save.
    storage.failingSets.delete(RUN_KEY)
    reloaded.startAdventureNode(node.id)
    const fresh = structuredClone(liveGame(reloaded))
    expect(fresh).toEqual(freshAttemptGame(currentRun(reloaded)))
    expect(reloaded.getViewModel().adventure).toMatchObject({ remainingChances: 3, attemptOrdinal: 0 })
    reloaded.pauseAdventure()
    expect(storage.data.get(GAME_KEY)).not.toBe(leftover)

    const again = new AppController()
    again.resumeAdventure()
    expect(again.getViewModel().status).toBe('Adventure resumed at Tier 1.')
    expect(liveGame(again)).toEqual(fresh)
  })

  it('keeps the map open when the map pause write fails, then pauses on retry', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    storage.failingSets.add(RUN_KEY)

    controller.pauseAdventure()

    expect(controller.getViewModel().status).toBe(`${STORAGE_WARNING} The Adventure was not paused.`)
    expect(controller.getViewModel().mode).toBe('adventure-hvai')
    expect(controller.getViewModel().adventure).toMatchObject({ status: 'active', stage: 'map' })

    storage.failingSets.delete(RUN_KEY)
    controller.pauseAdventure()
    expect(controller.getViewModel().mode).toBeNull()
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toMatchObject({ status: 'paused', stage: 'map' })
  })

  it('reopens the same map and decision after a fork win and a reload, without writing', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    const [won, bypassed] = advanceToFork(controller)
    controller.startAdventureNode(won.id)
    finishEncounter(controller, 0)
    skipPendingReward(controller)
    const before = controller.getViewModel().adventure
    const open = actionableIds(controller)
    storage.calls.length = 0

    const reloaded = new AppController()
    expect(reloaded.getViewModel().adventure).toMatchObject({ status: 'paused', stage: 'map' })
    reloaded.resumeAdventure()

    expect(adventureCalls(storage)).toEqual([])
    expect(reloaded.getViewModel().status).toBe(`Adventure resumed at Tier ${before.currentTier}.`)
    const after = reloaded.getViewModel().adventure
    expect(after.tiers).toEqual(before.tiers)
    expect(after).toMatchObject({
      status: 'active',
      stage: 'map',
      currentTier: before.currentTier,
      remainingChances: before.remainingChances,
      winStreak: before.winStreak,
      decisionKey: before.decisionKey,
    })
    const forkTier = after.tiers[before.currentTier - 2].nodes
    expect(forkTier.map((node) => `${node.id}:${node.status}`)).toEqual([`${won.id}:completed`, `${bypassed.id}:bypassed`])
    expect(actionableIds(reloaded)).toEqual(open)
  })

  it('starts the retry attempt after a loss and a reload, and never restores the lost attempt', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    const node = startFirstNode(controller)
    playFirstLand(controller)
    controller.pauseAdventure()
    const lost = storage.data.get(GAME_KEY)
    // Every removal fails, so the lost attempt's save stays in the slot.
    storage.failingRemoves.add(GAME_KEY)
    controller.resumeAdventure()
    finishEncounter(controller, 1)
    expect(storage.data.get(GAME_KEY)).toBe(lost)
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toMatchObject({ stage: 'map', attemptOrdinal: 1 })

    const reloaded = new AppController()
    reloaded.resumeAdventure()

    expect(reloaded.getViewModel().status).toBe('Adventure resumed at Tier 1.')
    expect(internals(reloaded).state.game).toBeNull()
    expect(reloaded.getViewModel().adventure).toMatchObject({ remainingChances: 2, attemptOrdinal: 1 })
    reloaded.startAdventureNode(node.id)
    const run = currentRun(reloaded)
    expect(run.attemptSeed).toBe(adventureAttemptSeed(run.baseSeed, 0, node.lane, 1))
    expect(liveGame(reloaded)).toEqual(freshAttemptGame(run))
  })

  it('keeps no run and the high score after a reload once the boss is beaten, and never restores the boss save', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    reachBoss(controller)
    controller.pauseAdventure()
    const boss = storage.data.get(GAME_KEY)
    expect(boss).toBeDefined()
    controller.resumeAdventure()
    finishEncounter(controller, 0)
    const { highScore } = controller.getViewModel().adventure
    expect(controller.getViewModel().adventure).toMatchObject({ status: 'completed', hasSavedRun: false })
    expect(storage.data.has(RUN_KEY)).toBe(false)
    expect(storage.data.get(HIGH_SCORE_KEY)).toBe(String(highScore))
    // Simulate a removal that failed earlier: the boss save is back in the slot.
    storage.data.set(GAME_KEY, boss!)
    storage.calls.length = 0

    const reloaded = new AppController()
    expect(reloaded.getViewModel().adventure).toMatchObject({ status: 'inactive', hasSavedRun: false, highScore })
    reloaded.resumeAdventure()
    expect(reloaded.getViewModel().status).toBe('No paused adventure run found.')
    expect(reloaded.getViewModel().mode).toBeNull()
    expect(internals(reloaded).state.game).toBeNull()
    expect(adventureCalls(storage)).toEqual([])

    reloaded.startAdventure()
    const node = startFirstNode(reloaded)
    reloaded.pauseAdventure()
    storage.data.set(GAME_KEY, boss!)
    const again = new AppController()
    again.resumeAdventure()
    expect(internals(again).state.game).toBeNull()
    expect(again.getViewModel().status).toBe(recoveryMessage(1))
    again.startAdventureNode(node.id)
    expect(liveGame(again)).toEqual(freshAttemptGame(currentRun(again)))
    expect(again.getViewModel().adventure.highScore).toBe(highScore)
  })

  it('restarts the boss attempt after a reload while its win waits to be saved', () => {
    const storage = installTrackedStorage({ [HIGH_SCORE_KEY]: '7' })
    const controller = new AppController()
    controller.startAdventure()
    reachBoss(controller)
    const committed = storage.data.get(RUN_KEY)
    const counters = structuredClone(currentRun(controller))
    const boss = structuredClone(liveGame(controller))
    storage.failingSets.add(HIGH_SCORE_KEY)
    finishEncounter(controller, 0)
    expect(controller.getViewModel().adventure.pendingCompletion).toBe('win')

    // Only memory held the result: the reload finds the committed boss attempt.
    storage.failingSets.delete(HIGH_SCORE_KEY)
    const reloaded = new AppController()
    expect(storage.data.get(RUN_KEY)).toBe(committed)
    expect(storage.data.get(HIGH_SCORE_KEY)).toBe('7')
    expect(reloaded.getViewModel().adventure).toMatchObject({ status: 'paused', stage: 'encounter', highScore: 7 })
    reloaded.resumeAdventure()
    expect(reloaded.getViewModel().status).toBe(recoveryMessage(7))
    reloaded.startAdventureNode(currentRun(reloaded).selectedNodeId!)
    expect(liveGame(reloaded)).toEqual(boss)
    expect(currentRun(reloaded)).toMatchObject({
      currentTierIndex: 6,
      attemptOrdinal: 0,
      remainingChances: counters.remainingChances,
      winStreak: counters.winStreak,
    })
  })
})

describe('Adventure controller branching route', () => {
  installFakeTimerHooks()

  const routes = ADVENTURE_FORK_PATTERNS.flatMap((pattern) => (['left', 'right'] as const).map((lane) => [
    pattern.map((tierIndex) => tierIndex + 1).join(','),
    lane,
    pattern,
  ] as const))

  it.each(routes)('completes a route with forks at tiers %s through the %s lane, bypassing every sibling', (_label, lane, pattern) => {
    vi.setSystemTime(seedForForkPattern(pattern))
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    const baseSeed = currentRun(controller).baseSeed
    const chosen: string[] = []

    for (let tier = 1; tier <= 7; tier += 1) {
      expect(controller.getViewModel().adventure.currentTier).toBe(tier)
      const nodes = actionableNodes(controller)
      const fork = pattern.includes(tier - 1)
      expect(nodes.map((node) => node.status)).toEqual(fork ? ['available', 'available'] : ['current'])
      const node = fork ? nodes.find((entry) => entry.lane === lane)! : nodes[0]
      expect(node.boss).toBe(tier === 7)

      controller.startAdventureNode(node.id)
      expect(controller.getViewModel().status).toBe(`Tier ${tier} encounter started against ${node.opponent.label}.`)
      const run = currentRun(controller)
      expect(run.attemptSeed).toBe(adventureAttemptSeed(baseSeed, tier - 1, node.lane, 0))
      expect(liveGame(controller)).toEqual(freshAttemptGame(run))
      const statuses = controller.getViewModel().adventure.tiers[tier - 1].nodes.map((entry) => entry.status)
      // Starting an encounter commits the fork: the sibling is bypassed.
      expect(statuses).toEqual(fork ? (lane === 'left' ? ['current', 'bypassed'] : ['bypassed', 'current']) : ['current'])
      chosen.push(node.id)

      finishEncounter(controller, 0)
      if (tier < 7) {
        expect(controller.getViewModel().status).toBe(`Encounter won. Choose a reward or skip it to continue to Tier ${tier + 1}.`)
        expect(actionableIds(controller)).toEqual([])
        skipPendingReward(controller)
        expect(controller.getViewModel().status).toBe(`Reward skipped. Choose your Tier ${tier + 1} encounter.`)
      }
    }

    const view = controller.getViewModel()
    // Five score-eligible chances (wins three and six add one) and seven encounters.
    expect(view.status).toBe('Adventure completed! Score: 535. High score: 535.')
    expect(view.adventure).toMatchObject({ status: 'completed', remainingChances: 5, hasSavedRun: false })
    for (const tier of view.adventure.tiers) {
      for (const node of tier.nodes) {
        expect(node.status).toBe(chosen.includes(node.id) ? 'completed' : 'bypassed')
      }
    }
    expect(actionableIds(controller)).toEqual([])
    expect(storage.data.has(RUN_KEY)).toBe(false)
    expect(storage.data.get(HIGH_SCORE_KEY)).toBe('535')
  })

  it.each(['loss', 'draw'] as const)('keeps a fork committed to the chosen node after a %s, also after a reload', (outcome) => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    const [chosen, sibling] = advanceToFork(controller)
    const tier = chosen.tierIndex + 1
    controller.startAdventureNode(chosen.id)
    finishEncounter(controller, winnerFor(outcome))

    expect(controller.getViewModel().status).toBe(outcome === 'loss'
      ? `Encounter lost. 2 chances left. Retry Tier ${tier}.`
      : `Encounter ended in a draw. No chance was used. Retry Tier ${tier}.`)
    const expectRetryOnly = (target: AppController) => {
      expect(actionableIds(target)).toEqual([chosen.id])
      const statuses = target.getViewModel().adventure.tiers[tier - 1].nodes.map((node) => [node.id, node.status])
      expect(statuses).toContainEqual([chosen.id, 'current'])
      expect(statuses).toContainEqual([sibling.id, 'bypassed'])
    }
    expectRetryOnly(controller)

    const storedRun = storage.data.get(RUN_KEY)
    controller.startAdventureNode(sibling.id)
    expect(controller.getViewModel().status).toBe(UNAVAILABLE_NODE)
    expect(internals(controller).state.game).toBeNull()
    expect(storage.data.get(RUN_KEY)).toBe(storedRun)

    controller.pauseAdventure()
    const reloaded = new AppController()
    reloaded.resumeAdventure()
    expectRetryOnly(reloaded)
    reloaded.startAdventureNode(sibling.id)
    expect(reloaded.getViewModel().status).toBe(UNAVAILABLE_NODE)
    expect(internals(reloaded).state.game).toBeNull()

    reloaded.startAdventureNode(chosen.id)
    const run = currentRun(reloaded)
    expect(run).toMatchObject({
      selectedNodeId: chosen.id,
      attemptOrdinal: 1,
      attemptSeed: adventureAttemptSeed(run.baseSeed, tier - 1, chosen.lane, 1),
    })
    expect(liveGame(reloaded)).toEqual(freshAttemptGame(run))
  })

  it('starts at most one encounter for tampered, duplicate and stale activations', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    const runId = currentRun(controller).runId
    const [first, second] = advanceToFork(controller)
    // A repeated Start or Resume while the map is open keeps the run.
    controller.startAdventure()
    controller.resumeAdventure()
    expect(currentRun(controller).runId).toBe(runId)
    const storedRun = storage.data.get(RUN_KEY)

    const tampered: unknown[] = [
      '',
      ` ${first.id}`,
      first.id.toUpperCase(),
      `${first.id}-x`,
      'tier-7-center',
      'tier-9-center',
      null,
      42,
      { id: first.id },
    ]
    for (const nodeId of tampered) {
      controller.reportStatus('')
      controller.startAdventureNode(nodeId as string)
      expect(controller.getViewModel().status).toBe(UNAVAILABLE_NODE)
    }
    expect(internals(controller).state.game).toBeNull()
    expect(storage.data.get(RUN_KEY)).toBe(storedRun)

    storage.calls.length = 0
    controller.startAdventureNode(first.id)
    const game = liveGame(controller)
    controller.startAdventureNode(first.id)
    controller.startAdventureNode(second.id)
    controller.startAdventure()
    controller.resumeAdventure()

    expect(liveGame(controller)).toBe(game)
    expect(adventureCalls(storage)).toEqual([`set:${RUN_KEY}`, `remove:${GAME_KEY}`])
    expect(currentRun(controller)).toMatchObject({ runId, selectedNodeId: first.id, attemptOrdinal: 0 })
  })

  it('uses no attempt when the node write is refused and keeps both fork choices', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    const [first, second] = advanceToFork(controller)
    const before = controller.getViewModel().adventure
    const storedRun = storage.data.get(RUN_KEY)
    storage.failingSets.add(RUN_KEY)

    controller.startAdventureNode(first.id)

    expect(controller.getViewModel().status).toBe(`${STORAGE_WARNING} The encounter did not start.`)
    expect(internals(controller).state.game).toBeNull()
    expect(controller.getViewModel().adventure).toEqual(before)
    expect(storage.data.get(RUN_KEY)).toBe(storedRun)
    expect(actionableIds(controller)).toEqual([first.id, second.id])

    storage.failingSets.delete(RUN_KEY)
    controller.startAdventureNode(second.id)
    const run = currentRun(controller)
    expect(run).toMatchObject({
      selectedNodeId: second.id,
      attemptOrdinal: 0,
      attemptSeed: adventureAttemptSeed(run.baseSeed, second.tierIndex, second.lane, 0),
    })
    expect(liveGame(controller)).toEqual(freshAttemptGame(run))
  })

  it.each([
    ['win', 'Encounter won. Choose a reward or skip it to continue to Tier 2.', 'reward'],
    ['loss', 'Encounter lost. 2 chances left. Retry Tier 1.', 'map'],
    ['draw', 'Encounter ended in a draw. No chance was used. Retry Tier 1.', 'map'],
  ] as const)('keeps a %s pending until it is saved, then applies it exactly once', (outcome, status, stage) => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    startFirstNode(controller)
    const before = structuredClone(currentRun(controller))
    const storedRun = storage.data.get(RUN_KEY)
    storage.failingSets.add(RUN_KEY)

    finishEncounter(controller, winnerFor(outcome))

    const board = liveGame(controller)
    expect(board.phase).toBe('gameOver')
    expect(controller.getViewModel().status).toBe(resultWarning(outcome))
    expect(controller.getViewModel().adventure).toMatchObject({
      status: 'active',
      stage: 'encounter',
      pendingCompletion: outcome,
      lastResult: null,
    })
    expect(storage.data.get(RUN_KEY)).toBe(storedRun)
    expectPendingBlocksNavigation(controller, board)

    controller.retryAdventureCompletion()
    expect(controller.getViewModel().status).toBe(resultWarning(outcome))
    expect(controller.getViewModel().adventure.pendingCompletion).toBe(outcome)
    expect(liveGame(controller)).toBe(board)
    // A refusal straight after the same refusal changes the text, so it is announced again.
    controller.retryAdventureCompletion()
    expect(controller.getViewModel().status).toBe(resultWarningAgain(outcome))
    controller.retryAdventureCompletion()
    expect(controller.getViewModel().status).toBe(resultWarningAgain(outcome))
    expect(controller.getViewModel().adventure.pendingCompletion).toBe(outcome)

    storage.failingSets.delete(RUN_KEY)
    controller.retryAdventureCompletion()

    const expected = applyAdventureEncounterResult(before, outcome)
    expect(controller.getViewModel().status).toBe(`Result saved. ${status}`)
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toEqual(expected)
    expect(currentRun(controller)).toEqual(expected)
    expect(internals(controller).state.game).toBeNull()
    expect(controller.getViewModel().adventure).toMatchObject({ pendingCompletion: null, stage })
    expect(controller.getViewModel().adventure.lastResult).toMatchObject({ outcome, tierIndex: 0, score: null })

    storage.calls.length = 0
    controller.retryAdventureCompletion()
    expect(adventureCalls(storage)).toEqual([])
    expect(currentRun(controller)).toEqual(expected)
  })

  it.each([
    ['boss win', 'win', '7'],
    ['final loss', 'loss', '900'],
  ] as const)('keeps a terminal %s pending until the high score and the run removal are both saved', (_name, outcome, storedHighScore) => {
    const storage = installTrackedStorage({ [HIGH_SCORE_KEY]: storedHighScore })
    const controller = new AppController()
    controller.startAdventure()
    if (outcome === 'win') {
      reachBoss(controller)
    } else {
      reachLastChance(controller)
    }
    const before = structuredClone(currentRun(controller))
    const expectedRun = applyAdventureEncounterResult(before, outcome)
    const score = computeAdventureScore(expectedRun)
    const highScore = Math.max(Number(storedHighScore), score)
    const storedRun = storage.data.get(RUN_KEY)
    storage.failingSets.add(HIGH_SCORE_KEY)

    finishEncounter(controller, winnerFor(outcome))

    const board = liveGame(controller)
    expect(controller.getViewModel().status).toBe(resultWarning(outcome))
    expect(controller.getViewModel().adventure).toMatchObject({
      status: 'active',
      stage: 'encounter',
      pendingCompletion: outcome,
    })
    expect(storage.data.get(HIGH_SCORE_KEY)).toBe(storedHighScore)
    expect(storage.data.get(RUN_KEY)).toBe(storedRun)
    expectPendingBlocksNavigation(controller, board)

    storage.failingSets.delete(HIGH_SCORE_KEY)
    storage.failingRemoves.add(RUN_KEY)
    controller.retryAdventureCompletion()
    expect(controller.getViewModel().status).toBe(resultWarning(outcome))
    expect(storage.data.get(HIGH_SCORE_KEY)).toBe(String(highScore))
    expect(storage.data.get(RUN_KEY)).toBe(storedRun)
    expect(liveGame(controller)).toBe(board)

    // An unreadable slot after a refused removal cannot confirm the run is gone.
    storage.failingGets.add(RUN_KEY)
    controller.retryAdventureCompletion()
    expect(controller.getViewModel().status).toBe(resultWarningAgain(outcome))
    expect(controller.getViewModel().adventure.pendingCompletion).toBe(outcome)
    expect(storage.data.get(RUN_KEY)).toBe(storedRun)
    expect(liveGame(controller)).toBe(board)

    storage.failingGets.delete(RUN_KEY)
    storage.failingRemoves.delete(RUN_KEY)
    controller.retryAdventureCompletion()

    const heading = outcome === 'win' ? 'Adventure completed!' : 'Adventure failed.'
    expect(controller.getViewModel().status).toBe(`Result saved. ${heading} Score: ${score}. High score: ${highScore}.`)
    expect(storage.data.has(RUN_KEY)).toBe(false)
    expect(storage.data.get(HIGH_SCORE_KEY)).toBe(String(highScore))
    expect(internals(controller).state.game).toBeNull()
    expect(controller.getViewModel().mode).toBe('adventure-hvai')
    expect(controller.getViewModel().adventure).toMatchObject({
      status: outcome === 'win' ? 'completed' : 'failed',
      pendingCompletion: null,
      hasSavedRun: false,
      highScore,
    })
    expect(controller.getViewModel().adventure.lastResult).toMatchObject({ outcome, score })
    expect(currentRun(controller)).toEqual(expectedRun)

    storage.calls.length = 0
    controller.retryAdventureCompletion()
    expect(storage.calls).toEqual([])
  })

  it('treats a refused run removal as reset only when a read confirms the slot is empty', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    const storedRun = storage.data.get(RUN_KEY)
    storage.failingRemoves.add(RUN_KEY)
    storage.failingGets.add(RUN_KEY)

    controller.abandonAdventure()

    expect(controller.getViewModel().status).toBe('Adventure run could not be reset (storage unavailable).')
    expect(storage.data.get(RUN_KEY)).toBe(storedRun)

    storage.failingGets.delete(RUN_KEY)
    storage.data.delete(RUN_KEY)
    controller.startAdventure()
    storage.data.delete(RUN_KEY)

    controller.abandonAdventure()

    expect(controller.getViewModel().status).toBe('Adventure run reset.')
    expect(controller.getViewModel().adventure).toMatchObject({ status: 'inactive', hasSavedRun: false })
  })

  it('resets the run while a result waits to be saved', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    startFirstNode(controller)
    storage.failingSets.add(RUN_KEY)
    finishEncounter(controller, 0)
    expect(controller.getViewModel().adventure.pendingCompletion).toBe('win')

    controller.abandonAdventure()

    const view = controller.getViewModel()
    expect(view.status).toBe('Adventure run reset.')
    expect(view.mode).toBeNull()
    expect(view.adventure).toMatchObject({ status: 'inactive', pendingCompletion: null, hasSavedRun: false })
    expect(storage.data.has(RUN_KEY)).toBe(false)

    storage.failingSets.delete(RUN_KEY)
    controller.retryAdventureCompletion()
    expect(storage.data.has(RUN_KEY)).toBe(false)
  })
})

describe('Adventure controller rewards', () => {
  installFakeTimerHooks()

  const CLOCK = 1_770_000_000_000
  const REWARD_PENDING = 'Choose a reward or skip it before starting the next encounter.'
  const UNAVAILABLE_REWARD = 'That reward is not available. Choose an offered reward or skip it.'

  /** A clock value whose first offer, after winning the first node, includes `rewardId`. */
  function clockOfferingFirst(rewardId: AdventureRewardId): number {
    for (let seed = CLOCK; seed < CLOCK + 1_000; seed += 1) {
      const nodeId = generateBranchingAdventureMap(seed).tiers[0].nodes[0].id
      if (generateAdventureRewardOffer(seed, nodeId, { relics: [], rewardHistory: [] }).choices.includes(rewardId)) {
        return seed
      }
    }
    throw new Error(`No clock value offers ${rewardId} first.`)
  }

  interface FirstOffer {
    storage: TrackedStorage
    controller: AppController
    offer: AdventureRewardOfferSummary
  }

  /** Starts a run at `clock`, wins its first encounter and returns the pending offer. */
  function firstOffer(clock = CLOCK): FirstOffer {
    vi.setSystemTime(clock)
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    startFirstNode(controller)
    finishEncounter(controller, 0)
    const offer = controller.getViewModel().adventure.pendingReward
    if (!offer) {
      throw new Error('Expected a pending reward.')
    }
    return { storage, controller, offer }
  }

  function claimFirst(rewardId: AdventureRewardId): FirstOffer {
    const first = firstOffer(clockOfferingFirst(rewardId))
    first.controller.chooseAdventureReward(first.offer.offerId, rewardId)
    expect(currentRun(first.controller).rewardHistory.at(-1)?.rewardId).toBe(rewardId)
    return first
  }

  it('waits at the reward stage after a non-boss win, with the offer saved', () => {
    const { storage, controller, offer } = firstOffer()
    const view = controller.getViewModel()
    const run = currentRun(controller)

    expect(view.status).toBe('Encounter won. Choose a reward or skip it to continue to Tier 2.')
    expect(view.adventure).toMatchObject({ status: 'active', stage: 'reward', currentTier: 2, relics: [] })
    expect(view.adventure.lastResult).toMatchObject({ outcome: 'win', chanceLossPrevented: false, streakResetPrevented: false })
    expect(offer).toMatchObject({ offerId: run.pendingReward?.offerId, sourceTier: 1 })
    expect(offer.choices.map((choice) => choice.id)).toEqual(run.pendingReward?.choices)
    expect(actionableIds(controller)).toEqual([])
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toEqual(run)
  })

  it('claims a reward storage first, then opens the next tier', () => {
    const { storage, controller, offer } = firstOffer()
    const before = currentRun(controller)
    const choice = offer.choices[0]
    storage.calls.length = 0

    controller.chooseAdventureReward(offer.offerId, choice.id)

    const run = currentRun(controller)
    expect(adventureCalls(storage)).toEqual([`set:${RUN_KEY}`])
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toEqual(run)
    expect(controller.getViewModel().status).toBe(`${choice.name} claimed. Choose your Tier 2 encounter.`)
    expect(controller.getViewModel().adventure).toMatchObject({ stage: 'map', pendingReward: null, lastResult: null })
    expect(run.rewardHistory).toEqual([{ sourceNodeId: before.completedNodeIds[0], rewardId: choice.id }])
    expect(actionableIds(controller).length).toBeGreaterThan(0)
  })

  it('skips a reward storage first, changing only the history', () => {
    const { storage, controller, offer } = firstOffer()
    const before = currentRun(controller)
    storage.calls.length = 0

    controller.skipAdventureReward(offer.offerId)

    expect(adventureCalls(storage)).toEqual([`set:${RUN_KEY}`])
    expect(controller.getViewModel().status).toBe('Reward skipped. Choose your Tier 2 encounter.')
    expect(currentRun(controller)).toEqual({
      ...before,
      stage: 'map',
      pendingReward: null,
      rewardHistory: [{ sourceNodeId: before.completedNodeIds[0], rewardId: null }],
    })
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toEqual(currentRun(controller))
  })

  it.each([
    ['claim', 'claimed'],
    ['skip', 'skipped'],
  ] as const)('keeps the same offer when the %s write is refused, then resolves it on retry', (action, verb) => {
    const { storage, controller, offer } = firstOffer()
    const sourceNodeId = currentRun(controller).completedNodeIds[0]
    const resolveOffer = () => {
      if (action === 'claim') {
        controller.chooseAdventureReward(offer.offerId, offer.choices[1].id)
      } else {
        controller.skipAdventureReward(offer.offerId)
      }
    }
    const before = controller.getViewModel().adventure
    const storedRun = storage.data.get(RUN_KEY)
    storage.failingSets.add(RUN_KEY)

    resolveOffer()

    expect(controller.getViewModel().status).toBe(`${STORAGE_WARNING} The reward was not ${verb}.`)
    expect(controller.getViewModel().adventure).toEqual(before)
    expect(storage.data.get(RUN_KEY)).toBe(storedRun)

    storage.failingSets.delete(RUN_KEY)
    resolveOffer()

    expect(controller.getViewModel().adventure).toMatchObject({ stage: 'map', pendingReward: null })
    expect(currentRun(controller).rewardHistory).toEqual([
      { sourceNodeId, rewardId: action === 'claim' ? offer.choices[1].id : null },
    ])
  })

  it('resolves at most one reward for tampered, duplicate and stale activations', () => {
    const { storage, controller, offer } = firstOffer()
    const storedRun = storage.data.get(RUN_KEY)
    const status = controller.getViewModel().status
    const offered = offer.choices.map((choice) => choice.id)
    const notOffered = ADVENTURE_REWARD_IDS.find((id) => !offered.includes(id))

    // Another offer ID is stale input: nothing changes, silently.
    for (const offerId of ['', ` ${offer.offerId}`, offer.offerId.toUpperCase(), `${offer.offerId}-x`, 'reward-2-tier-2-center', null, 42]) {
      controller.chooseAdventureReward(offerId as string, offered[0])
      controller.skipAdventureReward(offerId as string)
    }
    expect(controller.getViewModel().status).toBe(status)
    // A reward outside the current offer is refused with a notice.
    for (const rewardId of ['', 'lucky-coin', notOffered, offered[0].toUpperCase(), null, '__proto__']) {
      controller.reportStatus('')
      controller.chooseAdventureReward(offer.offerId, rewardId as string)
      expect(controller.getViewModel().status).toBe(UNAVAILABLE_REWARD)
    }
    expect(storage.data.get(RUN_KEY)).toBe(storedRun)
    expect(currentRun(controller).stage).toBe('reward')

    storage.calls.length = 0
    controller.chooseAdventureReward(offer.offerId, offered[0])
    const claimed = currentRun(controller)
    controller.chooseAdventureReward(offer.offerId, offered[1])
    controller.skipAdventureReward(offer.offerId)
    expect(adventureCalls(storage)).toEqual([`set:${RUN_KEY}`])
    expect(currentRun(controller)).toBe(claimed)

    // The earlier offer stays inert at the next reward stage.
    startFirstNode(controller)
    finishEncounter(controller, 0)
    const next = controller.getViewModel().adventure.pendingReward
    expect(next?.offerId).not.toBe(offer.offerId)
    storage.calls.length = 0
    controller.skipAdventureReward(offer.offerId)
    controller.chooseAdventureReward(offer.offerId, next?.choices[0].id ?? '')
    expect(adventureCalls(storage)).toEqual([])
    expect(currentRun(controller).pendingReward?.offerId).toBe(next?.offerId)
  })

  it('starts no encounter until the reward is resolved', () => {
    const { storage, controller } = firstOffer()
    const nextTier = currentRun(controller).map.tiers[1].nodes.map((node) => node.id)
    storage.calls.length = 0

    for (const nodeId of nextTier) {
      controller.reportStatus('')
      controller.startAdventureNode(nodeId)
      expect(controller.getViewModel().status).toBe(REWARD_PENDING)
    }
    expect(adventureCalls(storage)).toEqual([])
    expect(internals(controller).state.game).toBeNull()
    expect(currentRun(controller).stage).toBe('reward')
  })

  it('keeps the reward waiting in the lobby and after a pause and a reload', () => {
    const { storage, controller, offer } = firstOffer()

    controller.backToLobby()
    storage.calls.length = 0
    controller.chooseAdventureReward(offer.offerId, offer.choices[0].id)
    controller.skipAdventureReward(offer.offerId)
    expect(adventureCalls(storage)).toEqual([])
    expect(controller.getViewModel().adventure).toMatchObject({ stage: 'reward', pendingReward: offer })

    controller.resumeAdventure()
    expect(controller.getViewModel().status).toBe('Adventure resumed. Choose a reward or skip it to continue to Tier 2.')
    controller.pauseAdventure()
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toMatchObject({ status: 'paused', stage: 'reward' })

    const reloaded = new AppController()
    expect(reloaded.getViewModel().adventure).toMatchObject({ status: 'paused', stage: 'reward', pendingReward: offer })
    reloaded.resumeAdventure()
    expect(reloaded.getViewModel().status).toBe('Adventure resumed. Choose a reward or skip it to continue to Tier 2.')
    expect(reloaded.getViewModel().adventure).toMatchObject({ status: 'active', stage: 'reward', pendingReward: offer })

    reloaded.skipAdventureReward(offer.offerId)
    expect(reloaded.getViewModel().status).toBe('Reward skipped. Choose your Tier 2 encounter.')
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toMatchObject({ status: 'active', stage: 'map', pendingReward: null })
  })

  it.each([
    ['guardian-sigil', 'Encounter lost. Guardian Sigil used its last charge to keep your chance. 3 chances left. Retry Tier 2.', true, false],
    ['streak-anchor', 'Encounter lost. Streak Anchor used its last charge to keep your win streak. 2 chances left. Retry Tier 2.', false, true],
  ] as const)('reports %s keeping a loss', (rewardId, status, chanceLossPrevented, streakResetPrevented) => {
    const { controller } = claimFirst(rewardId)
    expect(controller.getViewModel().adventure.relics).toEqual([
      expect.objectContaining({ id: rewardId, charges: 1, maxCharges: 2 }),
    ])

    startFirstNode(controller)
    finishEncounter(controller, 1)

    const view = controller.getViewModel()
    expect(view.status).toBe(status)
    expect(view.adventure.lastResult).toMatchObject({
      outcome: 'loss', chanceLossPrevented, streakResetPrevented, relicsUsed: [{ id: rewardId, chargesLeft: 0 }],
    })
    expect(view.adventure.relics).toEqual([])
  })

  it.each(ADVENTURE_REWARD_IDS)('claims %s, saves and shows it, and deals the next encounter with it', (rewardId) => {
    const { storage, controller } = claimFirst(rewardId)
    const entry = adventureRewardCatalogEntry(rewardId)
    const claimed = currentRun(controller)
    const view = controller.getViewModel()

    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toEqual(claimed)
    expect(view.status).toBe(`${entry.name} claimed. Choose your Tier 2 encounter.`)
    if (rewardId === 'second-wind') {
      // A boon adds a real chance only; the score keeps the reward-free count.
      expect(view.adventure).toMatchObject({ remainingChances: 4, relics: [] })
      expect(claimed.scoreEligibleChances).toBe(3)
    } else {
      expect(view.adventure).toMatchObject({ remainingChances: 3 })
      expect(view.adventure.relics).toEqual([
        expect.objectContaining({ id: rewardId, name: entry.name, rulesText: entry.rulesText }),
      ])
    }

    startFirstNode(controller)
    const started = currentRun(controller)
    const launch = adventureEncounterLaunch(started)
    const hand = liveGame(controller).players[0].hand

    expect(started.encounterSetup).toEqual(planAdventureEncounterSetup(claimed.relics).setup)
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toEqual(started)
    expect(liveGame(controller)).toEqual(createInitialGame(launch.seed, launch.decks, launch.options))
    expect(hand).toHaveLength(started.encounterSetup?.playerOpeningHandSize ?? 0)
    for (const land of started.encounterSetup?.guaranteedCreatures ?? []) {
      expect(hand.map((card) => card.name)).toContain(land)
    }
  })

  it("uses a Scout's Cache charge once for an attempt and keeps its deal for a restart", () => {
    const { storage, controller } = claimFirst('scout-cache')
    const node = startFirstNode(controller)
    const game = structuredClone(liveGame(controller))

    expect(controller.getViewModel().status).toBe(
      `Tier 2 encounter started against ${node.opponent.label}. Scout's Cache used its last charge to draw 2 extra opening cards.`,
    )
    expect(game.players[0].hand).toHaveLength(7)
    expect(game.players[1].hand).toHaveLength(5)
    expect(controller.getViewModel().adventure.relics).toEqual([])

    // Leaving without Pause loses the game; the same attempt restarts.
    controller.backToLobby()
    controller.resumeAdventure()
    expect(controller.getViewModel().status).toBe(recoveryMessage(2))
    storage.calls.length = 0
    controller.startAdventureNode(node.id)

    expect(controller.getViewModel().status).toBe(`Tier 2 encounter started against ${node.opponent.label}. Same opening as before.`)
    expect(liveGame(controller)).toEqual(game)
    expect(currentRun(controller).encounterSetup).toEqual({ playerOpeningHandSize: 7, guaranteedCreatures: [] })
  })

  it('reports the charges a relic has left and uses none for a restart', () => {
    // Guardian Sigil taken after tiers 1 and 2 holds two charges at tier 3.
    const run = pauseAdventureRun(claimed(applyAdventureEncounterResult(malformedBase('relicEncounter'), 'win'), 'guardian-sigil'))
    expect(run.relics).toEqual([{ id: 'guardian-sigil', charges: 2 }])
    const storage = installTrackedStorage({ [RUN_KEY]: JSON.stringify(run) })
    const controller = new AppController()
    controller.resumeAdventure()
    const node = startFirstNode(controller)
    const started = `Tier 3 encounter started against ${node.opponent.label}.`
    expect(controller.getViewModel().status).toBe(started)

    // Leaving without Pause loses the game; the restart uses no chance and no charge.
    controller.backToLobby()
    controller.resumeAdventure()
    expect(controller.getViewModel().status).toBe(recoveryMessage(3, true))
    controller.startAdventureNode(node.id)
    expect(controller.getViewModel().status).toBe(`${started} Same opening as before; no relic charge used.`)
    expect(currentRun(controller).relics).toEqual([{ id: 'guardian-sigil', charges: 2 }])

    finishEncounter(controller, 1)
    const view = controller.getViewModel()
    expect(view.status).toBe('Encounter lost. Guardian Sigil used a charge to keep your chance (1 left). 3 chances left. Retry Tier 3.')
    expect(view.adventure.lastResult).toMatchObject({
      outcome: 'loss', chanceLossPrevented: true, relicsUsed: [{ id: 'guardian-sigil', chargesLeft: 1 }],
    })
    expect(view.adventure.relics).toEqual([expect.objectContaining({ id: 'guardian-sigil', charges: 1 })])
    expect(storedJson<AdventureRunState>(storage, RUN_KEY).relics).toEqual([{ id: 'guardian-sigil', charges: 1 }])

    // The retry after a loss is a new attempt, not a restart.
    startFirstNode(controller)
    expect(controller.getViewModel().status).toBe(started)
  })

  it('keeps a pending reward through a reload without Pause and claims it exactly once', () => {
    const { storage, controller, offer } = firstOffer(clockOfferingFirst('guardian-sigil'))
    const sourceNodeId = currentRun(controller).completedNodeIds[0]
    storage.calls.length = 0

    const reloaded = new AppController()
    expect(reloaded.getViewModel().adventure).toMatchObject({ status: 'paused', stage: 'reward', pendingReward: offer })
    reloaded.resumeAdventure()
    expect(adventureCalls(storage)).toEqual([])
    expect(reloaded.getViewModel().status).toBe('Adventure resumed. Choose a reward or skip it to continue to Tier 2.')
    expect(reloaded.getViewModel().adventure).toMatchObject({ status: 'active', stage: 'reward', pendingReward: offer })

    reloaded.chooseAdventureReward(offer.offerId, 'guardian-sigil')
    reloaded.chooseAdventureReward(offer.offerId, 'guardian-sigil')
    reloaded.skipAdventureReward(offer.offerId)
    expect(adventureCalls(storage)).toEqual([`set:${RUN_KEY}`])

    const again = new AppController()
    expect(again.getViewModel().adventure).toMatchObject({ status: 'paused', stage: 'map', pendingReward: null })
    expect(again.getViewModel().adventure.relics).toEqual([
      expect.objectContaining({ id: 'guardian-sigil', charges: 1 }),
    ])
    expect(currentRun(again).rewardHistory).toEqual([{ sourceNodeId, rewardId: 'guardian-sigil' }])
  })

  it("keeps the deal of a used Scout's Cache charge through a reload, and a Pause and a reload", () => {
    const { storage, controller } = claimFirst('scout-cache')
    const node = startFirstNode(controller)
    const committed = storedJson<AdventureRunState>(storage, RUN_KEY)
    const opening = structuredClone(liveGame(controller))
    expect(opening.players[0].hand).toHaveLength(7)
    expect(committed).toMatchObject({ relics: [], encounterSetup: { playerOpeningHandSize: 7 } })

    // Closing the tab without Pause loses the game; the attempt restarts with its deal.
    const reloaded = new AppController()
    reloaded.resumeAdventure()
    expect(reloaded.getViewModel().status).toBe(recoveryMessage(2))
    reloaded.startAdventureNode(node.id)
    expect(liveGame(reloaded)).toEqual(opening)
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toEqual(committed)

    playFirstLand(reloaded)
    const paused = structuredClone(liveGame(reloaded))
    reloaded.pauseAdventure()
    const again = new AppController()
    again.resumeAdventure()
    expect(again.getViewModel().status).toBe('Adventure resumed at Tier 2.')
    expect(liveGame(again)).toEqual(paused)
    expect(currentRun(again)).toMatchObject({ relics: [], encounterSetup: committed.encounterSetup })
  })

  it.each([
    ['guardian-sigil', { remainingChances: 3, winStreak: 0 }, { remainingChances: 2, winStreak: 0 }],
    ['streak-anchor', { remainingChances: 2, winStreak: 1 }, { remainingChances: 1, winStreak: 0 }],
  ] as const)('applies the %s protection exactly once across a reload', (rewardId, protectedCounters, nextCounters) => {
    const { storage, controller } = claimFirst(rewardId)
    const node = startFirstNode(controller)
    finishEncounter(controller, 1)
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toMatchObject({
      ...protectedCounters,
      stage: 'map',
      attemptOrdinal: 1,
      relics: [],
    })

    const reloaded = new AppController()
    expect(reloaded.getViewModel().adventure).toMatchObject({ ...protectedCounters, attemptOrdinal: 1, relics: [] })
    reloaded.resumeAdventure()
    reloaded.startAdventureNode(node.id)
    expect(liveGame(reloaded)).toEqual(freshAttemptGame(currentRun(reloaded)))
    finishEncounter(reloaded, 1)

    expect(reloaded.getViewModel().adventure).toMatchObject({ ...nextCounters, attemptOrdinal: 2, relics: [] })
    expect(reloaded.getViewModel().adventure.lastResult).toMatchObject({
      chanceLossPrevented: false,
      streakResetPrevented: false,
    })
  })

  it('records a relic-modified encounter that replays from its own snapshot, without reward data', () => {
    const { controller } = claimFirst('prepared-pack')
    startFirstNode(controller)
    const opening = structuredClone(liveGame(controller))
    expect(opening.players[0].hand).toHaveLength(6)
    expect(opening.players[1].hand).toHaveLength(5)
    playFirstLand(controller)
    const played = structuredClone(liveGame(controller))

    const json = controller.exportRecordingJson()
    if (!json) {
      throw new Error('Expected an exported recording.')
    }
    const record = JSON.parse(json) as { metadata: Record<string, unknown>; initialState: GameState; timeline: unknown[] }
    expect(Object.keys(record.metadata).sort())
      .toEqual(['aiLevel', 'completed', 'controllers', 'mode', 'seed', 'startedAt', 'updatedAt'])
    expect(json).not.toMatch(/relic|reward|prepared|scout|sigil|anchor|charm/i)
    expect(record.initialState).toEqual(opening)
    expect(record.timeline).toHaveLength(1)

    // Another session replays it like any recording, from the stored states.
    installTrackedStorage()
    const viewer = new AppController()
    viewer.importRecordingJson(json)
    expect(internals(viewer).state.game).toEqual(opening)
    viewer.jumpReplayToEnd()
    expect(internals(viewer).state.game).toEqual(played)
  })
})

describe('Adventure controller repeated refusals', () => {
  installFakeTimerHooks()

  interface Refusal {
    readonly controller: AppController
    readonly act: () => void
  }

  /** Starts a run and runs `prepare` with working storage, then `refuse` breaks it. */
  function startedRun(refuse: (storage: TrackedStorage) => void, prepare: (controller: AppController) => void = () => {}): AppController {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    prepare(controller)
    refuse(storage)
    return controller
  }

  const cases: readonly (readonly [string, () => Refusal, string, string])[] = [
    ['Start Adventure', () => {
      const storage = installTrackedStorage()
      storage.failingSets.add(RUN_KEY)
      const controller = new AppController()
      return { controller, act: () => controller.startAdventure() }
    }, `${STORAGE_WARNING} The Adventure did not start.`, `${STORAGE_WARNING_AGAIN} The Adventure did not start.`],
    ['a node start', () => {
      const controller = startedRun((storage) => storage.failingSets.add(RUN_KEY))
      return { controller, act: () => startFirstNode(controller) }
    }, `${STORAGE_WARNING} The encounter did not start.`, `${STORAGE_WARNING_AGAIN} The encounter did not start.`],
    ['a reward skip', () => {
      const controller = startedRun((storage) => storage.failingSets.add(RUN_KEY), (started) => {
        startFirstNode(started)
        finishEncounter(started, 0)
      })
      const offerId = controller.getViewModel().adventure.pendingReward?.offerId ?? ''
      return { controller, act: () => controller.skipAdventureReward(offerId) }
    }, `${STORAGE_WARNING} The reward was not skipped.`, `${STORAGE_WARNING_AGAIN} The reward was not skipped.`],
    ['a mid-game Pause', () => {
      const controller = startedRun((storage) => storage.failingSets.add(GAME_KEY), (started) => startFirstNode(started))
      return { controller, act: () => controller.pauseAdventure() }
    }, `${STORAGE_WARNING} The game was not paused.`, `${STORAGE_WARNING_AGAIN} The game was not paused.`],
    ['a map Pause', () => {
      const controller = startedRun((storage) => storage.failingSets.add(RUN_KEY))
      return { controller, act: () => controller.pauseAdventure() }
    }, `${STORAGE_WARNING} The Adventure was not paused.`, `${STORAGE_WARNING_AGAIN} The Adventure was not paused.`],
    ['Resume', () => {
      startedRun((storage) => storage.failingSets.add(RUN_KEY), (started) => {
        startFirstNode(started)
        started.pauseAdventure()
      })
      const controller = new AppController()
      return { controller, act: () => controller.resumeAdventure() }
    }, `${STORAGE_WARNING} The Adventure was not resumed.`, `${STORAGE_WARNING_AGAIN} The Adventure was not resumed.`],
    ['Reset', () => {
      const controller = startedRun((storage) => storage.failingRemoves.add(RUN_KEY))
      return { controller, act: () => controller.abandonAdventure() }
    }, 'Adventure run could not be reset (storage unavailable).', 'Adventure run still could not be reset (storage unavailable).'],
  ]

  it.each(cases)('says "still" when %s is refused again, so the repeat is announced', (_name, arrange, first, again) => {
    const { controller, act } = arrange()

    act()
    expect(controller.getViewModel().status).toBe(first)
    act()
    expect(controller.getViewModel().status).toBe(again)
    act()
    expect(controller.getViewModel().status).toBe(again)
  })
})

describe('Adventure controller counters at the safe-integer limit', () => {
  installFakeTimerHooks()

  const LIMIT = Number.MAX_SAFE_INTEGER

  /** The run with every counter at the largest value the guard accepts. */
  function atCounterLimit(run: AdventureRunState): AdventureRunState {
    return {
      ...run,
      remainingChances: LIMIT,
      scoreEligibleChances: LIMIT,
      winStreak: LIMIT,
      scoreEligibleWinStreak: LIMIT,
      totalRoundsPlayed: LIMIT,
      totalCardsPlayed: LIMIT,
    }
  }

  const counters = (run: AdventureRunState): number[] => [
    run.remainingChances, run.scoreEligibleChances, run.winStreak,
    run.scoreEligibleWinStreak, run.totalRoundsPlayed, run.totalCardsPlayed,
  ]

  it('plays a land, pauses, resumes and saves a result without leaving the safe integers', () => {
    const storage = installTrackedStorage({ [RUN_KEY]: JSON.stringify(atCounterLimit(pauseAdventureRun(malformedBase('map')))) })
    const controller = new AppController()
    controller.resumeAdventure()
    startFirstNode(controller)
    playFirstLand(controller)
    expect(currentRun(controller).totalCardsPlayed).toBe(LIMIT)

    controller.pauseAdventure()
    expect(controller.getViewModel()).toMatchObject({ mode: null, adventure: { status: 'paused', stage: 'encounter' } })
    expect(counters(storedJson<AdventureRunState>(storage, RUN_KEY))).toEqual(Array(6).fill(LIMIT))

    controller.resumeAdventure()
    expect(controller.getViewModel().game).not.toBeNull()
    finishEncounter(controller, 0)
    const view = controller.getViewModel()
    expect(view.adventure).toMatchObject({ stage: 'reward', pendingCompletion: null, remainingChances: LIMIT, winStreak: LIMIT })
    expect(counters(storedJson<AdventureRunState>(storage, RUN_KEY))).toEqual(Array(6).fill(LIMIT))
    expect(new AppController().getViewModel().adventure).toMatchObject({ hasSavedRun: true, stage: 'reward' })
  })

  it('completes the run with the largest safe high score, which a reload reads back', () => {
    const storage = installTrackedStorage({ [RUN_KEY]: JSON.stringify(atCounterLimit(malformedBase('bossEncounter'))) })
    const controller = new AppController()
    controller.resumeAdventure()
    expect(startFirstNode(controller).boss).toBe(true)
    playFirstLand(controller)
    finishEncounter(controller, 0)

    const view = controller.getViewModel()
    expect(view.adventure).toMatchObject({ pendingCompletion: null, highScore: LIMIT, hasSavedRun: false })
    expect(view.status).toContain(`Score: ${LIMIT}. High score: ${LIMIT}.`)
    expect(storage.data.get(HIGH_SCORE_KEY)).toBe(String(LIMIT))
    expect(storage.data.has(RUN_KEY)).toBe(false)
    expect(new AppController().getViewModel().adventure.highScore).toBe(LIMIT)
  })
})
