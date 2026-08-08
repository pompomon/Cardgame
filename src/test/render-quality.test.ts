import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_RENDER_QUALITY_PREFERENCE,
  RENDER_QUALITY_OPTIONS,
  isRenderQualityPreference,
  persistRenderQualityPreference,
  readStoredRenderQualityPreference,
} from '../app/render-quality'

function installMemoryStorage(): void {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      clear: () => { values.clear() },
    },
  })
}

describe('render-quality', () => {
  beforeEach(() => {
    installMemoryStorage()
  })

  it('exposes immutable quality options with automatic selection as the default', () => {
    expect(RENDER_QUALITY_OPTIONS).toEqual([
      { value: 'auto', label: 'Auto' },
      { value: 'high', label: 'High' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'low', label: 'Low' },
    ])
    expect(DEFAULT_RENDER_QUALITY_PREFERENCE).toBe('auto')
  })

  it('validates only declared render-quality preferences', () => {
    for (const option of RENDER_QUALITY_OPTIONS) {
      expect(isRenderQualityPreference(option.value)).toBe(true)
    }
    expect(isRenderQualityPreference('ultra')).toBe(false)
    expect(isRenderQualityPreference(undefined)).toBe(false)
    expect(isRenderQualityPreference({ value: 'auto' })).toBe(false)
  })

  it('defaults missing settings and round-trips valid persisted values', () => {
    expect(readStoredRenderQualityPreference()).toBe(DEFAULT_RENDER_QUALITY_PREFERENCE)
    persistRenderQualityPreference('low')
    expect(readStoredRenderQualityPreference()).toBe('low')
  })

  it('rejects invalid and malformed persisted values', () => {
    localStorage.setItem('cardgame.render-quality', 'ultra')
    expect(readStoredRenderQualityPreference()).toBe(DEFAULT_RENDER_QUALITY_PREFERENCE)
    localStorage.setItem('cardgame.render-quality', '["high"]')
    expect(readStoredRenderQualityPreference()).toBe(DEFAULT_RENDER_QUALITY_PREFERENCE)
  })
})
