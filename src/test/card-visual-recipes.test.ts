import { describe, expect, it } from 'vitest'
import { cardAssetSlug } from '../app/card-catalog'
import {
  CARD_VISUAL_GRID_SIZE,
  CARD_VISUAL_RECIPES,
  ORDERED_CARD_VISUAL_RECIPES,
  cardVisualRecipe,
} from '../app/card-visual-recipes'
import { BASIC_LANDS } from '../game/types'

describe('card visual recipes', () => {
  it('maps every stable serialized key to its canonical catalog slug in basic-land order', () => {
    expect(ORDERED_CARD_VISUAL_RECIPES.map((recipe) => recipe.serializedKey)).toEqual(BASIC_LANDS)
    expect(ORDERED_CARD_VISUAL_RECIPES.map((recipe) => recipe.assetSlug)).toEqual(
      BASIC_LANDS.map(cardAssetSlug),
    )
    for (const key of BASIC_LANDS) {
      expect(cardVisualRecipe(key)).toBe(CARD_VISUAL_RECIPES[key])
    }
  })

  it('defines immutable, distinct, bounded creature silhouettes', () => {
    expect(Object.isFrozen(CARD_VISUAL_RECIPES)).toBe(true)
    expect(Object.isFrozen(ORDERED_CARD_VISUAL_RECIPES)).toBe(true)
    const silhouettes = new Set<string>()
    for (const recipe of ORDERED_CARD_VISUAL_RECIPES) {
      expect(Object.isFrozen(recipe)).toBe(true)
      expect(Object.isFrozen(recipe.silhouette)).toBe(true)
      expect(recipe.subject.length).toBeGreaterThan(0)
      expect(recipe.abilityCue.length).toBeGreaterThan(0)
      expect(recipe.silhouette).toHaveLength(CARD_VISUAL_GRID_SIZE)
      expect(recipe.silhouette.every((row) =>
        row.length === CARD_VISUAL_GRID_SIZE && /^[.#+]+$/.test(row),
      )).toBe(true)
      const silhouette = recipe.silhouette.join('\n')
      expect(silhouette).toContain('#')
      silhouettes.add(silhouette)
    }
    expect(silhouettes.size).toBe(BASIC_LANDS.length)
  })
})
