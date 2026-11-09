import type { AiWeights } from './ai-features'

// Evaluator weights for the Hard search, in logit units per unit of feature
// difference. Regenerate them with `npm run ai:tune` (see
// docs/agent/testing.md) and bump the version with every change, because the
// version is part of every fixture that records Hard's choices.

export const HARD_AI_WEIGHTS_VERSION = 1

/** Fitted by `npm run ai:tune` on 4000 games (iteration 1). */
export const HARD_AI_WEIGHTS: AiWeights = Object.freeze({
  unique: 0.7325,
  kind: 1.4677,
  atThree: 0.3177,
  atFour: -0.0732,
  need: -0.8346,
  gap: -0.7667,
  winNow: 0.3308,
  winNowToMove: -0.3554,
  winNowUnanswerable: 3.3317,
  twoWinners: -0.3646,
  outsUnique: 0.1013,
  outsKind: 0.1044,
  drawOuts: 1.7938,
  hand: 1.3668,
  canCounter: 0.1993,
  counterTwice: 0.1909,
  islands: -0.0559,
  mountainThreat: 0.9136,
  mountainVsFour: -0.2666,
  swamp: 0.0995,
  swampOnWinner: 0.1402,
  plainsReuse: 0.038,
  forestReturn: -0.1493,
  toMove: 0.264,
})
