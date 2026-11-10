import { describe, expect, it } from 'vitest'
import { AI_FEATURE_NAMES } from '../game/ai-features'
import { HARD_AI_WEIGHTS } from '../game/ai-weights'
import { createInitialGame } from '../game/engine'
import type { BattlefieldCard, GameState } from '../game/types'
import { ADVANCED, BASIC, LEGACY_HARD } from './helpers/ai-baselines'
import { behaviourDiagnostics, boardProgress } from './helpers/ai-diagnostics'
import { parseWeightsReport, resolveEntrant } from './helpers/ai-entrants'
import { pendingLandWins, playGame, playMatch, seedRange, summarizeLatency, wilsonInterval, type DeckPair } from './helpers/ai-tournament'
import { deckOfKind } from './helpers/seeded-games'

function battlefield(owner: number, names: BattlefieldCard['card']['name'][]): BattlefieldCard[] {
  return names.map((name, index) => ({
    instanceId: `p${owner}-bf-${index}`,
    card: { id: `p${owner}-bf-card-${index}`, name, type: 'land' },
  }))
}

function respondState(casterBattlefield: BattlefieldCard['card']['name'][], pending: BattlefieldCard['card']['name']): GameState {
  const state = createInitialGame(5)
  state.players[0].battlefield = battlefield(0, casterBattlefield)
  state.players[0].landsPlayedThisTurn = 1
  state.players[1].hand = [
    { id: 'p1-island', name: 'Island', type: 'land' },
    { id: 'p1-forest', name: 'Forest', type: 'land' },
  ]
  state.phase = 'respond'
  state.pendingLandPlay = { actor: 0, card: { id: 'p0-pending', name: pending, type: 'land' } }
  return state
}

