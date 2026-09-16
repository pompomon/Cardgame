import { describe, expect, it } from 'vitest'
import {
  CARD_CATALOG,
  cardAssetSlug,
  cardCatalogEntry,
  displayCardName,
} from '../app/card-catalog'
import { BASIC_LANDS } from '../game/types'

describe('card catalog', () => {
  it('defines the exact approved catalog in canonical identity order', () => {
    expect(Object.keys(CARD_CATALOG)).toEqual([
      'Forest',
      'Island',
      'Mountain',
      'Plains',
      'Swamp',
    ])
    expect(CARD_CATALOG).toEqual({
      Forest: {
        serializedKey: 'Forest',
        displayName: 'Gravebloom Dryad',
        assetSlug: 'gravebloom-dryad',
        primaryAbility: {
          name: 'Reclaim',
          rulesText: 'Return one creature from your discard pile to your hand.',
        },
        visualRole: 'green',
      },
      Island: {
        serializedKey: 'Island',
        displayName: 'Signal Siren',
        assetSlug: 'signal-siren',
        primaryAbility: {
          name: 'Listen In',
          rulesText: 'Draw one card.',
        },
        responseAbility: {
          name: 'Intercept',
          rulesText: "Discard Signal Siren and one other card to cancel an opponent's summon.",
        },
        visualRole: 'blue',
      },
      Mountain: {
        serializedKey: 'Mountain',
        displayName: 'Rooftop Gargoyle',
        assetSlug: 'rooftop-gargoyle',
        primaryAbility: {
          name: 'Banish',
          rulesText: "Choose an opposing creature on the board and send it to its owner's discard pile.",
        },
        visualRole: 'red',
      },
      Plains: {
        serializedKey: 'Plains',
        displayName: 'Echo Doppelgänger',
        assetSlug: 'echo-doppelganger',
        primaryAbility: {
          name: 'Mimic',
          rulesText: 'Repeat the ability of one of your other creatures.',
        },
        visualRole: 'white',
      },
      Swamp: {
        serializedKey: 'Swamp',
        displayName: 'Memory Vampire',
        assetSlug: 'memory-vampire',
        primaryAbility: {
          name: 'Drain Memory',
          rulesText: "Choose one card from your opponent's hand for them to discard.",
        },
        visualRole: 'black',
      },
    })
    expect(BASIC_LANDS.map((key) => CARD_CATALOG[key].serializedKey)).toEqual(BASIC_LANDS)
    expect(BASIC_LANDS.filter((key) => CARD_CATALOG[key].responseAbility)).toEqual(['Island'])
  })

  it('uses unique ASCII slugs independently of display copy', () => {
    const slugs = BASIC_LANDS.map(cardAssetSlug)
    expect(new Set(slugs).size).toBe(BASIC_LANDS.length)
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }

    expect(displayCardName('Plains')).toBe('Echo Doppelgänger')
    expect(cardAssetSlug('Plains')).toBe('echo-doppelganger')
  })

  it('freezes the record, entries, nested abilities, and helper results', () => {
    expect(Object.isFrozen(CARD_CATALOG)).toBe(true)
    for (const key of BASIC_LANDS) {
      const entry = CARD_CATALOG[key]
      expect(Object.isFrozen(entry)).toBe(true)
      expect(Object.isFrozen(entry.primaryAbility)).toBe(true)
      if (entry.responseAbility) {
        expect(Object.isFrozen(entry.responseAbility)).toBe(true)
      }
      expect(cardCatalogEntry(key)).toBe(entry)
      expect(displayCardName(key)).toBe(entry.displayName)
      expect(cardAssetSlug(key)).toBe(entry.assetSlug)
    }
  })
})
