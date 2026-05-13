import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ANIMATION_SPEED_OPTIONS,
  DEFAULT_ANIMATION_SPEED,
  MAX_EFFECT_MS,
  MAX_QUEUED_EFFECTS,
  durationMsForSpeed,
  isAnimationSpeed,
  persistAnimationSpeed,
  prefersReducedMotion,
  readStoredAnimationSpeed,
  resolveInitialAnimationSpeed,
} from '../app/animation-settings'

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

function installMatchMedia(matches: boolean): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      matchMedia: () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }),
    },
  })
}

function clearWindow(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: undefined,
  })
}

describe('animation-settings', () => {
  beforeEach(() => {
    installMemoryStorage()
  })

  afterEach(() => {
    clearWindow()
  })

  it('exposes the documented options and defaults', () => {
    expect(ANIMATION_SPEED_OPTIONS.map((entry) => entry.value)).toEqual(['off', 'fast', 'normal', 'slow'])
    expect(DEFAULT_ANIMATION_SPEED).toBe('normal')
    expect(MAX_EFFECT_MS).toBeGreaterThan(0)
    expect(MAX_QUEUED_EFFECTS).toBeGreaterThan(0)
  })

  it('validates animation speed values', () => {
    expect(isAnimationSpeed('off')).toBe(true)
    expect(isAnimationSpeed('fast')).toBe(true)
    expect(isAnimationSpeed('normal')).toBe(true)
    expect(isAnimationSpeed('slow')).toBe(true)
    expect(isAnimationSpeed('invalid')).toBe(false)
    expect(isAnimationSpeed(null)).toBe(false)
  })

  it('round-trips persisted speed through localStorage', () => {
    expect(readStoredAnimationSpeed()).toBeNull()
    persistAnimationSpeed('fast')
    expect(readStoredAnimationSpeed()).toBe('fast')
  })

  it('uses persisted speed even when reduced-motion is requested', () => {
    persistAnimationSpeed('slow')
    installMatchMedia(true)
    expect(resolveInitialAnimationSpeed()).toBe('slow')
  })

  it('defaults to off when reduced-motion is requested and no preference is stored', () => {
    installMatchMedia(true)
    expect(prefersReducedMotion()).toBe(true)
    expect(resolveInitialAnimationSpeed()).toBe('off')
  })

  it('falls back to default speed when neither storage nor reduced-motion is set', () => {
    installMatchMedia(false)
    expect(resolveInitialAnimationSpeed()).toBe(DEFAULT_ANIMATION_SPEED)
  })

  it('caps duration at MAX_EFFECT_MS', () => {
    expect(durationMsForSpeed('off')).toBe(0)
    expect(durationMsForSpeed('fast')).toBeGreaterThan(0)
    for (const option of ANIMATION_SPEED_OPTIONS) {
      expect(durationMsForSpeed(option.value)).toBeLessThanOrEqual(MAX_EFFECT_MS)
    }
  })
})
