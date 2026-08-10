import { describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => ({
  default: {
    Scenes: {
      Events: {
        SHUTDOWN: 'shutdown',
        DESTROY: 'destroy',
      },
    },
  },
}))

import { installSceneCleanup } from '../renderers/phaser/scene-lifecycle'

type Listener = () => void

class FakeEmitter {
  private readonly listeners = new Map<string, Set<Listener>>()

  once(event: string, listener: Listener): void {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }

  off(event: string, listener: Listener): void {
    const listeners = this.listeners.get(event)
    if (!listeners) {
      return
    }
    for (const entry of listeners) {
      if (entry === listener) {
        listeners.delete(entry)
      }
    }
  }

  emit(event: string): void {
    const listeners = [...(this.listeners.get(event) ?? [])]
    this.listeners.delete(event)
    for (const listener of listeners) {
      listener()
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0
  }
}

describe('Phaser scene lifecycle cleanup', () => {
  it.each(['shutdown', 'destroy'])('runs once on %s and detaches both lifecycle paths', (event) => {
    const events = new FakeEmitter()
    const cleanup = vi.fn()
    const run = installSceneCleanup(events, cleanup)

    events.emit(event)
    events.emit(event === 'shutdown' ? 'destroy' : 'shutdown')
    run()

    expect(cleanup).toHaveBeenCalledOnce()
    expect(events.listenerCount('shutdown')).toBe(0)
    expect(events.listenerCount('destroy')).toBe(0)
  })
})