describe('AI tournament harness', () => {
  it('computes 95% Wilson intervals', () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 })
    const half = wilsonInterval(50, 100)
    expect(half.low).toBeCloseTo(0.4038, 4)
    expect(half.high).toBeCloseTo(0.5962, 4)
    const strong = wilsonInterval(80, 100)
    expect(strong.low).toBeCloseTo(0.7112, 4)
    expect(strong.high).toBeCloseTo(0.8666, 4)
  })

  it('summarizes latency with floor-indexed quantiles', () => {
    const samples = seedRange(1, 100).reverse()
    expect(summarizeLatency(samples)).toEqual({ count: 100, mean: 50.5, p50: 51, p95: 96, p99: 100, max: 100 })
    expect(summarizeLatency([])).toEqual({ count: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 })
  })

  it('replays a seeded game identically and records only real decisions', () => {
    const policies = [ADVANCED.policy, BASIC.policy] as const
    const first = playGame(12, policies, { recordDecisions: true, clock: () => 0 })
    const second = playGame(12, policies, { recordDecisions: true, clock: () => 0 })
    expect(first.winner).not.toBeNull()
    expect({ winner: second.winner, turns: second.turns }).toEqual({ winner: first.winner, turns: first.turns })
    expect(first.decisions[0].length).toBe(first.latencies[0].length)
    expect(first.decisions[0].every((record) => record.action.actor === 0 && record.gameSeed === 12)).toBe(true)
  })

  it('plays mirrored matches with both seatings and keeps each seat on its deck', () => {
    const decksFor = (seed: number): DeckPair => [undefined, deckOfKind('mono', seed)]
    const result = playMatch(LEGACY_HARD, BASIC, { seeds: seedRange(1, 3), decksFor, clock: () => 0 })
    expect(result.games).toBe(6)
    expect(result.wins + result.losses + result.draws).toBe(6)
    const adventure = playMatch(LEGACY_HARD, BASIC, { seeds: seedRange(1, 3), decksFor, seating: 'first-as-seat-1', clock: () => 0 })
    expect(adventure.games).toBe(3)
  })

  it('tells whether a pending land wins on resolution', () => {
    expect(pendingLandWins(respondState(['Forest', 'Island', 'Mountain', 'Plains'], 'Swamp'))).toBe(true)
    expect(pendingLandWins(respondState(['Forest', 'Island', 'Mountain', 'Plains'], 'Forest'))).toBe(false)
    expect(pendingLandWins(createInitialGame(5))).toBe(false)
  })

  it('scores board progress and counter diagnostics', () => {
    expect(boardProgress([])).toBe(0)
    expect(boardProgress(['Forest', 'Forest', 'Island'])).toBe(2)
    expect(boardProgress(['Forest', 'Forest', 'Forest'])).toBe(3)
    const winning = respondState(['Forest', 'Island', 'Mountain', 'Plains'], 'Swamp')
    const diagnostics = behaviourDiagnostics([
      { state: winning, action: { type: 'counter_land', actor: 1, discardCardId: 'p1-forest' }, gameSeed: 5 },
    ])
    expect(diagnostics.counterWinning).toEqual({ total: 1, hits: 1 })
    expect(diagnostics.counterOther).toEqual({ total: 0, hits: 0 })
  })

  it('judges a Forest return with the played Forest in play', () => {
    const graveForest = { id: 'p0-grave-forest', name: 'Forest', type: 'land' } as const
    const graveSwamp = { id: 'p0-grave-swamp', name: 'Swamp', type: 'land' } as const
    const forest = (graveyard: GameState['players'][number]['graveyard'], effectTargetId: string) => {
      const state = createInitialGame(5)
      state.players[0].hand = [{ id: 'p0-forest', name: 'Forest', type: 'land' }]
      state.players[0].battlefield = battlefield(0, ['Island', 'Mountain', 'Plains'])
      state.players[0].graveyard = graveyard
      const action = { type: 'play_land', actor: 0, cardId: 'p0-forest', effectTargetId } as const
      return behaviourDiagnostics([{ state, action, gameSeed: 5 }]).forestProgressCard
    }
    // A second Forest leaves the board at four kinds; only the Swamp completes five.
    expect(forest([graveForest, graveSwamp], 'p0-grave-swamp')).toEqual({ total: 1, hits: 1 })
    expect(forest([graveForest, graveSwamp], 'p0-grave-forest')).toEqual({ total: 1, hits: 0 })
    expect(forest([graveForest], 'p0-grave-forest')).toEqual({ total: 0, hits: 0 })
  })

  it('resolves entrant specs and rejects malformed ones', () => {
    expect(resolveEntrant('one-ply').name).toBe('one-ply')
    expect(resolveEntrant('advanced@0.25').name).toBe('advanced@0.25')
    expect(() => resolveEntrant('nobody')).toThrow(/Unknown entrant/)
    expect(() => resolveEntrant('advanced@2')).toThrow(/from 0 to 1/)
    expect(() => resolveEntrant('advanced+budget=many')).toThrow(/key=number/)

    const fullNoise = resolveEntrant('basic@1').policy
    const state = createInitialGame(9)
    const action = fullNoise(state, 0, 9)
    expect(fullNoise(state, 0, 9)).toEqual(action)
    const result = playMatch(resolveEntrant('one-ply'), resolveEntrant('random'), { seeds: seedRange(1, 2) })
    expect(result.games).toBe(4)
  })

  it('reads the weights block of a tuning report', () => {
    const block = AI_FEATURE_NAMES.map((name) => `  ${name}: ${HARD_AI_WEIGHTS[name]},`).join('\n')
    const report = `Log-loss: 0.6\n\n\`\`\`ts\n${block}\n\`\`\`\n`
    expect(parseWeightsReport(report)).toEqual(HARD_AI_WEIGHTS)
    expect(() => parseWeightsReport('no block')).toThrow(/no weights block/)
    expect(() => parseWeightsReport('```ts\n  unique: 1,\n```')).toThrow(/no weights for/)
    expect(() => parseWeightsReport('```ts\n  unknownFeature: 1,\n```')).toThrow(/Bad weight line/)
  })
})
