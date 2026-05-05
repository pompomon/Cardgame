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

function installFakeRtcPeerConnection(): () => void {
  const original = (globalThis as Record<string, unknown>).RTCPeerConnection
  class FakeRTCPeerConnection {
    ondatachannel: ((event: { channel: unknown }) => void) | null = null

    constructor(_configuration: unknown) {}

    close(): void {}
  }
  Object.defineProperty(globalThis, 'RTCPeerConnection', {
    configurable: true,
    value: FakeRTCPeerConnection,
  })
  return () => {
    if (original === undefined) {
      delete (globalThis as Record<string, unknown>).RTCPeerConnection
      return
    }
    Object.defineProperty(globalThis, 'RTCPeerConnection', {
      configurable: true,
      value: original,
    })
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
    const restoreRtc = installFakeRtcPeerConnection()
    try {
      const controller = new AppController('dom')
      controller.startGame('p2p-host')
      const internals = controller as unknown as {
        p2p: {
          send: (type: string, payload: unknown) => boolean
          isConnected: () => boolean
          close: () => void
          onMessage: (packet: { type: string; payload: unknown }) => void
        } | null
        state: { seed: number }
      }
      const sentPackets: Array<{ type: string; payload: unknown }> = []
      const p2pOnMessage = internals.p2p!.onMessage.bind(internals.p2p)
      internals.p2p = {
        send: (type, payload) => {
          sentPackets.push({ type, payload })
          return true
        },
        isConnected: () => true,
        close: () => {},
        onMessage: p2pOnMessage,
      }
      controller.startP2PGame()
      expect(sentPackets[0]?.type).toBe('start')
      internals.p2p.onMessage({ type: 'start-ack', payload: { seed: internals.state.seed } })
      expect(controller.getViewModel().p2pStarted).toBe(true)
      const action = firstPlayableAction(controller)
      expect(action).toBeTruthy()

      ;(controller as unknown as RemoteActionApplier)
        .applyRecordedAction(action, 'remote', false)

      expect(controller.getViewModel().status).toContain('Ignored out-of-role action from peer.')
      const after = parseExported(controller)
      expect(after.timeline).toHaveLength(0)
    } finally {
      restoreRtc()
    }
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

  it('resumes AI scheduling after exiting replay at final state', () => {
    vi.useFakeTimers()
    const controller = new AppController('dom')
    controller.startGame('local-hvai')
    expect(controller.getViewModel().game?.legal.canEndTurn).toBe(true)
    controller.submitAction({ type: 'end_turn', actor: 0 })
    expect(parseExported(controller).timeline).toHaveLength(1)

    controller.startReplay()
    controller.exitReplay()
    vi.advanceTimersByTime(500)

    const record = parseExported(controller)
    expect(record.timeline.length).toBeGreaterThan(1)
    expect(record.timeline.some((entry) => entry.source === 'ai')).toBe(true)
    vi.useRealTimers()
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

  it('does not flip p2pStarted when host startP2PGame() cannot send the start packet', () => {
    const restoreRtc = installFakeRtcPeerConnection()
    try {
      const controller = new AppController('dom')
      controller.startGame('p2p-host')
      expect(controller.getViewModel().p2pStarted).toBe(false)

      // No data channel is open in the fake RTC peer, so send() returns false.
      controller.startP2PGame()

      expect(controller.getViewModel().p2pStarted).toBe(false)
      expect(controller.getViewModel().status).toContain('not sent')
    } finally {
      restoreRtc()
    }
  })

  it('flips p2pStarted on host only after the joiner acknowledges the start packet', () => {
    const restoreRtc = installFakeRtcPeerConnection()
    try {
      const controller = new AppController('dom')
      controller.startGame('p2p-host')
      expect(controller.getViewModel().p2pStarted).toBe(false)

      // Stub the internal P2PLink so send() reports a successful local
      // queue. The host should NOT yet flip p2pStarted: WebRTC accepting
      // the packet locally is not an acknowledgment that the joiner
      // received it. The host must wait for an explicit `start-ack`.
      const sentPackets: Array<{ type: string; payload: unknown }> = []
      const internals = controller as unknown as {
        p2p: {
          send: (type: string, payload: unknown) => boolean
          isConnected: () => boolean
          close: () => void
          onMessage: (packet: { type: string; payload: unknown }) => void
        } | null
        state: { seed: number; pendingP2PStartSeed: number | null }
      }
      const realOnMessage = internals.p2p!.onMessage.bind(internals.p2p)
      internals.p2p = {
        send: (type, payload) => {
          sentPackets.push({ type, payload })
          return true
        },
        isConnected: () => true,
        close: () => {},
        onMessage: realOnMessage,
      }

      controller.startP2PGame()
      expect(sentPackets[0]?.type).toBe('start')
      expect(controller.getViewModel().p2pStarted).toBe(false)
      expect(internals.state.pendingP2PStartSeed).toBe(internals.state.seed)
      expect(controller.getViewModel().status).toContain('Waiting')

      // Simulate the joiner's start-ack arriving. Only now should the
      // host transition out of the lobby.
      internals.p2p!.onMessage({ type: 'start-ack', payload: { seed: internals.state.seed } })
      expect(controller.getViewModel().p2pStarted).toBe(true)
      expect(internals.state.pendingP2PStartSeed).toBeNull()
      expect(controller.getViewModel().status).toContain('P2P game started')

      // A stale ack with a different seed must be ignored.
      internals.p2p!.onMessage({ type: 'start-ack', payload: { seed: 999 } })
      expect(controller.getViewModel().p2pStarted).toBe(true)
    } finally {
      restoreRtc()
    }
  })

  it('flips p2pStarted on joiner when a start packet arrives and acks it', () => {
    const restoreRtc = installFakeRtcPeerConnection()
    try {
      const controller = new AppController('dom')
      controller.startGame('p2p-join')
      expect(controller.getViewModel().p2pStarted).toBe(false)
      const initialGame = controller.getViewModel().game

      // Drive the actual `packet.type === 'start'` branch in setupP2P by
      // invoking the P2PLink's onMessage callback directly. This exercises
      // the real joiner-side state mutations (reseed, reinitialize game,
      // recording setup, status update, p2pStarted flip) so a regression
      // in any of those would fail the test instead of being masked by
      // direct field writes.
      const sentPackets: Array<{ type: string; payload: unknown }> = []
      const internals = controller as unknown as {
        p2p: {
          onMessage: (packet: { type: string; payload: unknown }) => void
          send: (type: string, payload: unknown) => boolean
          isConnected: () => boolean
          close: () => void
        } | null
        state: { game: unknown; seed: number }
      }
      expect(internals.p2p).toBeTruthy()
      // Wrap send() so we can assert the start-ack is sent back to the
      // host. The joiner must ack so the host can leave the lobby.
      const p2pOnMessage = internals.p2p!.onMessage.bind(internals.p2p)
      internals.p2p = {
        onMessage: p2pOnMessage,
        send: (type, payload) => {
          sentPackets.push({ type, payload })
          return true
        },
        isConnected: () => true,
        close: () => {},
      }
      internals.p2p!.onMessage({ type: 'start', payload: { seed: 4242 } })

      const view = controller.getViewModel()
      expect(view.p2pStarted).toBe(true)
      expect(view.status).toContain('Remote game started')
      expect(internals.state.seed).toBe(4242)
      // The joiner reseeds state.game from the packet, so the game reference
      // changes after the start packet is delivered.
      expect(internals.state.game).not.toBe(initialGame)
      // The joiner must ack the start packet so the host can leave the
      // lobby. Without this ack the host stays in 'Waiting...' forever.
      expect(sentPackets.some((packet) => packet.type === 'start-ack' && (packet.payload as { seed: number }).seed === 4242)).toBe(true)

      // Invalid payload should not flip p2pStarted again or reseed the game.
      internals.p2p!.onMessage({ type: 'start', payload: { foo: 'bar' } })
      expect(controller.getViewModel().status).toContain('Ignored invalid start payload')
    } finally {
      restoreRtc()
    }
  })

  it('ignores incoming start packets while in host mode', () => {
    const restoreRtc = installFakeRtcPeerConnection()
    try {
      const controller = new AppController('dom')
      controller.startGame('p2p-host')
      const internals = controller as unknown as {
        p2p: {
          onMessage: (packet: { type: string; payload: unknown }) => void
          send: (type: string, payload: unknown) => boolean
          isConnected: () => boolean
          close: () => void
        } | null
        state: { seed: number; game: unknown; p2pStarted: boolean }
      }
      const originalSeed = internals.state.seed
      const originalGame = internals.state.game
      const sentPackets: Array<{ type: string; payload: unknown }> = []
      const realOnMessage = internals.p2p!.onMessage.bind(internals.p2p)
      internals.p2p = {
        onMessage: realOnMessage,
        send: (type, payload) => {
          sentPackets.push({ type, payload })
          return true
        },
        isConnected: () => true,
        close: () => {},
      }

      internals.p2p.onMessage({ type: 'start', payload: { seed: 7777 } })

      expect(internals.state.seed).toBe(originalSeed)
      expect(internals.state.game).toBe(originalGame)
      expect(internals.state.p2pStarted).toBe(false)
      expect(sentPackets).toHaveLength(0)
      expect(controller.getViewModel().status).toContain('Ignored unexpected start packet')
    } finally {
      restoreRtc()
    }
  })

  it('aborts rematch local mutations when the P2P rematch packet cannot be delivered', () => {
    const restoreRtc = installFakeRtcPeerConnection()
    try {
      const controller = new AppController('dom')
      controller.startGame('p2p-host')
      // Stub send() to fail. Without the abort-before-mutate logic, rematch()
      // would advance this peer's seed/game while the other peer stays on the
      // previous game, guaranteeing a desync. With the fix, rematch must keep
      // the existing seed/game and surface a status warning instead.
      const internals = controller as unknown as {
        p2p: { send: () => boolean; isConnected: () => boolean; close: () => void } | null
        state: { seed: number; game: unknown; pendingRematchSeed: number | null }
      }
      const originalSeed = internals.state.seed
      const originalGame = internals.state.game
      internals.p2p = {
        send: () => false,
        isConnected: () => false,
        close: () => {},
      }

      controller.rematch()

      expect(internals.state.seed).toBe(originalSeed)
      expect(internals.state.game).toBe(originalGame)
      expect(internals.state.pendingRematchSeed).toBeNull()
      expect(controller.getViewModel().status).toContain('P2P send failed')
    } finally {
      restoreRtc()
    }
  })

  it('defers P2P rematch local mutations until the peer acks the rematch packet', () => {
    const restoreRtc = installFakeRtcPeerConnection()
    try {
      const controller = new AppController('dom')
      controller.startGame('p2p-host')
      const sentPackets: Array<{ type: string; payload: unknown }> = []
      const internals = controller as unknown as {
        p2p: {
          send: (type: string, payload: unknown) => boolean
          isConnected: () => boolean
          close: () => void
          onMessage: (packet: { type: string; payload: unknown }) => void
        } | null
        state: { seed: number; game: unknown; pendingRematchSeed: number | null }
      }
      const realOnMessage = internals.p2p!.onMessage.bind(internals.p2p)
      internals.p2p = {
        send: (type, payload) => {
          sentPackets.push({ type, payload })
          return true
        },
        isConnected: () => true,
        close: () => {},
        onMessage: realOnMessage,
      }
      const originalSeed = internals.state.seed
      const originalGame = internals.state.game

      controller.rematch()

      // Send queue accepted the packet, but the peer hasn't acked yet.
      // Local seed/game/recording must NOT have changed.
      expect(sentPackets.find((packet) => packet.type === 'rematch')).toBeTruthy()
      expect(internals.state.seed).toBe(originalSeed)
      expect(internals.state.game).toBe(originalGame)
      expect(internals.state.pendingRematchSeed).not.toBeNull()
      expect(controller.getViewModel().status).toContain('Waiting')

      // Now simulate the peer's rematch-ack arriving with the matching seed.
      const pendingSeed = internals.state.pendingRematchSeed!
      internals.p2p!.onMessage({ type: 'rematch-ack', payload: { seed: pendingSeed } })

      expect(internals.state.seed).toBe(pendingSeed)
      expect(internals.state.game).not.toBe(originalGame)
      expect(internals.state.pendingRematchSeed).toBeNull()
      expect(controller.getViewModel().status).toContain('Rematch started')
    } finally {
      restoreRtc()
    }
  })

  it('does not start on joiner when start-ack cannot be sent', () => {
    const restoreRtc = installFakeRtcPeerConnection()
    try {
      const controller = new AppController('dom')
      controller.startGame('p2p-join')
      const internals = controller as unknown as {
        p2p: {
          onMessage: (packet: { type: string; payload: unknown }) => void
          send: (type: string, payload: unknown) => boolean
          isConnected: () => boolean
          close: () => void
        } | null
        state: { seed: number; game: unknown; p2pStarted: boolean }
      }
      const originalSeed = internals.state.seed
      const originalGame = internals.state.game
      const realOnMessage = internals.p2p!.onMessage.bind(internals.p2p)
      internals.p2p = {
        onMessage: realOnMessage,
        send: () => false,
        isConnected: () => true,
        close: () => {},
      }

      internals.p2p.onMessage({ type: 'start', payload: { seed: 9999 } })

      expect(internals.state.p2pStarted).toBe(false)
      expect(internals.state.seed).toBe(originalSeed)
      expect(internals.state.game).toBe(originalGame)
      expect(controller.getViewModel().status).toContain('could not acknowledge start')
    } finally {
      restoreRtc()
    }
  })

  it('does not apply incoming rematch when rematch-ack cannot be sent', () => {
    const restoreRtc = installFakeRtcPeerConnection()
    try {
      const controller = new AppController('dom')
      controller.startGame('p2p-join')
      const internals = controller as unknown as {
        p2p: {
          onMessage: (packet: { type: string; payload: unknown }) => void
          send: (type: string, payload: unknown) => boolean
          isConnected: () => boolean
          close: () => void
        } | null
        state: { seed: number; game: unknown }
      }
      const originalSeed = internals.state.seed
      const originalGame = internals.state.game
      const realOnMessage = internals.p2p!.onMessage.bind(internals.p2p)
      internals.p2p = {
        onMessage: realOnMessage,
        send: () => false,
        isConnected: () => true,
        close: () => {},
      }

      internals.p2p.onMessage({ type: 'rematch', payload: { seed: 5555 } })

      expect(internals.state.seed).toBe(originalSeed)
      expect(internals.state.game).toBe(originalGame)
      expect(controller.getViewModel().status).toContain('could not acknowledge rematch')
    } finally {
      restoreRtc()
    }
  })

  it('blocks actions and duplicate rematch clicks while waiting for rematch acknowledgement', () => {
    const restoreRtc = installFakeRtcPeerConnection()
    try {
      const controller = new AppController('dom')
      controller.startGame('p2p-host')
      const sentPackets: Array<{ type: string; payload: unknown }> = []
      const internals = controller as unknown as {
        p2p: {
          send: (type: string, payload: unknown) => boolean
          isConnected: () => boolean
          close: () => void
        } | null
        state: { game: unknown; pendingRematchSeed: number | null }
      }
      const originalGame = internals.state.game
      internals.p2p = {
        send: (type, payload) => {
          sentPackets.push({ type, payload })
          return true
        },
        isConnected: () => true,
        close: () => {},
      }

      controller.rematch()
      expect(internals.state.pendingRematchSeed).not.toBeNull()
      const action = firstPlayableAction(controller)
      expect(action).toBeTruthy()
      if (action) {
        controller.submitAction(action)
      }
      expect(internals.state.game).toBe(originalGame)
      expect(controller.getViewModel().status).toContain('Rematch in progress')

      controller.rematch()
      expect(controller.getViewModel().status).toContain('Already waiting')
      expect(sentPackets.filter((packet) => packet.type === 'rematch')).toHaveLength(1)
    } finally {
      restoreRtc()
    }
  })

  it('ignores remote actions while start handshake is still pending', () => {
    const restoreRtc = installFakeRtcPeerConnection()
    try {
      const controller = new AppController('dom')
      controller.startGame('p2p-host')
      const internals = controller as unknown as {
        state: { game: unknown; p2pStarted: boolean }
      }
      expect(internals.state.p2pStarted).toBe(false)
      const gameBeforeAction = internals.state.game

      ;(controller as unknown as RemoteActionApplier)
        .applyRecordedAction({ type: 'end_turn', actor: 1 }, 'remote', false)

      expect(internals.state.game).toBe(gameBeforeAction)
      expect(controller.getViewModel().status).toContain('start handshake is in progress')
      const record = parseExported(controller)
      expect(record.timeline).toHaveLength(0)
    } finally {
      restoreRtc()
    }
  })

  it('clears pending P2P handshake state when importing a recording', () => {
    const restoreRtc = installFakeRtcPeerConnection()
    try {
      const controller = new AppController('dom')
      controller.startGame('p2p-host')
      const internals = controller as unknown as {
        p2p: {
          send: (type: string, payload: unknown) => boolean
          isConnected: () => boolean
          close: () => void
        } | null
        state: {
          pendingP2PStartSeed: number | null
          pendingRematchSeed: number | null
          p2pStarted: boolean
        }
      }
      internals.p2p = {
        send: () => true,
        isConnected: () => true,
        close: () => {},
      }
      controller.startP2PGame()
      controller.rematch()
      expect(internals.state.pendingP2PStartSeed).not.toBeNull()
      expect(internals.state.pendingRematchSeed).not.toBeNull()

      controller.startGame('local-hvh')
      const exported = controller.exportRecordingJson()
      expect(exported).toBeTruthy()
      controller.importRecordingJson(exported!)

      expect(internals.state.pendingP2PStartSeed).toBeNull()
      expect(internals.state.pendingRematchSeed).toBeNull()
      expect(internals.state.p2pStarted).toBe(false)
      const action = firstPlayableAction(controller)
      expect(action).toBeTruthy()
      if (action) {
        controller.submitAction(action)
      }
      expect(controller.getViewModel().status).not.toContain('Rematch in progress')
    } finally {
      restoreRtc()
    }
  })

  it('closes P2P and ignores stale peer packets after switching to non-P2P mode', () => {
    const restoreRtc = installFakeRtcPeerConnection()
    try {
      const controller = new AppController('dom')
      controller.startGame('p2p-host')
      const internals = controller as unknown as {
        p2p: {
          onMessage: (packet: { type: string; payload: unknown }) => void
        } | null
        state: { game: unknown }
      }
      const staleOnMessage = internals.p2p!.onMessage.bind(internals.p2p)

      controller.startGame('local-hvh')
      expect(internals.p2p).toBeNull()

      const gameBeforePacket = internals.state.game
      const action = firstPlayableAction(controller)
      expect(action).toBeTruthy()
      staleOnMessage({ type: 'action', payload: action })

      expect(internals.state.game).toBe(gameBeforePacket)
    } finally {
      restoreRtc()
    }
  })
})
