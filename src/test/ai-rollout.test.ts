import { describe, expect, it } from 'vitest'

import { isLegalActionForState } from '../app/action-validation'
import { canonicalActionClasses } from '../game/ai-action-classes'
import { FULL_VIEW, evaluatePosition, weightVector, type AiFeatureView } from '../game/ai-features'
import { createAiRng } from '../game/ai-random'
import {
  actionValue,
  chooseByValue,
  holdsWinningCard,
  isSwampDiscardChoice,
  playRollout,
  rolloutAction,
  type RolloutSettings,
  type StepMeter,
} from '../game/ai-rollout'
import { HARD_AI_WEIGHTS } from '../game/ai-weights'
import { activeActor, applyAction, createInitialGame, getLegalActions } from '../game/engine'
import type { BattlefieldCard, BasicLand, GameAction, GameState } from '../game/types'
import { deepFreeze } from './helpers/deep-freeze'
import { TEST_DECK_KINDS, randomDecisionStates } from './helpers/seeded-games'

const WEIGHTS = weightVector(HARD_AI_WEIGHTS)

function settings(root: number, overrides: Partial<RolloutSettings> = {}): RolloutSettings {
  return {
    root,
    rootWeights: WEIGHTS,
    opponentWeights: WEIGHTS,
    opponentSeesHand: false,
    epsilon: 0.15,
    turns: 4,
    maxRolloutSteps: 400,
    ...overrides,
  }
}

function battlefield(seat: number, names: readonly BasicLand[]): BattlefieldCard[] {
  return names.map((name, index) => ({ instanceId: `p${seat}-bf-${index}`, card: { id: `p${seat}-bf-card-${index}`, name, type: 'land' } }))
}

function sampleStates(): GameState[] {
  return TEST_DECK_KINDS.flatMap((kind, index) => randomDecisionStates(900 + index, kind, 160).filter((_, step) => step % 3 === 0))
}

/** Player 0 to act with Forest, Mountain, Plains and Swamp out and an Island in hand. */
function winningIslandState(opponentHand: GameState['players'][number]['hand'] = []): GameState {
  const state = createInitialGame(80)
  state.players[0].hand = [
    { id: 'p0-win', name: 'Island', type: 'land' },
    { id: 'p0-other', name: 'Forest', type: 'land' },
  ]
  state.players[0].battlefield = battlefield(0, ['Forest', 'Mountain', 'Plains', 'Swamp'])
  state.players[1].hand = opponentHand
  return state
}

/**
 * Swaps `seat`'s first hand card with a deck card of another name: a hand of
 * the same size from the same hidden pool. `null` if no such card is left.
 */
function redealHand(state: GameState, seat: number): GameState | null {
  const player = state.players[seat]
  const first = player.hand[0]
  const index = first ? player.deck.findIndex((card) => card.name !== first.name) : -1
  if (!first || index < 0) {
    return null
  }
  const hand = [player.deck[index], ...player.hand.slice(1)]
  const deck = player.deck.map((card, position) => (position === index ? first : card))
  const players = state.players.map((entry, position) => (position === seat ? { ...entry, hand, deck } : entry))
  return { ...state, players: players as GameState['players'] }
}

