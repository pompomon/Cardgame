import { describe, expect, it } from 'vitest'
import {
  ALL_CARD_ART,
  CARD_BACK_KEY,
  cardArtFallbackKey,
  cardArtFallbackUrl,
  cardArtKey,
  cardArtUrl,
  cardBackUrl,
} from '../app/card-art'
import { cardAssetSlug } from '../app/card-catalog'
import { CARD_VISUAL_STYLE_OPTIONS } from '../app/card-visual-styles'
import { BASIC_LANDS } from '../game/types'

describe('card-art', () => {
  it('produces a deterministic, namespaced texture key per catalog slug and style', () => {
    expect(cardArtKey('Forest', 'classic')).toBe('card-art:classic:gravebloom-dryad')
    expect(cardArtKey('Plains', 'hd')).toBe('card-art:hd:echo-doppelganger')
    expect(cardArtKey('Swamp', 'monochrome')).toBe('card-art:monochrome:memory-vampire')
  })

  it('builds public URLs that follow the public/cards/<style>/<asset-slug>.png layout', () => {
    expect(cardArtUrl('Mountain', 'classic')).toBe('/cards/classic/rooftop-gargoyle.png')
    expect(cardArtUrl('Island', 'hd')).toBe('/cards/hd/signal-siren.png')
    expect(cardArtUrl('Plains', 'monochrome')).toBe('/cards/monochrome/echo-doppelganger.png')
  })

  it('exposes a card-back asset', () => {
    expect(CARD_BACK_KEY).toBe('card-art:back')
    expect(cardBackUrl()).toBe('/cards/card-back.png')
  })

  it('ships a geometric hd-fallback raster only for the hd style', () => {
    for (const land of BASIC_LANDS) {
      const slug = cardAssetSlug(land)
      expect(cardArtFallbackUrl(land, 'hd')).toBe(`/cards/hd-fallback/${slug}.png`)
      expect(cardArtFallbackKey(land, 'hd')).toBe(`card-art:hd-fallback:${slug}`)
      expect(cardArtFallbackUrl(land, 'classic')).toBe(null)
      expect(cardArtFallbackUrl(land, 'monochrome')).toBe(null)
    }
  })

  it('enumerates every (style, land) pair in ALL_CARD_ART', () => {
    expect(ALL_CARD_ART).toHaveLength(CARD_VISUAL_STYLE_OPTIONS.length * BASIC_LANDS.length)
    const keys = new Set(ALL_CARD_ART.map((entry) => entry.key))
    expect(keys.size).toBe(ALL_CARD_ART.length)
    for (const styleOption of CARD_VISUAL_STYLE_OPTIONS) {
      for (const land of BASIC_LANDS) {
        const expectedKey = cardArtKey(land, styleOption.value)
        expect(keys.has(expectedKey)).toBe(true)
        const entry = ALL_CARD_ART.find((candidate) => candidate.key === expectedKey)
        expect(entry?.land).toBe(land)
        expect(entry?.style).toBe(styleOption.value)
        expect(entry?.url).toBe(cardArtUrl(land, styleOption.value))
        if (styleOption.value === 'hd') {
          expect(entry?.fallbackKey).toBe(cardArtFallbackKey(land, 'hd'))
          expect(entry?.fallbackUrl).toBe(`/cards/hd-fallback/${cardAssetSlug(land)}.png`)
        } else {
          expect(entry?.fallbackKey).toBeUndefined()
          expect(entry?.fallbackUrl).toBeUndefined()
        }
      }
    }
  })
})
