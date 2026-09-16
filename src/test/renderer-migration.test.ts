import { beforeEach, describe, expect, it } from 'vitest'
import { clearLegacyRendererPreference, removeLegacyRendererSearch } from '../app/renderer-migration'

describe('legacy renderer migration', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value) },
        removeItem: (key: string) => { values.delete(key) },
      },
    })
  })

  it('removes every renderer parameter while preserving unrelated parameters', () => {
    expect(removeLegacyRendererSearch('?renderer=dom&seed=42&renderer=phaser')).toBe('?seed=42')
    expect(removeLegacyRendererSearch('?seed=42')).toBe('?seed=42')
    expect(removeLegacyRendererSearch('?renderer=three')).toBe('')
  })

  it('clears the obsolete stored renderer preference', () => {
    localStorage.setItem('cardgame-renderer', 'phaser')
    expect(clearLegacyRendererPreference()).toBe(true)
    expect(localStorage.getItem('cardgame-renderer')).toBeNull()
  })

  it('does not throw when storage is unavailable', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { removeItem: () => { throw new Error('unavailable') } },
    })
    expect(clearLegacyRendererPreference()).toBe(false)
  })
})
