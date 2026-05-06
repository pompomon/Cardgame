import { beforeEach, describe, expect, it, vi } from 'vitest'

const { chooseAiActionMock } = vi.hoisted(() => ({
  chooseAiActionMock: vi.fn(),
}))

vi.mock('../game/ai', () => ({
  chooseAiAction: chooseAiActionMock,
}))

import { AppController } from '../app/controller'
import type { GameAction, GameState } from '../game/types'

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
  beforeEach(() => {
    installMemoryStorage()
    vi.useFakeTimers()
    chooseAiActionMock.mockReset()
    chooseAiActionMock.mockImplementation((_state: GameState, actor: number): GameAction => {
      return { type: 'end_turn', actor }
    })
  })

  it('passes selected ai level into local Human vs AI decisions', () => {
    const controller = new AppController('dom')
    controller.setAiLevel('hard')
    controller.startGame('local-hvai')

    controller.submitAction({ type: 'end_turn', actor: 0 })
    vi.advanceTimersByTime(500)

    expect(chooseAiActionMock).toHaveBeenCalled()
    expect(chooseAiActionMock.mock.calls[0][2]).toEqual({ level: 'hard' })
    expect(controller.getViewModel().aiLevel).toBe('hard')
  })

  it('uses one shared selected ai level for both AI players in AI vs AI mode', () => {
    const controller = new AppController('dom')
    controller.setAiLevel('advanced')
    controller.startGame('local-aivai')

    vi.advanceTimersByTime(900)

    const calls = chooseAiActionMock.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls[0][2]).toEqual({ level: 'advanced' })
    expect(calls[1][2]).toEqual({ level: 'advanced' })
    expect(new Set([calls[0][1], calls[1][1]])).toEqual(new Set([0, 1]))
  })
})
