import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_RENDER_QUALITY_PREFERENCE,
  isRenderQualityPreference,
  persistRenderQualityPreference,
  RENDER_QUALITY_PREFERENCE_OPTIONS,
  readStoredRenderQualityPreference,
} from '../app/render-quality'

function installMemoryStorage(): void {
  const map = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value) },
      removeItem: (key: string) => { map.delete(key) },
      clear: () => { map.clear() },
    },
  })
}

describe('render-quality', () => {
  beforeEach(() => {
    installMemoryStorage()
  })

  it('exposes quality preferences and default', () => {
    expect(RENDER_QUALITY_PREFERENCE_OPTIONS.map((entry) => entry.value)).toEqual(['auto', 'high', 'balanced', 'low'])
    expect(DEFAULT_RENDER_QUALITY_PREFERENCE).toBe('auto')
  })

  it('validates quality preference values', () => {
    expect(isRenderQualityPreference('auto')).toBe(true)
    expect(isRenderQualityPreference('high')).toBe(true)
    expect(isRenderQualityPreference('balanced')).toBe(true)
    expect(isRenderQualityPreference('low')).toBe(true)
    expect(isRenderQualityPreference('ultra')).toBe(false)
    expect(isRenderQualityPreference(null)).toBe(false)
  })

  it('round-trips stored preference and falls back on invalid/malformed values', () => {
    expect(readStoredRenderQualityPreference()).toBe(DEFAULT_RENDER_QUALITY_PREFERENCE)
    persistRenderQualityPreference('low')
    expect(readStoredRenderQualityPreference()).toBe('low')
    localStorage.setItem('cardgame.render-quality', 'invalid')
    expect(readStoredRenderQualityPreference()).toBe(DEFAULT_RENDER_QUALITY_PREFERENCE)
    localStorage.setItem('cardgame.render-quality', '{"oops":true}')
    expect(readStoredRenderQualityPreference()).toBe(DEFAULT_RENDER_QUALITY_PREFERENCE)
  })
})
