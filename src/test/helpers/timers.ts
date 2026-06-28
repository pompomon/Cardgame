import { afterEach, beforeEach, vi } from 'vitest'

function restoreRealTimers(): void {
  vi.clearAllTimers()
  vi.useRealTimers()
}

export function withFakeTimers<T>(fn: () => T): T {
  vi.useFakeTimers()
  try {
    return fn()
  } finally {
    restoreRealTimers()
  }
}

export function installFakeTimerHooks(): void {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    restoreRealTimers()
  })
}
