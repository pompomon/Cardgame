import { describe, expect, it } from 'vitest'
import {
  createViewportResizeScheduler,
  normalizeViewportSize,
  type ViewportSize,
} from '../renderers/phaser/viewport-resize'

describe('Phaser viewport resize synchronization', () => {
  it('normalizes valid host dimensions and rejects unusable measurements', () => {
    expect(normalizeViewportSize(673.4, 841.6)).toEqual({ width: 673, height: 842 })
    expect(normalizeViewportSize(0, 842)).toBeNull()
    expect(normalizeViewportSize(673, Number.NaN)).toBeNull()
  })

  it('applies settled portrait-landscape-portrait sizes without duplicates', () => {
    let measured: ViewportSize | null = { width: 673, height: 842 }
    const applied: ViewportSize[] = []
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrame = 1
    const scheduler = createViewportResizeScheduler(
      () => measured,
      (size) => applied.push(size),
      (callback) => {
        const id = nextFrame++
        frames.set(id, callback)
        return id
      },
      (id) => frames.delete(id),
    )
    const flush = (): void => {
      while (frames.size > 0) {
        const pending = [...frames.entries()]
        frames.clear()
        pending.forEach(([id, callback]) => callback(id))
      }
    }

    scheduler.schedule()
    flush()
    scheduler.schedule()
    flush()
    measured = { width: 842, height: 673 }
    scheduler.schedule()
    scheduler.schedule()
    flush()
    measured = { width: 673, height: 842 }
    scheduler.schedule()
    flush()

    expect(applied).toEqual([
      { width: 673, height: 842 },
      { width: 842, height: 673 },
      { width: 673, height: 842 },
    ])
  })

  it('cancels pending work when disposed', () => {
    const applied: ViewportSize[] = []
    const frames = new Map<number, FrameRequestCallback>()
    const scheduler = createViewportResizeScheduler(
      () => ({ width: 842, height: 673 }),
      (size) => applied.push(size),
      (callback) => {
        frames.set(1, callback)
        return 1
      },
      (id) => frames.delete(id),
    )

    scheduler.schedule()
    scheduler.dispose()

    expect(frames.size).toBe(0)
    expect(applied).toEqual([])
  })
})
