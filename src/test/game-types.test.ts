import { describe, expect, it } from 'vitest'
import { BASIC_LANDS, isBasicLand } from '../game/types'

describe('game/types', () => {
  it('exposes the canonical basic land list and validator', () => {
    expect(BASIC_LANDS).toEqual(['Forest', 'Island', 'Mountain', 'Plains', 'Swamp'])
    expect(isBasicLand('Forest')).toBe(true)
    expect(isBasicLand('Swamp')).toBe(true)
    expect(isBasicLand('NotALand')).toBe(false)
    expect(isBasicLand(null)).toBe(false)
  })
})
