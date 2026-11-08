import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  ADVENTURE_GAME_STORAGE_KEY,
  ADVENTURE_HIGH_SCORE_STORAGE_KEY,
  applyAdventureEncounterResult,
  computeAdventureScore,
  deckPairForAdventureGame,
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
import { AppController } from '../app/controller'
import { actionableAdventureNodes } from '../app/lobby-presentation'
import type { AdventureNodeSummary } from '../app/types'
import { createStarterDeck } from '../game/cards'
import { createInitialGame } from '../game/engine'
import type { GameState } from '../game/types'
import { installFakeTimerHooks } from './helpers/timers'

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
const RESULT_WARNING = 'The encounter result could not be saved (storage unavailable). Retry saving the result.'
const PENDING_NOTICE = 'Save the encounter result first: choose Retry Saving Result.'
const UNAVAILABLE_NODE = 'That encounter is not available. Choose a highlighted encounter.'
const RUN_ID_PATTERN = /^[0-9a-f]{32}$/

function recoveryMessage(tier: number): string {
  return `Adventure resumed at Tier ${tier}. The saved game could not be restored, so the encounter restarts without using a chance.`
}

interface TrackedStorage {
  readonly data: Map<string, string>
  /** Every write and removal, in order, as `set:<key>` / `remove:<key>`. */
  readonly calls: string[]
  readonly failingSets: Set<string>
  readonly failingRemoves: Set<string>
  readonly failingGets: Set<string>
}

function installTrackedStorage(seed: Record<string, string> = {}): TrackedStorage {
  const tracked: TrackedStorage = {
    data: new Map(Object.entries(seed)),
    calls: [],
    failingSets: new Set(),
    failingRemoves: new Set(),
    failingGets: new Set(),
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => {
        if (tracked.failingGets.has(key)) {
          throw new Error('storage locked')
        }
        return tracked.data.get(key) ?? null
      },
      setItem: (key: string, value: string) => {
        tracked.calls.push(`set:${key}`)
        if (tracked.failingSets.has(key)) {
          throw new Error('quota exceeded')
        }
        tracked.data.set(key, String(value))
      },
      removeItem: (key: string) => {
        tracked.calls.push(`remove:${key}`)
        if (tracked.failingRemoves.has(key)) {
          throw new Error('storage locked')
        }
        tracked.data.delete(key)
      },
      clear: () => {
        tracked.data.clear()
      },
    },
  })
  return tracked
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

/** Wins encounters until the current tier is an uncommitted fork. */
function advanceToFork(controller: AppController): [AdventureNodeSummary, AdventureNodeSummary] {
  for (let guard = 0; guard < 7; guard += 1) {
    const nodes = actionableNodes(controller)
    if (nodes.length === 2) {
      return [nodes[0], nodes[1]]
    }
    startFirstNode(controller)
    finishEncounter(controller, 0)
  }
  throw new Error('Expected a fork.')
}

