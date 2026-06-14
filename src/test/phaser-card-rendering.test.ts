import { describe, expect, it } from 'vitest'
import { CARD_BACK_KEY } from '../app/card-art'
import {
  canRenderCardBackTexture,
  rasterCardArtTextureCandidates,
  resolveRasterCardArtTextureKey,
} from '../renderers/phaser/card-rendering'

describe('phaser card rendering helpers', () => {
  it('prefers HD primary art before the HD raster fallback', () => {
    expect(rasterCardArtTextureCandidates('Forest', 'hd')).toEqual([
      'card-art:hd:Forest',
      'card-art:hd-fallback:Forest',
    ])
    expect(resolveRasterCardArtTextureKey('Forest', 'hd', (key) => key === 'card-art:hd:Forest')).toBe('card-art:hd:Forest')
  })

  it('uses the HD raster fallback when the primary texture is unavailable', () => {
    expect(resolveRasterCardArtTextureKey('Island', 'hd', (key) => key === 'card-art:hd-fallback:Island')).toBe('card-art:hd-fallback:Island')
  })

  it('does not consider procedural styles raster art', () => {
    expect(rasterCardArtTextureCandidates('Mountain', 'classic')).toEqual([])
    expect(resolveRasterCardArtTextureKey('Mountain', 'classic', () => true)).toBe(null)
  })

  it('detects whether the shared card-back texture can render hidden cards', () => {
    expect(canRenderCardBackTexture((key) => key === CARD_BACK_KEY)).toBe(true)
    expect(canRenderCardBackTexture(() => false)).toBe(false)
  })
})
