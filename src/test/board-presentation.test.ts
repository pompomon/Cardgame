import { describe, expect, it } from 'vitest'
import { BoardPresentationCoordinator } from '../app/board-presentation'

describe('BoardPresentationCoordinator', () => {
  it('switches immediately when no effects are pending', () => {
    const coordinator = new BoardPresentationCoordinator()
    expect(coordinator.resolve(0, false, true)).toBe(0)
    expect(coordinator.resolve(1, false, true)).toBe(1)
  })

  it('delays and coalesces actor changes until effects drain', () => {
    const coordinator = new BoardPresentationCoordinator()
    coordinator.resolve(0, false, true)

    expect(coordinator.resolve(1, true, true)).toBe(0)
    expect(coordinator.resolve(0, true, true)).toBe(0)
    expect(coordinator.resolve(1, true, true)).toBe(0)
    expect(coordinator.effectsDrained()).toBe(true)
    expect(coordinator.currentActor(0)).toBe(1)
    expect(coordinator.effectsDrained()).toBe(false)
  })

  it('cancels a pending switch when the latest actor matches the display', () => {
    const coordinator = new BoardPresentationCoordinator()
    coordinator.resolve(0, false, true)
    coordinator.resolve(1, true, true)
    expect(coordinator.resolve(0, true, true)).toBe(0)
    expect(coordinator.effectsDrained()).toBe(false)
  })

  it('switches immediately when animations are disabled', () => {
    const coordinator = new BoardPresentationCoordinator()
    coordinator.resolve(0, false, true)
    expect(coordinator.resolve(1, true, false)).toBe(1)
    expect(coordinator.effectsDrained()).toBe(false)
  })

  it('drops pending state when reset', () => {
    const coordinator = new BoardPresentationCoordinator()
    coordinator.resolve(0, false, true)
    coordinator.resolve(1, true, true)
    coordinator.reset(1)
    expect(coordinator.effectsDrained()).toBe(false)
    expect(coordinator.currentActor(0)).toBe(1)
  })
})