/** Wins the first six tiers and starts the boss encounter. */
function reachBoss(controller: AppController): void {
  for (let tier = 1; tier < 7; tier += 1) {
    startFirstNode(controller)
    finishEncounter(controller, 0)
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
    expect(reloaded.getViewModel().status).toBe('Encounter won. Choose your Tier 4 encounter.')
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toMatchObject({
      runId,
      status: 'active',
      stage: 'map',
      currentTierIndex: 3,
      completedNodeIds: ['tier-1-center', 'tier-2-center', 'tier-3-center'],
      selectedNodeId: null,
      attemptOrdinal: 0,
      attemptSeed: null,
    })
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

  const staleSources: Array<[string, (controller: AppController) => void]> = [
    ['a reset run', (controller) => {
      controller.abandonAdventure()
      controller.startAdventure()
    }],
    ['a completed node', (controller) => finishEncounter(controller, 0)],
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
    ['mid-game save', GAME_KEY],
    ['run', RUN_KEY],
  ] as const)('keeps the encounter open when the %s write fails, then pauses on retry', (_name, key) => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    startFirstNode(controller)
    playFirstLand(controller)
    const game = liveGame(controller)
    const storedRun = storage.data.get(RUN_KEY)
    storage.failingSets.add(key)

    controller.pauseAdventure()

    expect(controller.getViewModel().status).toBe(`${STORAGE_WARNING} The game was not paused.`)
    expect(controller.getViewModel().mode).toBe('adventure-hvai')
    expect(liveGame(controller)).toBe(game)
    expect(storage.data.get(RUN_KEY)).toBe(storedRun)
    expect(storage.data.has(GAME_KEY)).toBe(false)

    storage.failingSets.delete(key)
    controller.pauseAdventure()
    expect(controller.getViewModel().mode).toBeNull()
    expect(controller.getViewModel().status).toBe('Adventure paused at Tier 1.')
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toMatchObject({ status: 'paused', stage: 'encounter' })
    expect(storage.data.has(GAME_KEY)).toBe(true)
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
        expect(controller.getViewModel().status).toBe(`Encounter won. Choose your Tier ${tier + 1} encounter.`)
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
      : `Encounter ended in a draw. Retry Tier ${tier}.`)
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
    ['win', 'Encounter won. Choose your Tier 2 encounter.'],
    ['loss', 'Encounter lost. 2 chances left. Retry Tier 1.'],
    ['draw', 'Encounter ended in a draw. Retry Tier 1.'],
  ] as const)('keeps a %s pending until it is saved, then applies it exactly once', (outcome, status) => {
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
    expect(controller.getViewModel().status).toBe(RESULT_WARNING)
    expect(controller.getViewModel().adventure).toMatchObject({
      status: 'active',
      stage: 'encounter',
      pendingCompletion: outcome,
      lastResult: null,
    })
    expect(storage.data.get(RUN_KEY)).toBe(storedRun)
    expectPendingBlocksNavigation(controller, board)

    controller.retryAdventureCompletion()
    expect(controller.getViewModel().status).toBe(RESULT_WARNING)
    expect(controller.getViewModel().adventure.pendingCompletion).toBe(outcome)
    expect(liveGame(controller)).toBe(board)

    storage.failingSets.delete(RUN_KEY)
    controller.retryAdventureCompletion()

    const expected = applyAdventureEncounterResult(before, outcome)
    expect(controller.getViewModel().status).toBe(status)
    expect(storedJson<AdventureRunState>(storage, RUN_KEY)).toEqual(expected)
    expect(currentRun(controller)).toEqual(expected)
    expect(internals(controller).state.game).toBeNull()
    expect(controller.getViewModel().adventure).toMatchObject({ pendingCompletion: null, stage: 'map' })
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
    expect(controller.getViewModel().status).toBe(RESULT_WARNING)
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
    expect(controller.getViewModel().status).toBe(RESULT_WARNING)
    expect(storage.data.get(HIGH_SCORE_KEY)).toBe(String(highScore))
    expect(storage.data.get(RUN_KEY)).toBe(storedRun)
    expect(liveGame(controller)).toBe(board)

    // An unreadable slot after a refused removal cannot confirm the run is gone.
    storage.failingGets.add(RUN_KEY)
    controller.retryAdventureCompletion()
    expect(controller.getViewModel().status).toBe(RESULT_WARNING)
    expect(controller.getViewModel().adventure.pendingCompletion).toBe(outcome)
    expect(storage.data.get(RUN_KEY)).toBe(storedRun)
    expect(liveGame(controller)).toBe(board)

    storage.failingGets.delete(RUN_KEY)
    storage.failingRemoves.delete(RUN_KEY)
    controller.retryAdventureCompletion()

    const heading = outcome === 'win' ? 'Adventure completed!' : 'Adventure failed.'
    expect(controller.getViewModel().status).toBe(`${heading} Score: ${score}. High score: ${highScore}.`)
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
