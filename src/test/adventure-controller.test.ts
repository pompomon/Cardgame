import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  ADVENTURE_GAME_STORAGE_KEY,
  ADVENTURE_HIGH_SCORE_STORAGE_KEY,
  deckPairForAdventureGame,
  type AdventureGameSnapshotEnvelope,
  type AdventureRunState,
  type AdventureRunStateV1,
} from '../app/adventure'
import { ADVENTURE_RUN_STORAGE_KEY } from '../app/adventure-persistence'
import { AppController } from '../app/controller'
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

const STORAGE_WARNING = 'Adventure progress could not be saved (storage unavailable).'
const RUN_ID_PATTERN = /^[0-9a-f]{32}$/

function recoveryMessage(round: number): string {
  return `Adventure resumed at Round ${round}. The saved game could not be restored, so the round restarted without using a chance.`
}

interface TrackedStorage {
  readonly data: Map<string, string>
  /** Every write and removal, in order, as `set:<key>` / `remove:<key>`. */
  readonly calls: string[]
  readonly failingSets: Set<string>
  readonly failingRemoves: Set<string>
}

function installTrackedStorage(seed: Record<string, string> = {}): TrackedStorage {
  const tracked: TrackedStorage = {
    data: new Map(Object.entries(seed)),
    calls: [],
    failingSets: new Set(),
    failingRemoves: new Set(),
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => tracked.data.get(key) ?? null,
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
  return storage.calls.filter((call) =>
    call.endsWith(`:${ADVENTURE_RUN_STORAGE_KEY}`) || call.endsWith(`:${ADVENTURE_GAME_STORAGE_KEY}`))
}

interface ControllerInternals {
  state: {
    game: GameState | null
    seed: number
    status: string
    adventure: { run: AdventureRunState | null; highScore: number; hasSavedRun: boolean }
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

/** Ends the live encounter the same way the engine does: gameOver with a winner. */
function finishEncounter(controller: AppController, winner: 0 | 1 | 'draw'): void {
  const game = liveGame(controller)
  const previous = structuredClone(game)
  game.winner = winner
  game.phase = 'gameOver'
  internals(controller).onAdventureGameFinished(previous)
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

function storedJson<T>(storage: TrackedStorage, key: string): T {
  const raw = storage.data.get(key)
  if (raw === undefined) {
    throw new Error(`Expected ${key} in storage.`)
  }
  return JSON.parse(raw) as T
}

/** The game a fresh launch of the run's current attempt produces. */
function freshAttemptGame(run: AdventureRunState): GameState {
  const seed = run.attemptSeed
  if (seed === null) {
    throw new Error('Expected an attempt seed.')
  }
  return createInitialGame(seed, deckPairForAdventureGame(run, seed))
}

function v1Run(): AdventureRunStateV1 {
  return JSON.parse(fixture.closedMidRound[ADVENTURE_RUN_STORAGE_KEY]) as AdventureRunStateV1
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

describe('Adventure controller with version 2 runs', () => {
  installFakeTimerHooks()

  it.each(['closedMidRound', 'pausedMidRound'] as const)(
    'shows the %s version 1 save as a paused run without writing on load, lobby return, import or another mode',
    (name) => {
      const json = recordingJson()
      const saved = fixture[name]
      const storage = installTrackedStorage(saved)

      const controller = new AppController()
      const expected = {
        status: 'paused',
        currentRound: 3,
        currentOpponentIndex: 2,
        remainingChances: 2,
        winStreak: 1,
        activeGameSeed: 1760000420000,
        hasSavedRun: true,
      }
      expect(controller.getViewModel().adventure).toMatchObject(expected)

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
    },
  )

  it('writes version 2 on the first real save and keeps the run ID through pause, reload, resume, retry and advance', () => {
    vi.setSystemTime(1_770_000_000_000)
    const legacy = v1Run()
    const storage = installTrackedStorage(fixture.closedMidRound)
    const controller = new AppController()
    const runId = currentRun(controller).runId
    expect(runId).toMatch(RUN_ID_PATTERN)

    controller.resumeAdventure()
    expect(controller.getViewModel().status).toBe('Adventure resumed at Round 3.')
    expect(adventureCalls(storage)).toEqual([`set:${ADVENTURE_RUN_STORAGE_KEY}`])
    expect(storedJson<AdventureRunState>(storage, ADVENTURE_RUN_STORAGE_KEY)).toMatchObject({
      schemaVersion: 2,
      runId,
      baseSeed: legacy.baseSeed,
      status: 'active',
      stage: 'encounter',
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
    controller.pauseAdventure()
    expect(storedJson<AdventureRunState>(storage, ADVENTURE_RUN_STORAGE_KEY).runId).toBe(runId)
    expect(storedJson<AdventureGameSnapshotEnvelope>(storage, ADVENTURE_GAME_STORAGE_KEY)).toMatchObject({
      schemaVersion: 2,
      runId,
      nodeId: 'tier-3-center',
      attemptOrdinal: 0,
      attemptSeed: legacy.activeGameSeed,
    })

    const reloaded = new AppController()
    expect(currentRun(reloaded).runId).toBe(runId)
    reloaded.resumeAdventure()
    expect(reloaded.getViewModel().status).toBe('Adventure resumed at Round 3.')
    expect(currentRun(reloaded).runId).toBe(runId)

    finishEncounter(reloaded, 1)
    expect(storedJson<AdventureRunState>(storage, ADVENTURE_RUN_STORAGE_KEY)).toMatchObject({
      runId,
      status: 'paused',
      stage: 'map',
      currentTierIndex: 2,
      selectedNodeId: 'tier-3-center',
      attemptOrdinal: 1,
      attemptSeed: 1_770_000_000_000,
      remainingChances: 1,
      scoreEligibleChances: 1,
      winStreak: 0,
      scoreEligibleWinStreak: 0,
    })

    reloaded.resumeAdventure()
    finishEncounter(reloaded, 0)
    expect(storedJson<AdventureRunState>(storage, ADVENTURE_RUN_STORAGE_KEY)).toMatchObject({
      runId,
      status: 'paused',
      stage: 'map',
      currentTierIndex: 3,
      completedNodeIds: ['tier-1-center', 'tier-2-center', 'tier-3-center'],
      selectedNodeId: null,
      attemptOrdinal: 0,
    })
    expect(reloaded.getViewModel().status).toBe('Round won. Resume adventure for Round 4.')
  })

  it('keeps the unsaved conversion ID through in-session refreshes until the first save', () => {
    const json = recordingJson()
    const storage = installTrackedStorage(fixture.closedMidRound)
    const controller = new AppController()
    const runId = currentRun(controller).runId

    controller.importRecordingJson(json)
    controller.backToLobby()
    expect(currentRun(controller).runId).toBe(runId)
    expect(adventureCalls(storage)).toEqual([])

    controller.resumeAdventure()
    expect(storedJson<AdventureRunState>(storage, ADVENTURE_RUN_STORAGE_KEY).runId).toBe(runId)
    expect(currentRun(controller).runId).toBe(runId)
  })

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

  it('pauses mid-game with one game write followed by one run write', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    playFirstLand(controller)
    storage.calls.length = 0

    controller.pauseAdventure()

    expect(adventureCalls(storage)).toEqual([
      `set:${ADVENTURE_GAME_STORAGE_KEY}`,
      `set:${ADVENTURE_RUN_STORAGE_KEY}`,
    ])
  })

  it('restores a mid-game save whose run, node, attempt and seed all match', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    playFirstLand(controller)
    const paused = structuredClone(liveGame(controller))
    controller.pauseAdventure()

    controller.resumeAdventure()

    expect(liveGame(controller)).toEqual(paused)
    expect(controller.getViewModel().status).toBe('Adventure resumed at Round 1.')
    expect(storage.data.has(ADVENTURE_GAME_STORAGE_KEY)).toBe(false)
  })

  const mismatches: Array<[string, (envelope: AdventureGameSnapshotEnvelope) => void]> = [
    ['run', (envelope) => { envelope.runId = 'f'.repeat(32) }],
    ['node', (envelope) => { envelope.nodeId = 'tier-2-center' }],
    ['attempt', (envelope) => { envelope.attemptOrdinal += 1 }],
    ['seed', (envelope) => { envelope.attemptSeed += 1 }],
  ]

  it.each(mismatches)('relaunches the encounter with a warning when the saved %s does not match', (_field, mutate) => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    playFirstLand(controller)
    controller.pauseAdventure()
    const envelope = storedJson<AdventureGameSnapshotEnvelope>(storage, ADVENTURE_GAME_STORAGE_KEY)
    mutate(envelope)
    storage.data.set(ADVENTURE_GAME_STORAGE_KEY, JSON.stringify(envelope))

    controller.resumeAdventure()

    const run = currentRun(controller)
    expect(liveGame(controller)).toEqual(freshAttemptGame(run))
    expect(controller.getViewModel().status).toBe(recoveryMessage(1))
    expect(controller.getViewModel().adventure.remainingChances).toBe(3)
    expect(run.attemptOrdinal).toBe(0)
    expect(storage.data.has(ADVENTURE_GAME_STORAGE_KEY)).toBe(false)
  })

  it.each(mismatches)('never restores a mismatched %s save even when deleting it fails', (_field, mutate) => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    playFirstLand(controller)
    controller.pauseAdventure()
    const envelope = storedJson<AdventureGameSnapshotEnvelope>(storage, ADVENTURE_GAME_STORAGE_KEY)
    mutate(envelope)
    const stale = JSON.stringify(envelope)
    storage.data.set(ADVENTURE_GAME_STORAGE_KEY, stale)
    storage.failingRemoves.add(ADVENTURE_GAME_STORAGE_KEY)

    controller.resumeAdventure()
    expect(liveGame(controller)).toEqual(freshAttemptGame(currentRun(controller)))
    expect(controller.getViewModel().status).toBe(recoveryMessage(1))
    expect(storage.data.get(ADVENTURE_GAME_STORAGE_KEY)).toBe(stale)

    controller.backToLobby()
    controller.resumeAdventure()
    expect(liveGame(controller)).toEqual(freshAttemptGame(currentRun(controller)))
    expect(controller.getViewModel().adventure.remainingChances).toBe(3)
  })

  it('relaunches with a recovery warning after a reload mid-encounter that left no save', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    playFirstLand(controller)
    expect(storage.data.has(ADVENTURE_GAME_STORAGE_KEY)).toBe(false)

    const reloaded = new AppController()
    reloaded.resumeAdventure()

    const run = currentRun(reloaded)
    expect(liveGame(reloaded)).toEqual(freshAttemptGame(run))
    expect(reloaded.getViewModel().status).toBe(recoveryMessage(1))
    expect(reloaded.getViewModel().adventure.remainingChances).toBe(3)
    expect(run.attemptOrdinal).toBe(0)
    expect(storage.data.has(ADVENTURE_GAME_STORAGE_KEY)).toBe(false)
  })

  it('relaunches a paused version 1 game from its seed with a recovery warning and no lost chance', () => {
    const legacy = v1Run()
    const storage = installTrackedStorage(fixture.pausedMidRound)
    const controller = new AppController()

    controller.resumeAdventure()

    expect(controller.getViewModel().status).toBe(recoveryMessage(3))
    expect(liveGame(controller)).toEqual(v1LaunchGame(legacy))
    expect(controller.getViewModel().adventure).toMatchObject({
      status: 'active',
      remainingChances: 2,
      currentRound: 3,
    })
    expect(adventureCalls(storage)).toEqual([
      `set:${ADVENTURE_RUN_STORAGE_KEY}`,
      `remove:${ADVENTURE_GAME_STORAGE_KEY}`,
    ])
    expect(storedJson<AdventureRunState>(storage, ADVENTURE_RUN_STORAGE_KEY).schemaVersion).toBe(2)
    expect(storage.data.has(ADVENTURE_GAME_STORAGE_KEY)).toBe(false)
  })

  it('quietly discards a stale save when the run was waiting on the map', () => {
    vi.setSystemTime(1_770_000_000_000)
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    playFirstLand(controller)
    controller.pauseAdventure()
    const stale = storage.data.get(ADVENTURE_GAME_STORAGE_KEY)!
    controller.resumeAdventure()
    vi.setSystemTime(1_770_000_060_000)
    finishEncounter(controller, 1)
    // Simulate a delete that failed earlier: the previous attempt's save is still there.
    storage.data.set(ADVENTURE_GAME_STORAGE_KEY, stale)

    controller.resumeAdventure()

    const run = currentRun(controller)
    expect(run.attemptOrdinal).toBe(1)
    expect(run.attemptSeed).toBe(1_770_000_060_000)
    expect(liveGame(controller)).toEqual(freshAttemptGame(run))
    expect(controller.getViewModel().status).toBe('Adventure resumed at Round 1.')
    expect(storage.data.has(ADVENTURE_GAME_STORAGE_KEY)).toBe(false)
  })

  it('quietly discards a corrupt mid-game slot next to a version 1 run', () => {
    const legacy = v1Run()
    const storage = installTrackedStorage({
      ...fixture.closedMidRound,
      [ADVENTURE_GAME_STORAGE_KEY]: '{not json',
    })
    const controller = new AppController()

    controller.resumeAdventure()

    expect(controller.getViewModel().status).toBe('Adventure resumed at Round 3.')
    expect(liveGame(controller)).toEqual(v1LaunchGame(legacy))
    expect(storage.data.has(ADVENTURE_GAME_STORAGE_KEY)).toBe(false)
  })

  it('shows the storage warning ahead of the recovery warning', () => {
    const legacy = v1Run()
    const storage = installTrackedStorage(fixture.pausedMidRound)
    storage.failingSets.add(ADVENTURE_RUN_STORAGE_KEY)
    const controller = new AppController()

    controller.resumeAdventure()

    expect(controller.getViewModel().status).toBe(STORAGE_WARNING)
    expect(controller.getViewModel().adventure.hasSavedRun).toBe(false)
    expect(liveGame(controller)).toEqual(v1LaunchGame(legacy))
    expect(storage.data.get(ADVENTURE_RUN_STORAGE_KEY)).toBe(fixture.pausedMidRound[ADVENTURE_RUN_STORAGE_KEY])
  })

  it('completes a converted run whose final opponent is not a mono boss and whose round disagrees with its opponent index', () => {
    const legacy = v1Run()
    legacy.currentOpponentIndex = 6
    legacy.currentRound = 4
    legacy.opponentLineup[6] = { ...structuredClone(legacy.opponentLineup[0]), id: legacy.opponentLineup[6].id }
    const storage = installTrackedStorage({ [ADVENTURE_RUN_STORAGE_KEY]: JSON.stringify(legacy) })
    const controller = new AppController()
    expect(controller.getViewModel().adventure).toMatchObject({ currentRound: 7, currentOpponentIndex: 6 })
    expect(controller.getViewModel().adventure.opponentLineup[6].kind).toBe('dual')

    controller.resumeAdventure()
    expect(controller.getViewModel().status).toBe('Adventure resumed at Round 7.')
    expect(liveGame(controller)).toEqual(v1LaunchGame(legacy))

    finishEncounter(controller, 0)

    const view = controller.getViewModel()
    const score = 2 * 100 - legacy.totalCardsPlayed + (legacy.totalRoundsPlayed + 1) * 5
    expect(view.status).toBe(`Adventure completed! Score: ${score}. High score: ${score}.`)
    expect(view.adventure.status).toBe('completed')
    expect(view.adventure.hasSavedRun).toBe(false)
    expect(view.mode).toBeNull()
    expect(storage.data.has(ADVENTURE_RUN_STORAGE_KEY)).toBe(false)
    expect(storage.data.get(ADVENTURE_HIGH_SCORE_STORAGE_KEY)).toBe(String(score))
  })

  it('writes a run that became active in this session once when returning to the lobby', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    storage.calls.length = 0

    controller.backToLobby()
    expect(adventureCalls(storage)).toEqual([`set:${ADVENTURE_RUN_STORAGE_KEY}`])
    expect(storedJson<AdventureRunState>(storage, ADVENTURE_RUN_STORAGE_KEY).status).toBe('paused')

    storage.calls.length = 0
    controller.backToLobby()
    controller.startGame('local-hvh')
    controller.backToLobby()
    expect(adventureCalls(storage)).toEqual([])
  })

  it('retries a failed pause save when returning to the lobby', () => {
    const storage = installTrackedStorage()
    const controller = new AppController()
    controller.startAdventure()
    storage.failingSets.add(ADVENTURE_RUN_STORAGE_KEY)
    controller.pauseAdventure()
    expect(controller.getViewModel().status).toBe(STORAGE_WARNING)
    expect(controller.getViewModel().adventure.hasSavedRun).toBe(false)
    expect(storage.data.has(ADVENTURE_GAME_STORAGE_KEY)).toBe(false)

    storage.failingSets.delete(ADVENTURE_RUN_STORAGE_KEY)
    controller.backToLobby()

    const stored = storedJson<AdventureRunState>(storage, ADVENTURE_RUN_STORAGE_KEY)
    expect(stored).toMatchObject({ status: 'paused', stage: 'encounter', runId: currentRun(controller).runId })
    expect(controller.getViewModel().adventure.hasSavedRun).toBe(true)
  })
})
