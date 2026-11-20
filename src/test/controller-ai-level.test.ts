import { beforeEach, describe, expect, it, vi } from 'vitest'

const { chooseAiActionMock } = vi.hoisted(() => ({
  chooseAiActionMock: vi.fn(),
}))

vi.mock('../game/ai', () => ({
  chooseAiAction: chooseAiActionMock,
}))

import { AppController } from '../app/controller'
import { actionableAdventureNodes } from '../app/lobby-presentation'
import type { GameAction, GameState } from '../game/types'
import { installFakeTimerHooks } from './helpers/timers'

function installMemoryStorage(): void {
  const map = new Map<string, string>()
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
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

describe('controller ai level wiring', () => {
  installFakeTimerHooks()

  beforeEach(() => {
    installMemoryStorage()
    chooseAiActionMock.mockReset()
    chooseAiActionMock.mockImplementation((_state: GameState, actor: number): GameAction => {
      return { type: 'end_turn', actor }
    })
  })

  it('passes selected ai level into local Human vs AI decisions', () => {
    const controller = new AppController()
    controller.setAiLevel('hard')
    controller.startGame('local-hvai')

    controller.submitAction({ type: 'end_turn', actor: 0 })
    vi.advanceTimersByTime(500)

    expect(chooseAiActionMock).toHaveBeenCalled()
    expect(chooseAiActionMock.mock.calls[0][2]).toEqual({ level: 'hard', seed: controller.getViewModel().seed })
    expect(controller.getViewModel().aiLevel).toBe('hard')
  })

  it('uses one shared selected ai level for both AI players in AI vs AI mode', () => {
    const controller = new AppController()
    controller.setAiLevel('advanced')
    controller.startGame('local-aivai')

    vi.advanceTimersByTime(900)

    const calls = chooseAiActionMock.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(2)
    const seed = controller.getViewModel().seed
    expect(calls[0][2]).toEqual({ level: 'advanced', seed })
    expect(calls[1][2]).toEqual({ level: 'advanced', seed })
    expect(new Set([calls[0][1], calls[1][1]])).toEqual(new Set([0, 1]))
  })
})

describe('controller Auto battle scheduling', () => {
  installFakeTimerHooks()

  beforeEach(() => {
    installMemoryStorage()
    chooseAiActionMock.mockReset()
    chooseAiActionMock.mockImplementation((_state: GameState, actor: number): GameAction => {
      return { type: 'end_turn', actor }
    })
  })

  it.each(['basic', 'advanced', 'hard'] as const)('plays the human seat with Hard while the opponent keeps %s', (level) => {
    const controller = new AppController()
    controller.setAiLevel(level)
    controller.startGame('local-hvai')

    controller.setAutoBattle(true)
    expect(controller.getViewModel().game).toMatchObject({ actor: 0, actorControl: 'ai', canInput: false })
    vi.advanceTimersByTime(350)
    vi.advanceTimersByTime(350)

    const seed = controller.getViewModel().seed
    expect(chooseAiActionMock.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      [0, { level: 'hard', seed }],
      [1, { level, seed }],
    ])
    expect(controller.getViewModel().aiLevel).toBe(level)
  })

  it('makes no move when Take control comes before the pending move', () => {
    const controller = new AppController()
    controller.startGame('local-hvai')

    controller.setAutoBattle(true)
    vi.advanceTimersByTime(200)
    controller.setAutoBattle(false)
    vi.advanceTimersByTime(1000)

    expect(chooseAiActionMock).not.toHaveBeenCalled()
    expect(controller.getViewModel().game).toMatchObject({ actor: 0, actorControl: 'human', canInput: true })
  })

  it('plays the next Adventure encounter with Hard when turned on from the map', () => {
    const controller = new AppController()
    controller.setAiLevel('basic')
    controller.startAdventure()
    controller.setAutoBattle(true)
    expect(chooseAiActionMock).not.toHaveBeenCalled()

    const node = actionableAdventureNodes(controller.getViewModel().adventure)[0]
    controller.startAdventureNode(node.id)
    vi.advanceTimersByTime(350)

    expect(chooseAiActionMock).toHaveBeenCalledTimes(1)
    expect(chooseAiActionMock.mock.calls[0][1]).toBe(0)
    expect(chooseAiActionMock.mock.calls[0][2]).toEqual({ level: 'hard', seed: controller.getViewModel().seed })
  })

  it('hands a stalled seat back when Hard finds no move', () => {
    chooseAiActionMock.mockReturnValue(null)
    const controller = new AppController()
    controller.startGame('local-hvai')

    controller.setAutoBattle(true)
    vi.advanceTimersByTime(1000)
    expect(chooseAiActionMock).toHaveBeenCalledTimes(1)
    expect(controller.getViewModel().game?.canInput).toBe(false)

    controller.setAutoBattle(false)
    expect(controller.getViewModel().game).toMatchObject({ actor: 0, actorControl: 'human', canInput: true })
  })
})
