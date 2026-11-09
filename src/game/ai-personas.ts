import { weightVector, type AiFeatureName, type AiWeights } from './ai-features'
import { AI_RANDOM_STREAM, createAiRng, deriveAiSeed } from './ai-random'
import { HARD_AI_WEIGHTS } from './ai-weights'

// Personas give the Hard AI a playing style for a whole game. Each scales one
// group of evaluator weights in the searching player's own judgement; the
// model of the opponent keeps the fitted weights. A seat's persona comes from
// the game seed, so it lasts the whole game, including after a pause and
// resume.

export type AiPersona = 'balanced' | 'racer' | 'controller' | 'hoarder'

export const AI_PERSONAS: readonly AiPersona[] = Object.freeze(['balanced', 'racer', 'controller', 'hoarder'])

interface PersonaEmphasis {
  readonly factor: number
  readonly features: readonly AiFeatureName[]
}

const PERSONA_EMPHASIS: Readonly<Record<AiPersona, PersonaEmphasis>> = Object.freeze({
  balanced: { factor: 1, features: [] },
  // Progress toward a winning board.
  racer: {
    factor: 1.15,
    features: ['unique', 'kind', 'atThree', 'atFour', 'need', 'gap', 'outsUnique', 'outsKind', 'drawOuts'],
  },
  // Counters and disruption.
  controller: {
    factor: 1.2,
    features: ['canCounter', 'counterTwice', 'islands', 'mountainThreat', 'mountainVsFour', 'swamp', 'swampOnWinner'],
  },
  // Cards in hand and their reuse.
  hoarder: { factor: 1.2, features: ['hand', 'plainsReuse', 'forestReturn'] },
})

/** The weights a persona judges positions by. */
export function personaWeights(persona: AiPersona, base: AiWeights = HARD_AI_WEIGHTS): AiWeights {
  const emphasis = PERSONA_EMPHASIS[persona] ?? PERSONA_EMPHASIS.balanced
  const weights: Record<AiFeatureName, number> = { ...base }
  for (const feature of emphasis.features) {
    weights[feature] = base[feature] * emphasis.factor
  }
  return Object.freeze(weights)
}

const PERSONA_VECTORS: ReadonlyMap<AiPersona, Float64Array> = new Map(
  AI_PERSONAS.map((persona) => [persona, weightVector(personaWeights(persona))]),
)

/** The weight vector of a persona over the fitted weights. Do not modify it. */
export function personaWeightVector(persona: AiPersona): Float64Array {
  return PERSONA_VECTORS.get(persona) ?? PERSONA_VECTORS.get('balanced')!
}

/** The persona of a seat for the game with this seed. */
export function personaForSeat(seed: number, actor: number): AiPersona {
  return AI_PERSONAS[createAiRng(deriveAiSeed(seed, actor, AI_RANDOM_STREAM.persona)).nextInt(AI_PERSONAS.length)]
}
