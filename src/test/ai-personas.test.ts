import { describe, expect, it } from 'vitest'

import { AI_FEATURE_NAMES, weightVector, type AiFeatureName } from '../game/ai-features'
import { AI_PERSONAS, personaForSeat, personaWeightVector, personaWeights, type AiPersona } from '../game/ai-personas'
import { HARD_AI_WEIGHTS } from '../game/ai-weights'

const EMPHASIS: Readonly<Record<AiPersona, { factor: number; features: readonly AiFeatureName[] }>> = {
  balanced: { factor: 1, features: [] },
  racer: { factor: 1.15, features: ['unique', 'kind', 'atThree', 'atFour', 'need', 'gap', 'outsUnique', 'outsKind', 'drawOuts'] },
  controller: {
    factor: 1.2,
    features: ['canCounter', 'counterTwice', 'islands', 'mountainThreat', 'mountainVsFour', 'swamp', 'swampOnWinner'],
  },
  hoarder: { factor: 1.2, features: ['hand', 'plainsReuse', 'forestReturn'] },
}

describe('AI personas', () => {
  it('lists the four personas, balanced first', () => {
    expect(AI_PERSONAS).toEqual(['balanced', 'racer', 'controller', 'hoarder'])
    expect(Object.isFrozen(AI_PERSONAS)).toBe(true)
  })

  it('scales one group of fitted weights per persona and keeps the rest', () => {
    for (const persona of AI_PERSONAS) {
      const weights = personaWeights(persona)
      expect(Object.isFrozen(weights)).toBe(true)
      const { factor, features } = EMPHASIS[persona]
      for (const feature of AI_FEATURE_NAMES) {
        const expected = features.includes(feature) ? HARD_AI_WEIGHTS[feature] * factor : HARD_AI_WEIGHTS[feature]
        expect(weights[feature], `${persona} ${feature}`).toBe(expected)
      }
    }
    expect(personaWeights('balanced')).toEqual(HARD_AI_WEIGHTS)
  })

  it('precomputes the weight vector of every persona', () => {
    for (const persona of AI_PERSONAS) {
      expect(personaWeightVector(persona)).toEqual(weightVector(personaWeights(persona)))
      expect(personaWeightVector(persona)).toBe(personaWeightVector(persona))
    }
    expect(personaWeightVector('unknown' as AiPersona)).toBe(personaWeightVector('balanced'))
  })

  it('gives each seat a persona from the game seed, about evenly', () => {
    const counts = new Map<AiPersona, number>()
    let seatsDiffer = 0
    const seeds = 800
    for (let seed = 0; seed < seeds; seed += 1) {
      const first = personaForSeat(seed, 0)
      expect(personaForSeat(seed, 0)).toBe(first)
      counts.set(first, (counts.get(first) ?? 0) + 1)
      seatsDiffer += personaForSeat(seed, 1) !== first ? 1 : 0
    }
    for (const persona of AI_PERSONAS) {
      expect(counts.get(persona) ?? 0).toBeGreaterThan(seeds * 0.18)
      expect(counts.get(persona) ?? 0).toBeLessThan(seeds * 0.32)
    }
    expect(seatsDiffer).toBeGreaterThan(seeds * 0.6)
  })

  it('uses the high bits of large seeds, such as the time-based seeds of Adventure', () => {
    const base = Date.UTC(2026, 0, 1)
    let differs = 0
    for (let offset = 0; offset < 200; offset += 1) {
      differs += personaForSeat(base + offset, 0) !== personaForSeat(base + offset + 2 ** 32, 0) ? 1 : 0
    }
    expect(differs).toBeGreaterThan(100)
  })
})
