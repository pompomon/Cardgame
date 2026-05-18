import { describe, expect, it } from 'vitest'

import {
  isGameAction,
  isLegalActionForState,
  isSameAction,
  isSeedPayload,
} from '../app/action-validation'
import { createInitialGame } from '../game/engine'

describe('action-validation', () => {
  describe('isSeedPayload', () => {
    it('accepts payloads with numeric seed', () => {
      expect(isSeedPayload({ seed: 42 })).toBe(true)
    })
    it('rejects non-objects and missing seed', () => {
      expect(isSeedPayload(null)).toBe(false)
      expect(isSeedPayload({})).toBe(false)
      expect(isSeedPayload({ seed: 'x' })).toBe(false)
    })
  })

  describe('isGameAction', () => {
    it('accepts a valid play_land', () => {
      expect(isGameAction({ type: 'play_land', actor: 0, cardId: 'c1' })).toBe(true)
    })
    it('accepts play_land with optional effectTargetId', () => {
      expect(isGameAction({ type: 'play_land', actor: 1, cardId: 'c1', effectTargetId: 't1' })).toBe(true)
    })
    it('rejects unknown types', () => {
      expect(isGameAction({ type: 'nope', actor: 0 })).toBe(false)
    })
    it('rejects missing actor', () => {
      expect(isGameAction({ type: 'end_turn' })).toBe(false)
    })
    it('accepts end_turn and pass_response', () => {
      expect(isGameAction({ type: 'end_turn', actor: 0 })).toBe(true)
      expect(isGameAction({ type: 'pass_response', actor: 1 })).toBe(true)
    })
    it('accepts counter_land with optional discardCardId', () => {
      expect(isGameAction({ type: 'counter_land', actor: 0 })).toBe(true)
      expect(isGameAction({ type: 'counter_land', actor: 0, discardCardId: 'd1' })).toBe(true)
      expect(isGameAction({ type: 'counter_land', actor: 0, discardCardId: 5 })).toBe(false)
    })
    it('accepts resolve_plains_reuse with optional effectTargetId', () => {
      expect(isGameAction({ type: 'resolve_plains_reuse', actor: 0 })).toBe(true)
      expect(isGameAction({ type: 'resolve_plains_reuse', actor: 1, effectTargetId: 't1' })).toBe(true)
    })
    it('rejects resolve_plains_reuse when effectTargetId is not a string', () => {
      expect(isGameAction({ type: 'resolve_plains_reuse', actor: 0, effectTargetId: 5 })).toBe(false)
      expect(isGameAction({ type: 'resolve_plains_reuse', actor: 0, effectTargetId: null })).toBe(false)
    })
  })

  describe('isSameAction', () => {
    it('returns true for identical actions', () => {
      expect(isSameAction(
        { type: 'play_land', actor: 0, cardId: 'c1' },
        { type: 'play_land', actor: 0, cardId: 'c1' },
      )).toBe(true)
    })
    it('returns false when types differ', () => {
      expect(isSameAction(
        { type: 'end_turn', actor: 0 },
        { type: 'pass_response', actor: 0 },
      )).toBe(false)
    })
    it('distinguishes play_land by cardId and effectTargetId', () => {
      expect(isSameAction(
        { type: 'play_land', actor: 0, cardId: 'a' },
        { type: 'play_land', actor: 0, cardId: 'b' },
      )).toBe(false)
      expect(isSameAction(
        { type: 'play_land', actor: 0, cardId: 'a', effectTargetId: 't1' },
        { type: 'play_land', actor: 0, cardId: 'a', effectTargetId: 't2' },
      )).toBe(false)
    })
    it('distinguishes resolve_plains_reuse by effectTargetId', () => {
      expect(isSameAction(
        { type: 'resolve_plains_reuse', actor: 0, effectTargetId: 't1' },
        { type: 'resolve_plains_reuse', actor: 0, effectTargetId: 't1' },
      )).toBe(true)
      expect(isSameAction(
        { type: 'resolve_plains_reuse', actor: 0, effectTargetId: 't1' },
        { type: 'resolve_plains_reuse', actor: 0, effectTargetId: 't2' },
      )).toBe(false)
    })
  })

  describe('isLegalActionForState', () => {
    it('accepts an end_turn action for the active player', () => {
      const game = createInitialGame(1)
      expect(isLegalActionForState(game, { type: 'end_turn', actor: game.currentPlayer })).toBe(true)
    })
    it('rejects an end_turn action from the inactive player', () => {
      const game = createInitialGame(1)
      const inactive = game.currentPlayer === 0 ? 1 : 0
      expect(isLegalActionForState(game, { type: 'end_turn', actor: inactive })).toBe(false)
    })
  })
})
