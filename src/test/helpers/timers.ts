import { afterEach, beforeEach, vi } from 'vitest'

function restoreRealTimers(): void {
  vi.clearAllTimers()
  vi.useRealTimers()
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null
  ) {
    return false
  }
  try {
    return typeof (value as { then?: unknown }).then === 'function'
  } catch {
    return false
  }
}

export function withFakeTimers<T>(fn: () => T): T {
  vi.useFakeTimers()
  let result: T
  try {
    result = fn()
  } catch (error) {
    restoreRealTimers()
    throw error
  }
  if (isPromiseLike(result)) {
    return Promise.resolve(result).finally(restoreRealTimers) as unknown as T
  }
  restoreRealTimers()
  return result
}

export function installFakeTimerHooks(): void {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    restoreRealTimers()
  })
}
