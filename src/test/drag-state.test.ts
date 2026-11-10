import { describe, expect, it, vi } from 'vitest'
import {
  dragPointerType,
  DragStateMachine,
  PEEK_HOLD_MS,
  PEEK_RING_DELAY_MS,
  TOUCH_DRAG_THRESHOLD_PX,
  type DragTimers,
} from '../renderers/shared/drag-state'
import { withFakeTimers } from './helpers/timers'

const touch = (id: number, x: number, y: number) => ({ id, x, y, event: { pointerType: 'touch' } })

describe('DragStateMachine', () => {
  it('detects validated pointer types with a touch fallback', () => {
    expect(dragPointerType({ event: { pointerType: 'mouse' } })).toBe('mouse')
    expect(dragPointerType({ event: { pointerType: 'touch' } })).toBe('touch')
    expect(dragPointerType({ event: { pointerType: 'pen' } })).toBe('pen')
    expect(dragPointerType({ event: { pointerType: 'future-input' }, wasTouch: true })).toBe('touch')
    expect(dragPointerType({ event: null, wasTouch: false })).toBe('mouse')
  })

  it('starts mouse drags immediately and accepts only the owning pointer', () => {
    const state = new DragStateMachine()
    expect(state.begin({
      id: 1,
      x: 10,
      y: 20,
      event: { pointerType: 'mouse' },
    }, 'card-1')).toBe('dragging')
    expect(state.phase).toBe('dragging')
    expect(state.activeCardId).toBe('card-1')
    expect(state.begin({ id: 2, x: 10, y: 20 }, 'card-2')).toBe('ignored')
    expect(state.move({ id: 2, x: 100, y: 100 })).toBe('ignored')
    expect(state.release({ id: 2 })).toBe('ignored')
    expect(state.release({ id: 1 })).toBe('drop')
    expect(state.phase).toBe('settling')
  })

  it('keeps touch and pen taps pending until the movement threshold', () => {
    for (const pointerType of ['touch', 'pen'] as const) {
      const state = new DragStateMachine()
      expect(state.begin({
        id: 1,
        x: 100,
        y: 100,
        wasTouch: pointerType === 'touch',
        event: { pointerType },
      }, `${pointerType}-card`)).toBe('pressed')
      expect(state.move({
        id: 1,
        x: 100 + TOUCH_DRAG_THRESHOLD_PX - 1,
        y: 100,
      })).toBe('pressed')
      expect(state.move({
        id: 1,
        x: 100 + TOUCH_DRAG_THRESHOLD_PX,
        y: 100,
      })).toBe('started')
      expect(state.move({ id: 1, x: 300, y: 200 })).toBe('dragging')
      expect(state.release({ id: 1 })).toBe('drop')
    }
  })

  it('classifies a sub-threshold release as a tap', () => {
    const state = new DragStateMachine()
    expect(state.begin({
      id: 4,
      x: 20,
      y: 20,
      wasTouch: true,
    }, 'tap-card')).toBe('pressed')
    expect(state.move({ id: 4, x: 25, y: 25 })).toBe('pressed')
    expect(state.release({ id: 4 })).toBe('tap')
    expect(state.release({ id: 4 })).toBe('ignored')
  })

  it('makes cancellation and completion idempotent', () => {
    const state = new DragStateMachine()
    expect(state.begin({ id: 8, x: 0, y: 0 }, 'cancel-card')).toBe('dragging')
    expect(state.release({ id: 8, wasCanceled: true })).toBe('canceled')
    expect(state.release({ id: 8, wasCanceled: false })).toBe('ignored')
    expect(state.begin({ id: 9, x: 0, y: 0 }, 'blocked-card')).toBe('ignored')
    expect(state.cancel()).toBe(true)
    state.complete()
    expect(state.cancel()).toBe(false)
    expect(state.phase).toBe('idle')
    expect(state.begin({ id: 9, x: 0, y: 0 }, 'next-card')).toBe('dragging')
  })

  it('rejects malformed pointer snapshots and empty card ids', () => {
    const state = new DragStateMachine()
    expect(state.begin({ id: -1, x: 0, y: 0 }, 'card')).toBe('ignored')
    expect(state.begin({ id: 1.5, x: 0, y: 0 }, 'card')).toBe('ignored')
    expect(state.begin({ id: 1, x: Number.NaN, y: 0 }, 'card')).toBe('ignored')
    expect(state.begin({ id: 1, x: 0, y: 0 }, '')).toBe('ignored')
    expect(state.phase).toBe('idle')
  })

  it('opens a peek after a held touch or pen press and releases it without a tap', () => withFakeTimers(() => {
    for (const pointerType of ['touch', 'pen'] as const) {
      const state = new DragStateMachine()
      const ring = vi.fn()
      const open = vi.fn(() => true)
      expect(state.begin({ id: 1, x: 50, y: 50, event: { pointerType } }, 'card', { ring, open })).toBe('pressed')
      vi.advanceTimersByTime(PEEK_RING_DELAY_MS - 1)
      expect(ring).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(ring).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(PEEK_HOLD_MS - PEEK_RING_DELAY_MS - 1)
      expect(open).not.toHaveBeenCalled()
      expect(state.move({ id: 1, x: 55, y: 55 })).toBe('pressed')
      vi.advanceTimersByTime(1)
      expect(open).toHaveBeenCalledTimes(1)
      expect(state.phase).toBe('peeking')
      expect(state.move({ id: 1, x: 56, y: 56 })).toBe('peeking')
      expect(state.release({ id: 1 })).toBe('peeked')
      vi.runAllTimers()
      expect([ring.mock.calls.length, open.mock.calls.length]).toEqual([1, 1])
    }
  }))

  it('drags instead of peeking once a press moves past the threshold before the hold', () => withFakeTimers(() => {
    const state = new DragStateMachine()
    const ring = vi.fn()
    const open = vi.fn(() => true)
    state.begin(touch(1, 0, 0), 'card', { ring, open })
    vi.advanceTimersByTime(PEEK_HOLD_MS - 1)
    expect(state.move({ id: 1, x: TOUCH_DRAG_THRESHOLD_PX, y: 0 })).toBe('started')
    vi.runAllTimers()
    expect(open).not.toHaveBeenCalled()
    expect(state.release({ id: 1 })).toBe('drop')
  }))

  it('turns an open peek into a drag past the threshold', () => withFakeTimers(() => {
    const state = new DragStateMachine()
    state.begin(touch(1, 0, 0), 'card', { open: () => true })
    vi.advanceTimersByTime(PEEK_HOLD_MS)
    expect(state.phase).toBe('peeking')
    expect(state.move({ id: 1, x: 0, y: TOUCH_DRAG_THRESHOLD_PX })).toBe('started')
    expect(state.release({ id: 1 })).toBe('drop')
  }))

  it('keeps a held press a tap when no peek opens, and never peeks without handlers or for a mouse', () => withFakeTimers(() => {
    const refused = new DragStateMachine()
    const open = vi.fn(() => false)
    refused.begin(touch(1, 0, 0), 'card', { open })
    vi.advanceTimersByTime(PEEK_HOLD_MS)
    expect(open).toHaveBeenCalledTimes(1)
    expect(refused.phase).toBe('pressed')
    expect(refused.release({ id: 1 })).toBe('tap')

    const plain = new DragStateMachine()
    plain.begin(touch(2, 0, 0), 'card')
    vi.advanceTimersByTime(PEEK_HOLD_MS)
    expect(plain.release({ id: 2 })).toBe('tap')

    const mouse = new DragStateMachine()
    const mouseOpen = vi.fn(() => true)
    expect(mouse.begin({ id: 3, x: 0, y: 0, event: { pointerType: 'mouse' } }, 'card', { open: mouseOpen })).toBe('dragging')
    vi.runAllTimers()
    expect(mouseOpen).not.toHaveBeenCalled()
  }))

  it('fires no peek timer after a release, cancellation or completion', () => {
    const pending = new Set<number>()
    let next = 0
    const timers: DragTimers = {
      setTimeout: () => { pending.add(next); return next++ },
      clearTimeout: (handle) => { pending.delete(handle as number) },
    }
    const state = new DragStateMachine(timers)
    for (const end of [
      () => state.release({ id: 1 }),
      () => state.release({ id: 1, wasCanceled: true }),
      () => state.cancel(),
      () => state.complete(),
    ]) {
      state.complete()
      expect(state.begin(touch(1, 0, 0), 'card', { ring: () => {}, open: () => true })).toBe('pressed')
      expect(pending.size).toBe(2)
      end()
      expect(pending.size).toBe(0)
    }
  })
})
