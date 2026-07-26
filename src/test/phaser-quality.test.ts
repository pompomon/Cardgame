import { describe, expect, it } from 'vitest'

import { isPhoneSizedViewport, resolveGameResolution } from '../renderers/phaser/quality'

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
