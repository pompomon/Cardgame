import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppController } from '../app/controller'
import { parseGameRecordJson } from '../app/game-recording'
import type { GameRecordFile } from '../app/game-recording'

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

function firstPlayableAction(controller: AppController) {
  const game = controller.getViewModel().game
  if (!game) {
    return null
  }
  for (const options of Object.values(game.legal.playLandByCard)) {
    if (options.length > 0) {
      return options[0].action
    }
  }
  return null
}

function parseExported(controller: AppController) {
  const payload = controller.exportRecordingJson()
  expect(payload).toBeTruthy()
  const parsed = parseGameRecordJson(payload ?? '')
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) {
    throw new Error('Expected valid recording parse.')
  }
  return parsed.record
}

type RemoteActionApplier = {
  applyRecordedAction: (action: unknown, source: 'remote', broadcast: boolean) => void
}

type ControllerModeControllersState = {
  state: {
    mode: string | null
    controllers: ['human' | 'ai' | 'remote', 'human' | 'ai' | 'remote']
  }
}

describe('controller recording and replay', () => {
  beforeEach(() => {
    installMemoryStorage()
    vi.useRealTimers()
  })

  it('records local and AI actions in timeline', () => {
    vi.useFakeTimers()
    const controller = new AppController('dom')
    controller.startGame('local-aivai')
    vi.advanceTimersByTime(500)

    const record = parseExported(controller)
    expect(record.timeline.length).toBeGreaterThanOrEqual(1)
    expect(record.timeline.some((entry) => entry.source === 'ai')).toBe(true)
  })

  it('supports replay step controls and freezes live actions during replay', () => {
    const controller = new AppController('dom')
    controller.startGame('local-hvh')
    const action = firstPlayableAction(controller)
    expect(action).toBeTruthy()
    controller.submitAction(action!)

    const beforeReplay = parseExported(controller)
    expect(beforeReplay.timeline).toHaveLength(1)

    controller.startReplay()
    expect(controller.getViewModel().replay.active).toBe(true)

    controller.submitAction({ type: 'end_turn', actor: 0 })
    const duringReplay = parseExported(controller)
    expect(duringReplay.timeline).toHaveLength(1)

    controller.stepReplay(1)
    expect(controller.getViewModel().replay.step).toBe(1)
    controller.jumpReplayToEnd()
    expect(controller.getViewModel().replay.step).toBe(controller.getViewModel().replay.totalSteps)

    controller.exitReplay()
    expect(controller.getViewModel().replay.active).toBe(false)
  })

  it('records remote-source actions through controller remote path', () => {
    const controller = new AppController('dom')
    controller.startGame('local-hvh')
    const action = firstPlayableAction(controller)
    expect(action).toBeTruthy()

    ;(controller as unknown as RemoteActionApplier)
      .applyRecordedAction(action, 'remote', false)

    const record = parseExported(controller)
    expect(record.timeline[0]?.source).toBe('remote')
  })

  it('reports illegal remote actions instead of dropping them silently', () => {
    const controller = new AppController('dom')
    controller.startGame('local-hvh')
    const before = parseExported(controller)
    expect(before.timeline).toHaveLength(0)

    ;(controller as unknown as RemoteActionApplier)
      .applyRecordedAction({ type: 'end_turn', actor: 1 }, 'remote', false)

    expect(controller.getViewModel().status).toContain('Ignored illegal action from peer.')
    const after = parseExported(controller)
    expect(after.timeline).toHaveLength(0)
  })

  it('rejects remote actions that target the local actor in p2p mode', () => {
    const controller = new AppController('dom')
    controller.startGame('local-hvh')
    const action = firstPlayableAction(controller)
    expect(action).toBeTruthy()
    const state = controller as unknown as ControllerModeControllersState
    state.state.mode = 'p2p-host'
    state.state.controllers = ['human', 'remote']

    ;(controller as unknown as RemoteActionApplier)
      .applyRecordedAction(action, 'remote', false)

    expect(controller.getViewModel().status).toContain('Ignored out-of-role action from peer.')
    const after = parseExported(controller)
    expect(after.timeline).toHaveLength(0)
  })

  it('saves and loads recordings from local storage', () => {
    const controller = new AppController('dom')
    controller.startGame('local-hvh')
    const action = firstPlayableAction(controller)
    expect(action).toBeTruthy()
    controller.submitAction(action!)

    controller.saveRecordingToLocalStorage()

    const other = new AppController('dom')
    other.loadRecordingFromLocalStorage()
    const view = other.getViewModel()
    expect(view.replay.active).toBe(true)
    expect(view.recording.metadata).toBeTruthy()
  })

  it('reports invalid JSON on import', () => {
    const controller = new AppController('dom')
    controller.importRecordingJson('not-json')
    expect(controller.getViewModel().status).toContain('Failed to load recording')
  })

  it('imports p2p recordings into functional local mode after replay exits', () => {
    const controller = new AppController('dom')
    controller.startGame('local-hvh')
    const payload = controller.exportRecordingJson()
    expect(payload).toBeTruthy()
    const parsedPayload = JSON.parse(payload ?? '{}') as GameRecordFile
    parsedPayload.metadata.mode = 'p2p-host'
    parsedPayload.metadata.controllers = ['human', 'remote']

    controller.importRecordingJson(JSON.stringify(parsedPayload))
    controller.exitReplay()

    const view = controller.getViewModel()
    expect(view.mode).toBe('local-hvh')
    expect(view.controllers).toEqual(['human', 'human'])
  })

  it('does not start replay playback when already at final step', () => {
    const controller = new AppController('dom')
    controller.startGame('local-hvh')
    controller.startReplay()

    const replayView = controller.getViewModel().replay
    expect(replayView.active).toBe(true)
    expect(replayView.isPlaying).toBe(false)
    expect(replayView.step).toBe(replayView.totalSteps)
    expect(controller.getViewModel().status).toContain('Replay reached final state.')
  })

  it('clears active recording state when returning to lobby', () => {
    const controller = new AppController('dom')
    controller.startGame('local-hvh')
    const action = firstPlayableAction(controller)
    expect(action).toBeTruthy()
    controller.submitAction(action!)
    expect(controller.getViewModel().recording.canSave).toBe(true)

    controller.backToLobby()

    const view = controller.getViewModel()
    expect(view.mode).toBeNull()
    expect(view.recording.canSave).toBe(false)
    expect(view.recording.metadata).toBeNull()
  })

  it('pauses active replay when recording import JSON is invalid', () => {
    const controller = new AppController('dom')
    controller.startGame('local-hvh')
    const action = firstPlayableAction(controller)
    expect(action).toBeTruthy()
    controller.submitAction(action!)
    controller.startReplay()
    expect(controller.getViewModel().replay.isPlaying).toBe(true)

    controller.importRecordingJson('not-json')

    const replayView = controller.getViewModel().replay
    expect(replayView.active).toBe(true)
    expect(replayView.isPlaying).toBe(false)
    expect(controller.getViewModel().status).toContain('Failed to load recording')
  })

  it('cancels stale AI timeout when starting a new game', () => {
    vi.useFakeTimers()
    const controller = new AppController('dom')
    controller.startGame('local-aivai')
    controller.startGame('local-hvh')
    vi.advanceTimersByTime(500)

    const record = parseExported(controller)
    expect(record.timeline).toHaveLength(0)
    vi.useRealTimers()
  })

  it('blocks replay while connected to a peer game', () => {
    const controller = new AppController('dom')
    controller.startGame('local-hvh')
    const internals = controller as unknown as {
      state: { mode: string | null }
      p2p: { isConnected: () => boolean } | null
    }
    internals.state.mode = 'p2p-host'
    internals.p2p = { isConnected: () => true }

    controller.startReplay()

    expect(controller.getViewModel().replay.active).toBe(false)
    expect(controller.getViewModel().status).toContain('Replay is unavailable while connected to a peer game.')
  })
})
