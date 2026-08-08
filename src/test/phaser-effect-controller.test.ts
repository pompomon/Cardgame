import { describe, expect, it, vi } from 'vitest'

vi.mock('../renderers/phaser/card-factory', () => ({
  renderStaticCard: vi.fn(),
}))

import type { AppViewModel } from '../app/types'
import { EffectController } from '../renderers/phaser/effect-controller'
import type { BattlefieldCardPlacement } from '../renderers/phaser/effect-anchoring'
import type { EffectAnchor, EffectDescriptor } from '../renderers/phaser/effects'
import type { SceneLayout } from '../renderers/phaser/layout'

const layout = {
  boardColumnLeft: 100,
  boardColumnWidth: 600,
  nonActiveBattlefieldY: 100,
  nonActiveBattlefieldHeight: 150,
  activeBattlefieldY: 400,
  activeBattlefieldHeight: 180,
  cardWidth: 90,
  cardHeight: 120,
  cardGap: 100,
} as SceneLayout

function placement(
  playerIndex: number,
  cardIndex: number,
  cardCount: number,
  x: number,
  y: number,
): BattlefieldCardPlacement {
  return {
    playerIndex,
    cardIndex,
    cardCount,
    x,
    y,
    width: layout.cardWidth,
    height: layout.cardHeight,
  }
}

describe('Phaser effect controller', () => {
  it('retains a queued AI Mountain target and reprojects both endpoints after the turn changes', () => {
    let currentView = {
      animationSpeed: 'normal',
      cardVisualStyle: 'classic',
      game: {
        actor: 1,
        events: [
          { kind: 'play_land', actor: 1, cardName: 'Mountain', sourceInstanceId: 'p1-9' },
          {
            kind: 'ability_mountain_destroy',
            actor: 1,
            target: 0,
            cardName: 'Forest',
            sourceInstanceId: 'p1-9',
            targetInstanceId: 'p0-4',
          },
        ],
      },
    } as unknown as AppViewModel
    const retainedCard = { destroy: vi.fn(), setPosition: vi.fn() }
    const renderRetainedCard = vi.fn(() => retainedCard)
    const runs: Array<{
      anchor: EffectAnchor
      descriptor: EffectDescriptor
      done: () => void
    }> = []
    const playEffect = vi.fn((
      _scene,
      anchor: EffectAnchor,
      descriptor: EffectDescriptor,
      _durationMs: number,
      done: () => void,
    ) => {
      runs.push({ anchor, descriptor, done })
    })
    const scene = { scale: { width: 1280, height: 720 } }
    const onQueueDrained = vi.fn()
    const controller = new EffectController({
      scene: scene as never,
      getLayout: () => layout,
      getCurrentView: () => currentView,
      renderRetainedCard: renderRetainedCard as never,
      playEffect: playEffect as never,
      onQueueDrained,
    })

    controller.recordCardPosition('p0-4', placement(0, 1, 3, 400, 186))
    controller.beginBattlefieldRenderPass()
    controller.recordCardPosition('p1-9', placement(1, 0, 1, 400, 490))
    expect(controller.isBusyOrWillEnqueue(currentView)).toBe(true)
    controller.processAbilityEffects(currentView)

    expect(runs).toHaveLength(1)
    expect(runs[0].descriptor.kind).toBe('play_land')
    expect(renderRetainedCard).toHaveBeenCalledWith(400, 186, 'Forest', 'classic')
    expect(retainedCard.destroy).not.toHaveBeenCalled()

    currentView = {
      ...currentView,
      game: { ...currentView.game!, actor: 0 },
    } as AppViewModel
    controller.beginBattlefieldRenderPass()
    controller.recordCardPosition('p1-9', placement(1, 0, 1, 400, 186))
    controller.processAbilityEffects(currentView)

    expect(retainedCard.setPosition).toHaveBeenLastCalledWith(400, 501)
    runs[0].done()

    expect(runs).toHaveLength(2)
    expect(runs[1].descriptor.kind).toBe('mountain_destroy')
    expect(runs[1].anchor).toEqual({ x: 400, y: 501, width: 90, height: 120 })
    expect(runs[1].descriptor.sourceAnchor).toEqual({
      x: 400,
      y: 186,
      width: 90,
      height: 120,
      playerIndex: 1,
      cardIndex: 0,
      cardCount: 1,
    })

    runs[1].done()
    expect(retainedCard.destroy).toHaveBeenCalledOnce()
    expect(onQueueDrained).toHaveBeenCalledOnce()
    expect(controller.isBusyOrWillEnqueue(currentView)).toBe(false)
  })

  it('reset() invalidates a still-in-flight effect so its later done() cannot affect the new game', () => {
    const currentView = {
      animationSpeed: 'normal',
      cardVisualStyle: 'classic',
      game: {
        actor: 0,
        events: [
          { kind: 'play_land', actor: 0, cardName: 'Mountain', sourceInstanceId: 'p0-1' },
        ],
      },
    } as unknown as AppViewModel
    const runs: Array<{ done: () => void }> = []
    const playEffect = vi.fn((_scene, _anchor, _descriptor, _durationMs, done: () => void) => {
      runs.push({ done })
    })
    const scene = { scale: { width: 1280, height: 720 } }
    const controller = new EffectController({
      scene: scene as never,
      getLayout: () => layout,
      getCurrentView: () => currentView,
      playEffect: playEffect as never,
    })

    controller.recordCardPosition('p0-1', placement(0, 0, 1, 400, 490))
    controller.processAbilityEffects(currentView)
    expect(runs).toHaveLength(1)
    expect(controller.isBusyOrWillEnqueue(currentView)).toBe(true)

    // Simulate starting a new game/scene while the previous effect's tween
    // is still in flight (its `done` callback hasn't fired yet).
    controller.reset()
    const newGameView = {
      animationSpeed: 'normal',
      cardVisualStyle: 'classic',
      game: { actor: 0, events: [] },
    } as unknown as AppViewModel
    expect(controller.isBusyOrWillEnqueue(newGameView)).toBe(false)

    // The stale tween finally completes; it must not resurrect busy state
    // or enqueue into the new game's (now separate) queue.
    runs[0].done()
    expect(controller.isBusyOrWillEnqueue(newGameView)).toBe(false)
  })
})
