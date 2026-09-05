import { describe, expect, it, vi } from 'vitest'
import type { AppViewModel } from '../app/types'
import type { LogEvent } from '../game/types'
import { MAX_QUEUED_EFFECTS } from '../app/animation-settings'
import { ThreeEffects, presentationBoundary } from '../renderers/three/effects'

function view(events: LogEvent[] = [], actor = 0): AppViewModel {
  return {
    seed: 1, mode: 'local-hvh', controllers: ['human', 'human'],
    animationSpeed: 'normal', cardVisualStyle: 'hd',
    game: { events, actor },
    replay: { active: false, step: 0 },
  } as unknown as AppViewModel
}

const play: LogEvent = { kind: 'play_land', actor: 0, cardName: 'Forest', sourceInstanceId: 'land-1' }

describe('Three.js event presentation', () => {
  it('holds perspective until the queue drains without altering the real actor', () => {
    let finish!: () => void
    const settled = vi.fn()
    const effects = new ThreeEffects((_effect, _duration, done) => { finish = done; return vi.fn() }, settled)
    expect(effects.update(view(), false)).toBe(0)
    const next = view([play], 1)
    expect(effects.update(next, false)).toBe(0)
    effects.pump()
    expect(next.game!.actor).toBe(1)
    finish()
    finish()
    expect(settled).toHaveBeenCalledOnce()
    expect(effects.update(next, false)).toBe(1)
  })

  it('cancels in-flight effects on hidden/reduced motion and ignores late completion', () => {
    let finish!: () => void
    const cancel = vi.fn()
    const settled = vi.fn()
    const effects = new ThreeEffects((_effect, _duration, done) => { finish = done; return cancel }, settled)
    effects.update(view(), false)
    effects.update(view([play], 1), false)
    effects.pump()
    expect(effects.update(view([play], 1), true)).toBe(1)
    expect(cancel).toHaveBeenCalledOnce()
    finish()
    expect(settled).not.toHaveBeenCalled()
    effects.dispose()
    effects.dispose()
  })

  it('bounds the pending tail and reads speed before each effect', () => {
    const callbacks: Array<() => void> = []
    const playback = vi.fn((_effect, _duration, done) => { callbacks.push(done); return vi.fn() })
    const effects = new ThreeEffects(playback, vi.fn())
    effects.update(view(), false)
    const next = view(Array.from({ length: 20 }, (_, index) => ({ ...play, sourceInstanceId: `${index}` })))
    effects.update(next, false)
    effects.pump()
    expect(playback.mock.calls[0][0].sourceInstanceId).toBe(`${20 - MAX_QUEUED_EFFECTS}`)
    effects.update({ ...next, animationSpeed: 'fast' }, false)
    callbacks.shift()!()
    expect(playback.mock.calls[1][1]).toBe(150)
    while (callbacks.length) callbacks.shift()!()
    expect(playback).toHaveBeenCalledTimes(MAX_QUEUED_EFFECTS)
  })

  it('resets on replay rewind, same-seed replacement, and lobby transitions', () => {
    const prior = view([play])
    expect(presentationBoundary(prior, { ...prior, game: null })).toBe(true)
    expect(presentationBoundary(prior, view([{ ...play, sourceInstanceId: 'other' }]))).toBe(true)
    expect(presentationBoundary(
      { ...prior, replay: { ...prior.replay, active: true, step: 3 } },
      { ...prior, replay: { ...prior.replay, active: true, step: 1 } },
    )).toBe(true)
    expect(presentationBoundary(prior, { ...prior, status: 'new status' })).toBe(false)
  })

  it('keeps AI matches pinned and skips historical playback on mounting', () => {
    const playback = vi.fn()
    const effects = new ThreeEffects(playback, vi.fn())
    const aiView = { ...view([play], 1), controllers: ['human', 'ai'] as AppViewModel['controllers'] }
    expect(effects.update(aiView, false)).toBe(0)
    effects.pump()
    expect(playback).not.toHaveBeenCalled()
  })
})
