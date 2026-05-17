import { describe, expect, it } from 'vitest'
import { ALL_CARD_ART, CARD_BACK_KEY, cardArtKey, cardArtUrl, cardBackUrl } from '../app/card-art'
import { CARD_VISUAL_STYLE_OPTIONS } from '../app/card-visual-styles'
import { BASIC_LANDS } from '../game/types'

describe('card-art', () => {
  it('produces a deterministic, namespaced texture key per (style, land)', () => {
    expect(cardArtKey('Forest', 'classic')).toBe('card-art:classic:Forest')
    expect(cardArtKey('Plains', 'hd')).toBe('card-art:hd:Plains')
    expect(cardArtKey('Swamp', 'monochrome')).toBe('card-art:monochrome:Swamp')
  })

  it('builds public URLs that follow the public/cards/<style>/<land>.png layout', () => {
    expect(cardArtUrl('Mountain', 'classic')).toBe('/cards/classic/Mountain.png')
    expect(cardArtUrl('Island', 'hd')).toBe('/cards/hd/Island.png')
    expect(cardArtUrl('Plains', 'monochrome')).toBe('/cards/monochrome/Plains.png')
  })

  it('exposes a card-back asset', () => {
    expect(CARD_BACK_KEY).toBe('card-art:back')
    expect(cardBackUrl()).toBe('/cards/card-back.png')
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
      }
    }
  })
})
