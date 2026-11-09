import { describe, expect, it } from 'vitest'

import { isLegalActionForState } from '../app/action-validation'
import { canonicalActionClasses } from '../game/ai-action-classes'
import { FULL_VIEW, evaluatePosition, weightVector } from '../game/ai-features'
import { createAiRng } from '../game/ai-random'
import {
  actionValue,
  chooseByValue,
  holdsWinningCard,
  playRollout,
  rolloutAction,
  type RolloutSettings,
  type StepMeter,
} from '../game/ai-rollout'
import { HARD_AI_WEIGHTS } from '../game/ai-weights'
import { activeActor, applyAction, createInitialGame, getLegalActions } from '../game/engine'
import type { BattlefieldCard, BasicLand, GameState } from '../game/types'
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

  it('discards at random for a blind opponent and by value for one who sees the hand', () => {
    let state = winningIslandState()
    state.currentPlayer = 1
    state.players[1].hand = [{ id: 'p1-swamp', name: 'Swamp', type: 'land' }]
    state = applyAction(state, { type: 'play_land', actor: 1, cardId: 'p1-swamp' })
    expect(state.phase).toBe('respond')
    state = applyAction(state, { type: 'pass_response', actor: 0 })
    expect(state.phase).toBe('swamp_target')

    const blind = new Set<string>()
    const seeing = new Set<string>()
    for (let seed = 0; seed < 25; seed += 1) {
      const blindAction = rolloutAction({ steps: 0 }, settings(0), state, createAiRng(seed))
      const seeingAction = rolloutAction({ steps: 0 }, settings(0, { opponentSeesHand: true }), state, createAiRng(seed))
      expect(blindAction && isLegalActionForState(state, blindAction)).toBe(true)
      blind.add(JSON.stringify(blindAction))
      seeing.add(JSON.stringify(seeingAction))
    }
    expect(blind.size).toBe(2)
    expect([...seeing]).toEqual([JSON.stringify({ type: 'resolve_swamp_discard', actor: 1, effectTargetId: 'p0-win' })])
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
