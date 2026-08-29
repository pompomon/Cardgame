import { describe, expect, it } from 'vitest'
import {
  BoardPresentationCoordinator,
  resolveBoardPlayerSlots,
} from '../app/board-presentation'
import type { ControllerKind } from '../app/types'

const HUMAN_VS_HUMAN: readonly [ControllerKind, ControllerKind] = ['human', 'human']

describe('BoardPresentationCoordinator', () => {
  it.each([
    ['human versus human', ['human', 'human']],
    ['human versus remote', ['human', 'remote']],
  ] as const)('switches immediately for %s when no effects are pending', (_label, controllers) => {
    const coordinator = new BoardPresentationCoordinator()
    expect(coordinator.resolve(0, controllers, false, true)).toBe(0)
    expect(coordinator.resolve(1, controllers, false, true)).toBe(1)
  })

  it('delays and coalesces actor changes until effects drain', () => {
    const coordinator = new BoardPresentationCoordinator()
    coordinator.resolve(0, HUMAN_VS_HUMAN, false, true)

    expect(coordinator.resolve(1, HUMAN_VS_HUMAN, true, true)).toBe(0)
    expect(coordinator.resolve(0, HUMAN_VS_HUMAN, true, true)).toBe(0)
    expect(coordinator.resolve(1, HUMAN_VS_HUMAN, true, true)).toBe(0)
    expect(coordinator.effectsDrained()).toBe(true)
    expect(coordinator.currentActor(0, HUMAN_VS_HUMAN)).toBe(1)
    expect(coordinator.effectsDrained()).toBe(false)
  })

  it('cancels a pending switch when the latest actor matches the display', () => {
    const coordinator = new BoardPresentationCoordinator()
    coordinator.resolve(0, HUMAN_VS_HUMAN, false, true)
    coordinator.resolve(1, HUMAN_VS_HUMAN, true, true)
    expect(coordinator.resolve(0, HUMAN_VS_HUMAN, true, true)).toBe(0)
    expect(coordinator.effectsDrained()).toBe(false)
  })

  it('switches immediately when animations are disabled', () => {
    const coordinator = new BoardPresentationCoordinator()
    coordinator.resolve(0, HUMAN_VS_HUMAN, false, true)
    expect(coordinator.resolve(1, HUMAN_VS_HUMAN, true, false)).toBe(1)
    expect(coordinator.effectsDrained()).toBe(false)
  })

  it('drops pending state when reset', () => {
    const coordinator = new BoardPresentationCoordinator()
    coordinator.resolve(0, HUMAN_VS_HUMAN, false, true)
    coordinator.resolve(1, HUMAN_VS_HUMAN, true, true)
    coordinator.reset(1)
    expect(coordinator.effectsDrained()).toBe(false)
    expect(coordinator.currentActor(0, HUMAN_VS_HUMAN)).toBe(1)
  })

  it.each([
    ['human versus AI', ['human', 'ai']],
    ['AI versus human', ['ai', 'human']],
    ['AI versus AI', ['ai', 'ai']],
  ] as const)('keeps Player 1 presented for %s', (_label, controllers) => {
    const coordinator = new BoardPresentationCoordinator()
    expect(coordinator.resolve(0, controllers, false, true)).toBe(0)
    expect(coordinator.resolve(1, controllers, false, true)).toBe(0)
    expect(coordinator.resolve(1, controllers, true, false)).toBe(0)
    expect(coordinator.currentActor(1, controllers)).toBe(0)
  })

  it('cancels a pending non-AI switch when the game changes to AI controllers', () => {
    const coordinator = new BoardPresentationCoordinator()
    coordinator.resolve(0, HUMAN_VS_HUMAN, false, true)
    coordinator.resolve(1, HUMAN_VS_HUMAN, true, true)

    expect(coordinator.resolve(1, ['human', 'ai'], true, true)).toBe(0)
    expect(coordinator.effectsDrained()).toBe(false)
  })

  it('pins reset state for AI controllers', () => {
    const coordinator = new BoardPresentationCoordinator()
    coordinator.reset(1, ['ai', 'human'])

    expect(coordinator.currentActor(1, ['ai', 'human'])).toBe(0)
    expect(coordinator.effectsDrained()).toBe(false)
  })

  it('separates fixed table slots from the active player', () => {
    expect(resolveBoardPlayerSlots(0, 1)).toEqual({
      nearIndex: 0,
      farIndex: 1,
      nearIsActive: false,
      farIsActive: true,
    })
  })
})
