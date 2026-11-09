import type { AiWeights } from './ai-features'

// Evaluator weights for the Hard search, in logit units per unit of feature
// difference. Regenerate them with `npm run ai:tune` (see
// docs/agent/testing.md) and bump the version with every change, because the
// version is part of every fixture that records Hard's choices.

export const HARD_AI_WEIGHTS_VERSION = 2

/** Fitted by `npm run ai:tune` on 4000 games covering every mono and dual deck (iteration 2). */
export const HARD_AI_WEIGHTS: AiWeights = Object.freeze({
  unique: 0.5985,
  kind: 1.7902,
  atThree: 0.3736,
  atFour: -0.1076,
  need: -0.7053,
  gap: -0.7203,
  winNow: 0.3446,
  winNowToMove: -0.396,
  winNowUnanswerable: 3.1854,
  twoWinners: -0.2375,
  outsUnique: 0.082,
  outsKind: 0.2172,
  drawOuts: 1.8109,
  hand: 1.2585,
  canCounter: -0.0083,
  counterTwice: 0.1444,
  islands: 0.8915,
  mountainThreat: 1.2125,
  mountainVsFour: -0.3535,
  swamp: 0.124,
  swampOnWinner: 0.1982,
  plainsReuse: -0.0226,
  forestReturn: -0.139,
  toMove: 0.2769,
})