describe('AI rollout policy', () => {
  const states = sampleStates()

  it('chooses a legal class representative for whoever acts, in every phase', () => {
    const phases = new Set<string>()
    for (const state of states) {
      const actor = activeActor(state)
      const action = chooseByValue({ steps: 0 }, state, actor, WEIGHTS, FULL_VIEW, 0, null)
      phases.add(state.phase)
      expect(action).not.toBeNull()
      if (!action) continue
      expect(isLegalActionForState(state, action)).toBe(true)
      expect(canonicalActionClasses(state, getLegalActions(state, actor)).map((entry) => entry.representative)).toContainEqual(action)
    }
    expect([...phases].sort()).toEqual(['main', 'plains_target', 'respond', 'swamp_target'])
  })

  it('values actions without applying End Turn or modifying the state', () => {
    for (const state of states.filter((candidate) => candidate.phase === 'main').slice(0, 30)) {
      const frozen = deepFreeze(structuredClone(state))
      const actor = activeActor(frozen)
      for (const action of getLegalActions(frozen, actor)) {
        const meter: StepMeter = { steps: 0 }
        const value = actionValue(meter, frozen, action, actor, WEIGHTS, FULL_VIEW)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
        if (action.type === 'end_turn') {
          expect(meter.steps).toBe(0)
        } else {
          expect(meter.steps).toBeGreaterThan(0)
        }
      }
    }
  })

  it('plays the same rollout for the same generator seed', () => {
    for (const state of states.slice(0, 25)) {
      const root = activeActor(state)
      const first: StepMeter = { steps: 0 }
      const second: StepMeter = { steps: 0 }
      const a = playRollout(first, settings(root), state, state.turn, createAiRng(31))
      const b = playRollout(second, settings(root), state, state.turn, createAiRng(31))
      expect(a).toBe(b)
      expect(first.steps).toBe(second.steps)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThanOrEqual(1)
    }
  })

  it('stops at the root player\'s turn start and within its step limit', () => {
    const start = createInitialGame(12)
    const idle: StepMeter = { steps: 0 }
    expect(playRollout(idle, settings(0, { turns: 0 }), start, start.turn, createAiRng(1))).toBe(evaluatePosition(start, 0, 0, WEIGHTS))
    expect(idle.steps).toBe(0)

    const limited: StepMeter = { steps: 0 }
    playRollout(limited, settings(0, { turns: 50, maxRolloutSteps: 6 }), start, start.turn, createAiRng(1))
    // A decision can value several classes after the limit is checked.
    expect(limited.steps).toBeGreaterThanOrEqual(6)
    expect(limited.steps).toBeLessThan(6 + 40)
  })

  it('does not modify the state it rolls out', () => {
    for (const state of states.slice(0, 20)) {
      const frozen = deepFreeze(structuredClone(state))
      expect(() => playRollout({ steps: 0 }, settings(activeActor(frozen)), frozen, frozen.turn, createAiRng(7))).not.toThrow()
    }
  })

  it('never explores away from a winning land in hand', () => {
    const state = winningIslandState()
    expect(holdsWinningCard(state, 0)).toBe(true)
    for (let seed = 0; seed < 25; seed += 1) {
      const action = chooseByValue({ steps: 0 }, state, 0, WEIGHTS, FULL_VIEW, 1, createAiRng(seed))
      expect(action).toMatchObject({ type: 'play_land', actor: 0, cardId: 'p0-win' })
    }
  })

  it('discards by value from the revealed hand, whether or not the opponent sees it otherwise', () => {
    let state = winningIslandState()
    state.currentPlayer = 1
    state.players[1].hand = [{ id: 'p1-swamp', name: 'Swamp', type: 'land' }]
    state = applyAction(state, { type: 'play_land', actor: 1, cardId: 'p1-swamp' })
    expect(state.phase).toBe('respond')
    state = applyAction(state, { type: 'pass_response', actor: 0 })
    expect(state.phase).toBe('swamp_target')
    expect(isSwampDiscardChoice(state)).toBe(true)

    const discard = { type: 'resolve_swamp_discard', actor: 1, effectTargetId: 'p0-win' }
    for (let seed = 0; seed < 25; seed += 1) {
      expect(rolloutAction({ steps: 0 }, settings(0), state, createAiRng(seed))).toEqual(discard)
      expect(rolloutAction({ steps: 0 }, settings(0, { opponentSeesHand: true }), state, createAiRng(seed))).toEqual(discard)
    }
  })

  it('reveals the hand when Plains reuses a Swamp, but not for other reuses', () => {
    const state = winningIslandState()
    state.currentPlayer = 1
    state.players[1].hand = [{ id: 'p1-plains', name: 'Plains', type: 'land' }]
    state.players[1].battlefield = battlefield(1, ['Swamp', 'Mountain'])
    const reuse = (instanceId: string): GameState => {
      const played = applyAction(state, { type: 'play_land', actor: 1, cardId: 'p1-plains', effectTargetId: instanceId })
      return applyAction(played, { type: 'pass_response', actor: 0 })
    }

    const swampReuse = reuse('p1-bf-0')
    expect(swampReuse.phase).toBe('plains_target')
    expect(isSwampDiscardChoice(swampReuse)).toBe(true)
    for (let seed = 0; seed < 10; seed += 1) {
      expect(rolloutAction({ steps: 0 }, settings(0), swampReuse, createAiRng(seed)))
        .toEqual({ type: 'resolve_plains_reuse', actor: 1, effectTargetId: 'p0-win' })
    }

    const mountainReuse = reuse('p1-bf-1')
    expect(mountainReuse.phase).toBe('plains_target')
    expect(isSwampDiscardChoice(mountainReuse)).toBe(false)
    const redealt = redealHand(mountainReuse, 0)
    expect(redealt).not.toBeNull()
    if (!redealt) return
    for (let seed = 0; seed < 10; seed += 1) {
      expect(rolloutAction({ steps: 0 }, settings(0), redealt, createAiRng(seed)))
        .toEqual(rolloutAction({ steps: 0 }, settings(0), mountainReuse, createAiRng(seed)))
    }
  })

  it('keeps a blind opponent\'s choices outside a Swamp discard independent of the root player\'s hand', () => {
    let compared = 0
    let changedWhenSeeing = 0
    const choose = (state: GameState, root: number, seed: number, opponentSeesHand: boolean) =>
      rolloutAction({ steps: 0 }, settings(root, { opponentSeesHand }), state, createAiRng(seed))
    for (const state of states) {
      const actor = activeActor(state)
      const root = actor === 0 ? 1 : 0
      const redealt = redealHand(state, root)
      if (isSwampDiscardChoice(state) || !redealt) continue
      for (const seed of [3, 4]) {
        expect(choose(redealt, root, seed, false)).toEqual(choose(state, root, seed, false))
      }
      if ([3, 4].some((seed) => JSON.stringify(choose(redealt, root, seed, true)) !== JSON.stringify(choose(state, root, seed, true)))) {
        changedWhenSeeing += 1
      }
      compared += 1
    }
    expect(compared).toBeGreaterThanOrEqual(30)
    // An opponent who sees the hand does react to a redeal.
    expect(changedWhenSeeing).toBeGreaterThan(0)
  })

  it('values a blind opponent\'s Swamp by the best discard it can expect from the hidden pool', () => {
    const state = winningIslandState()
    state.currentPlayer = 1
    state.players[1].hand = [{ id: 'p1-swamp', name: 'Swamp', type: 'land' }]
    state.players[0].deck = ['a', 'b', 'c'].map((suffix) => ({ id: `p0-deck-${suffix}`, name: 'Forest', type: 'land' }))
    const play: GameAction = { type: 'play_land', actor: 1, cardId: 'p1-swamp' }
    const blind: AiFeatureView = { hiddenHandSeat: 0, maskedCardId: undefined }
    // A land play is scored with the mover's top card masked, as it could be drawn.
    const scored: AiFeatureView = { hiddenHandSeat: 0, maskedCardId: state.players[1].deck[0]?.id }
    const target = applyAction(applyAction(state, play), { type: 'pass_response', actor: 0 })
    expect(target.phase).toBe('swamp_target')
    const discardValue = (cardId: string) =>
      evaluatePosition(applyAction(target, { type: 'resolve_swamp_discard', actor: 1, effectTargetId: cardId }), 1, 0, WEIGHTS, scored)
    const island = discardValue('p0-win')
    const forest = discardValue('p0-other')
    expect(island).toBeGreaterThan(forest)

    // Two cards dealt from one Island and four Forests hold the Island with
    // chance 1 - C(4, 2) / C(5, 2) = 0.4.
    const expected = 0.4 * island + 0.6 * forest
    expect(actionValue({ steps: 0 }, deepFreeze(state), play, 1, WEIGHTS, blind)).toBeCloseTo(expected, 12)
    const redealt = structuredClone(state)
    const [win, other] = redealt.players[0].hand
    redealt.players[0].hand = [redealt.players[0].deck[0], other]
    redealt.players[0].deck = [win, ...redealt.players[0].deck.slice(1)]
    expect(actionValue({ steps: 0 }, deepFreeze(redealt), play, 1, WEIGHTS, blind)).toBeCloseTo(expected, 12)
  })

  it('recognizes winning lands in hand', () => {
    const state = createInitialGame(3)
    state.players[0].battlefield = battlefield(0, ['Forest', 'Forest', 'Forest', 'Forest'])
    state.players[0].hand = [{ id: 'h-forest', name: 'Forest', type: 'land' }]
    expect(holdsWinningCard(state, 0)).toBe(true)
    state.players[0].hand = [{ id: 'h-island', name: 'Island', type: 'land' }]
    expect(holdsWinningCard(state, 0)).toBe(false)
    state.players[0].battlefield = battlefield(0, ['Forest', 'Island', 'Mountain', 'Plains'])
    expect(holdsWinningCard(state, 0)).toBe(false)
    state.players[0].hand = [{ id: 'h-swamp', name: 'Swamp', type: 'land' }]
    expect(holdsWinningCard(state, 0)).toBe(true)
  })
})
