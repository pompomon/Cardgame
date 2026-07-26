import { describe, expect, it } from 'vitest'
import { CARD_BACK_KEY } from '../app/card-art'
import { CARD_VISUAL_STYLES } from '../app/card-visual-styles'
import {
  canRenderCardBackTexture,
  preloadCardArtEntriesForStyle,
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

  it('selects only entries for the requested art style when preloading', () => {
    for (const style of CARD_VISUAL_STYLES) {
      const entries = preloadCardArtEntriesForStyle(style)
      expect(entries).toHaveLength(5)
      expect(entries.every((entry) => entry.style === style)).toBe(true)
    }
  })

  it('keeps HD fallback metadata on selected HD preload entries', () => {
    const hdEntries = preloadCardArtEntriesForStyle('hd')
    expect(hdEntries).toHaveLength(5)
    expect(hdEntries.every((entry) => entry.style === 'hd')).toBe(true)
    expect(hdEntries.every((entry) => entry.fallbackKey !== undefined && entry.fallbackUrl !== undefined)).toBe(true)
  })
})
