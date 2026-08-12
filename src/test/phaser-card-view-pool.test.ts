import { describe, expect, it, vi } from 'vitest'
import type { CardView } from '../renderers/phaser/card-view'
import { CardViewPool } from '../renderers/phaser/card-view-pool'

function fakeView(): { resetForPool: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> } {
  return {
    resetForPool: vi.fn(),
    destroy: vi.fn(),
  }
}

function createPool(maxSize?: number): {
  readonly pool: CardViewPool
  readonly created: ReturnType<typeof fakeView>[]
} {
  const created: ReturnType<typeof fakeView>[] = []
  const pool = new CardViewPool(() => {
    const view = fakeView()
    created.push(view)
    return view as unknown as CardView
  }, maxSize)
  return { pool, created }
}

describe('CardViewPool', () => {
  it('creates a new view only when the pool is empty', () => {
    const { pool, created } = createPool()

    const first = pool.acquire()
    expect(created).toHaveLength(1)
    expect(pool.size).toBe(0)

    pool.release(first)
    expect(pool.size).toBe(1)

    const second = pool.acquire()
    expect(second).toBe(first)
    expect(created).toHaveLength(1)
    expect(pool.size).toBe(0)
  })

  it('fully resets a view before making it available for reuse', () => {
    const { pool } = createPool()
    const view = pool.acquire()

    pool.release(view)

    expect((view as unknown as ReturnType<typeof fakeView>).resetForPool).toHaveBeenCalledOnce()
    expect((view as unknown as ReturnType<typeof fakeView>).destroy).not.toHaveBeenCalled()
  })

  it('destroys the excess view instead of retaining it once the pool is at capacity', () => {
    const { pool, created } = createPool(2)
    const views = [pool.acquire(), pool.acquire(), pool.acquire()]

    pool.release(views[0])
    pool.release(views[1])
    expect(pool.size).toBe(2)

    pool.release(views[2])

    expect(pool.size).toBe(2)
    expect((views[2] as unknown as ReturnType<typeof fakeView>).destroy).toHaveBeenCalledOnce()
    expect(created).toHaveLength(3)
  })

  it('treats releasing the same view twice as a no-op', () => {
    const { pool } = createPool()
    const view = pool.acquire()

    pool.release(view)
    pool.release(view)

    expect(pool.size).toBe(1)
    expect((view as unknown as ReturnType<typeof fakeView>).resetForPool).toHaveBeenCalledOnce()
  })

  it('treats a non-positive or fractional max size as zero available capacity', () => {
    const { pool: zeroPool } = createPool(0)
    const zeroView = zeroPool.acquire()
    zeroPool.release(zeroView)
    expect(zeroPool.size).toBe(0)
    expect((zeroView as unknown as ReturnType<typeof fakeView>).destroy).toHaveBeenCalledOnce()

    const { pool: fractionalPool } = createPool(1.9)
    const first = fractionalPool.acquire()
    const second = fractionalPool.acquire()
    fractionalPool.release(first)
    fractionalPool.release(second)
    expect(fractionalPool.size).toBe(1)
  })

  it('destroys every pooled view and clears the pool exactly once', () => {
    const { pool } = createPool()
    const views = [pool.acquire(), pool.acquire()]
    pool.release(views[0])
    pool.release(views[1])
    expect(pool.size).toBe(2)

    pool.destroy()

    expect(pool.size).toBe(0)
    for (const view of views) {
      expect((view as unknown as ReturnType<typeof fakeView>).destroy).toHaveBeenCalledOnce()
    }

    // A previously acquired-then-released view must not resurface after
    // destroy(); the next acquire() must create a fresh view.
    const afterDestroy = pool.acquire()
    expect(afterDestroy).not.toBe(views[0])
    expect(afterDestroy).not.toBe(views[1])
  })
})
