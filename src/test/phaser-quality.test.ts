import { describe, expect, it } from 'vitest'

import {
  isPhoneSizedViewport,
  resolveGameResolution,
  resolvePhaserQualityProfile,
} from '../renderers/phaser/quality'

describe('phaser quality policy', () => {
  it('treats common phone portrait and landscape viewports as mobile-sized', () => {
    expect(isPhoneSizedViewport(390, 844)).toBe(true)
    expect(isPhoneSizedViewport(844, 390)).toBe(true)
  })

  it('caps phone-sized DPR at 2', () => {
    expect(resolveGameResolution({ width: 390, height: 844, devicePixelRatio: 3 })).toBe(2)
    expect(resolveGameResolution({ width: 430, height: 932, devicePixelRatio: 4 })).toBe(2)
  })

  it('preserves moderate desktop DPR values', () => {
    expect(resolveGameResolution({ width: 1280, height: 820, devicePixelRatio: 2 })).toBe(2)
  })

  it('caps very high non-mobile DPR values at the desktop limit', () => {
    expect(resolveGameResolution({ width: 1440, height: 900, devicePixelRatio: 4 })).toBe(2.5)
  })

  it('falls back to resolution 1 when DPR is invalid', () => {
    expect(resolveGameResolution({ width: 390, height: 844, devicePixelRatio: Number.NaN })).toBe(1)
    expect(resolveGameResolution({ width: 390, height: 844, devicePixelRatio: 0 })).toBe(1)
  })
})

describe('phaser adaptive quality profile', () => {
  const desktop = { width: 1440, height: 900 } as const
  const phone = { width: 390, height: 844 } as const

  it('resolves auto to high on roomy desktop viewports and balanced on phones', () => {
    expect(resolvePhaserQualityProfile({ preference: 'auto', ...desktop }).tier).toBe('high')
    expect(resolvePhaserQualityProfile({ preference: 'auto', ...phone }).tier).toBe('balanced')
  })

  it('resolves auto to balanced on small or unusual non-phone viewports', () => {
    expect(resolvePhaserQualityProfile({ preference: 'auto', width: 1024, height: 700 }).tier).toBe('balanced')
    expect(resolvePhaserQualityProfile({ preference: 'auto', width: Number.NaN, height: -5 }).tier).toBe('balanced')
  })

  it('honours explicit user preferences over device signals', () => {
    expect(resolvePhaserQualityProfile({ preference: 'high', ...phone }).tier).toBe('high')
    expect(resolvePhaserQualityProfile({ preference: 'low', ...desktop }).tier).toBe('low')
    expect(resolvePhaserQualityProfile({ preference: 'balanced', ...desktop }).tier).toBe('balanced')
  })

  it('caps device pixel ratio on high-DPR phones even at the high tier', () => {
    expect(resolvePhaserQualityProfile({ preference: 'high', ...phone }).maxDevicePixelRatio).toBe(2)
    expect(resolvePhaserQualityProfile({ preference: 'low', ...phone }).maxDevicePixelRatio).toBe(1.5)
    expect(resolvePhaserQualityProfile({ preference: 'high', ...desktop }).maxDevicePixelRatio).toBe(2.5)
  })

  it('selects a background variant per tier', () => {
    expect(resolvePhaserQualityProfile({ preference: 'high', ...desktop }).backgroundVariant).toBe('hd')
    expect(resolvePhaserQualityProfile({ preference: 'balanced', ...desktop }).backgroundVariant).toBe('balanced')
    expect(resolvePhaserQualityProfile({ preference: 'low', ...desktop }).backgroundVariant).toBe('low')
  })

  it('bounds ambience and particles by tier and viewport', () => {
    const desktopHigh = resolvePhaserQualityProfile({ preference: 'high', ...desktop })
    expect(desktopHigh.ambience).toBe('full')
    expect(desktopHigh.maxParticles).toBe(8)

    const phoneHigh = resolvePhaserQualityProfile({ preference: 'high', ...phone })
    expect(phoneHigh.maxParticles).toBe(4)

    const balanced = resolvePhaserQualityProfile({ preference: 'balanced', ...desktop })
    expect(balanced.ambience).toBe('reduced')
    expect(balanced.maxParticles).toBe(4)

    const low = resolvePhaserQualityProfile({ preference: 'low', ...desktop })
    expect(low.ambience).toBe('off')
    expect(low.maxParticles).toBe(0)
  })

  it('lets reduced motion, animations-off, and hidden tabs override ambience and tweens', () => {
    const reducedMotion = resolvePhaserQualityProfile({ preference: 'high', ...desktop, reducedMotion: true })
    expect(reducedMotion.ambience).toBe('off')
    expect(reducedMotion.enableMoveTweens).toBe(false)
    expect(reducedMotion.enableHoverTweens).toBe(false)

    const animationsOff = resolvePhaserQualityProfile({ preference: 'high', ...desktop, animationSpeed: 'off' })
    expect(animationsOff.ambience).toBe('off')
    expect(animationsOff.enableMoveTweens).toBe(false)

    const hidden = resolvePhaserQualityProfile({ preference: 'high', ...desktop, documentHidden: true })
    expect(hidden.ambience).toBe('off')
    expect(hidden.maxParticles).toBe(0)

    const visibleAgain = resolvePhaserQualityProfile({ preference: 'high', ...desktop, documentHidden: false })
    expect(visibleAgain.ambience).toBe('full')
    expect(visibleAgain.enableMoveTweens).toBe(true)
  })

  it('keeps move tweens but drops hover tweens on the low tier', () => {
    const low = resolvePhaserQualityProfile({ preference: 'low', ...desktop, animationSpeed: 'normal' })
    expect(low.enableMoveTweens).toBe(true)
    expect(low.enableHoverTweens).toBe(false)
  })

  it('reserves full-detail effects for high-tier non-phone viewports', () => {
    expect(resolvePhaserQualityProfile({ preference: 'high', ...desktop }).effectDetail).toBe('full')
    expect(resolvePhaserQualityProfile({ preference: 'high', ...phone }).effectDetail).toBe('reduced')
    expect(resolvePhaserQualityProfile({ preference: 'balanced', ...desktop }).effectDetail).toBe('reduced')
  })

  it('returns a frozen profile so retained views cannot mutate shared policy', () => {
    expect(Object.isFrozen(resolvePhaserQualityProfile({ preference: 'auto', ...desktop }))).toBe(true)
  })
})
