import { describe, expect, it } from 'vitest'
import { threeQualityProfile } from '../renderers/three/quality'

describe('Three.js quality policy', () => {
  it.each([[390, 844], [844, 390]])('caps explicit high-quality phone DPR at two in %sx%s', (width, height) => {
    const profile = threeQualityProfile({ preference: 'high', width, height, devicePixelRatio: 4 })
    expect(profile.pixelRatio).toBe(2)
    expect(profile.shadows).toBe(false)
    expect(profile.effectParticles).toBe(3)
    expect(profile.ambienceParticles).toBe(3)
  })

  it('reduces fill rate and effects for low quality without changing gameplay', () => {
    const profile = threeQualityProfile({ preference: 'low', width: 1440, height: 900, devicePixelRatio: 3 })
    expect(profile).toMatchObject({ tier: 'low', pixelRatio: 1, shadows: false, effectParticles: 3, ambienceParticles: 0, backgroundVariant: 'low' })
    expect(Object.isFrozen(profile)).toBe(true)
  })

  it.each([{ reducedMotion: true }, { animationSpeed: 'off' as const }, { hidden: true }])('suppresses motion for %j', (setting) => {
    expect(threeQualityProfile({ preference: 'high', width: 1440, height: 960, ...setting }))
      .toMatchObject({ motion: false, effectParticles: 0, ambienceParticles: 0 })
  })

  it('budgets bounded ambience independently from transient effects', () => {
    expect(threeQualityProfile({ preference: 'high', width: 1440, height: 900 }).ambienceParticles).toBe(8)
    expect(threeQualityProfile({ preference: 'balanced', width: 1440, height: 900 }).ambienceParticles).toBe(3)
    expect(threeQualityProfile({ preference: 'low', width: 1440, height: 900 }).ambienceParticles).toBe(0)
  })

  it('keeps a phone landscape cap when given visible viewport rather than expanded board height', () => {
    const profile = threeQualityProfile({ preference: 'high', width: 844, height: 390, devicePixelRatio: 4 })
    expect(profile).toMatchObject({ pixelRatio: 2, shadows: false, ambienceParticles: 3, backgroundVariant: 'hd' })
  })

  it('uses stable asset tiers when auto quality crosses desktop thresholds', () => {
    expect(threeQualityProfile({ preference: 'auto', width: 1400, height: 900 }))
      .toMatchObject({ tier: 'high', backgroundVariant: 'balanced' })
    expect(threeQualityProfile({ preference: 'auto', width: 390, height: 844 }))
      .toMatchObject({ tier: 'balanced', backgroundVariant: 'balanced' })
  })

  it.each([NaN, Infinity, -2, 0, undefined])('normalizes invalid device ratio %s', (devicePixelRatio) => {
    expect(threeQualityProfile({ preference: 'auto', width: NaN, height: -5, devicePixelRatio }).pixelRatio).toBe(1)
  })
})
