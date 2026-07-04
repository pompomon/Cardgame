import { afterEach, describe, expect, it, vi } from 'vitest'

import { withFakeTimers } from './helpers/timers'

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('withFakeTimers', () => {
  it('keeps fake timers active for function thenables until they settle', async () => {
    let resolved = false
    const thenable = Object.assign(() => undefined, {
      then(resolve: (value: string) => void) {
        setTimeout(() => {
          resolved = true
          resolve('done')
        }, 10)
      },
    })

    const result = withFakeTimers(() => thenable)
    const promise = Promise.resolve(result)

    expect(resolved).toBe(false)
    await Promise.resolve()
    vi.runAllTimers()
    await expect(promise).resolves.toBe('done')
  })

  it('treats throwing then getters as non-thenables', () => {
    const value = {
      get then(): never {
        throw new Error('boom')
      },
    }

    expect(() => withFakeTimers(() => value)).not.toThrow()
  })
})
