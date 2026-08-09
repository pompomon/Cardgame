import { describe, expect, it } from 'vitest'
import {
  dragPointerType,
  DragStateMachine,
  TOUCH_DRAG_THRESHOLD_PX,
} from '../renderers/phaser/drag-state'

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
})
