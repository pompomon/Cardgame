import { describe, expect, it } from 'vitest'
import {
  labelGameAction,
  labelGameActions,
  projectPlayersForPresentation,
  revealedEnemyHandForSwamp,
} from '../app/game-presentation'
import { HIDDEN_HAND_CARD_NAME, type ControllerKind } from '../app/types'
import { createInitialGame } from '../game/engine'
import type { GameAction } from '../game/types'

const HUMAN_VS_AI: [ControllerKind, ControllerKind] = ['human', 'ai']

describe('shared game presentation', () => {
  it('labels every game action variant and safely handles an unknown action', () => {
    const state = createInitialGame(1)
    state.players[0].hand = [
      { id: 'play-forest', name: 'Forest', type: 'land' },
      { id: 'counter-island', name: 'Island', type: 'land' },
      { id: 'counter-extra', name: 'Mountain', type: 'land' },
    ]
    state.players[0].graveyard = [{ id: 'grave-swamp', name: 'Swamp', type: 'land' }]
    state.players[1].hand = [{ id: 'enemy-plains', name: 'Plains', type: 'land' }]
    state.pendingPlainsReuse = {
      actor: 0,
      reusedInstanceId: 'forest-instance',
      reusedCardName: 'Forest',
    }

    expect(labelGameAction(state, {
      type: 'play_land',
      actor: 0,
      cardId: 'play-forest',
      effectTargetId: 'grave-swamp',
    }, HUMAN_VS_AI)).toBe('Play Forest (return Swamp)')
    expect(labelGameAction(state, {
      type: 'resolve_plains_reuse',
      actor: 0,
      effectTargetId: 'grave-swamp',
    }, HUMAN_VS_AI)).toBe('Reuse Forest (return Swamp)')
    expect(labelGameAction(state, {
      type: 'resolve_swamp_discard',
      actor: 0,
      effectTargetId: 'enemy-plains',
    }, HUMAN_VS_AI, true)).toBe('Discard Plains')
    expect(labelGameAction(state, {
      type: 'counter_land',
      actor: 0,
      discardCardId: 'counter-extra',
    }, HUMAN_VS_AI)).toBe('Counter with Island (discard Island + Mountain)')
    expect(labelGameAction(state, { type: 'end_turn', actor: 0 }, HUMAN_VS_AI)).toBe('End turn')
    expect(labelGameAction(state, { type: 'pass_response', actor: 0 }, HUMAN_VS_AI)).toBe('Pass response')

    const unknown = { type: 'future_action', actor: 0 } as unknown as GameAction
    expect(labelGameAction(state, unknown, HUMAN_VS_AI)).toBe('Unknown action')
  })

  it('disambiguates duplicate action labels while preserving the legal action objects', () => {
    const state = createInitialGame(2)
    state.players[0].hand = [
      { id: 'forest-a', name: 'Forest', type: 'land' },
      { id: 'forest-b', name: 'Forest', type: 'land' },
    ]
    const actions: GameAction[] = [
      { type: 'play_land', actor: 0, cardId: 'forest-a' },
      { type: 'play_land', actor: 0, cardId: 'forest-b' },
      { type: 'end_turn', actor: 0 },
    ]

    const labeled = labelGameActions(state, actions, HUMAN_VS_AI)

    expect(labeled.map((entry) => entry.label)).toEqual([
      'Play Forest [1/2]',
      'Play Forest [2/2]',
      'End turn',
    ])
    expect(labeled.map((entry) => entry.action)).toEqual(actions)
  })

  it('redacts the AI hand and reveals it only for a human Swamp target decision', () => {
    const state = createInitialGame(3)
    state.players[1].hand = [
      { id: 'enemy-a', name: 'Mountain', type: 'land' },
      { id: 'enemy-b', name: 'Forest', type: 'land' },
    ]

    const players = projectPlayersForPresentation(state, HUMAN_VS_AI)
    expect(players[1].handCards.map((card) => card.name)).toEqual([
      HIDDEN_HAND_CARD_NAME,
      HIDDEN_HAND_CARD_NAME,
    ])
    expect(Object.isFrozen(players)).toBe(true)
    expect(Object.isFrozen(players[1].handCards)).toBe(true)
    expect(revealedEnemyHandForSwamp(state, 0, HUMAN_VS_AI)).toBeNull()

    state.phase = 'swamp_target'
    state.pendingSwampDiscard = { actor: 0 }
    expect(revealedEnemyHandForSwamp(state, 0, HUMAN_VS_AI)?.map((card) => card.name))
      .toEqual(['Mountain', 'Forest'])

    state.pendingSwampDiscard = { actor: 1 }
    expect(revealedEnemyHandForSwamp(state, 0, HUMAN_VS_AI)).toBeNull()
  })
})
