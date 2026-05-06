import { describe, expect, it } from 'vitest'
import { applyAction, createInitialGame } from '../game/engine'
import {
  appendGameRecordStep,
  createGameRecord,
  parseGameRecordJson,
  serializeGameRecord,
  snapshotFromRecord,
} from '../app/game-recording'

describe('game-recording', () => {
  it('round-trips a recording through JSON parse/serialize', () => {
    const initial = createInitialGame(123)
    const record = createGameRecord(123, 'local-hvh', ['human', 'human'], 'basic', initial, 1000)
    const next = applyAction(initial, { type: 'end_turn', actor: 0 })
    const updated = appendGameRecordStep(
      record,
      { type: 'end_turn', actor: 0 },
      next,
      'human',
      1100,
    )

    const payload = serializeGameRecord(updated)
    const parsed = parseGameRecordJson(payload)

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.record.metadata.seed).toBe(123)
      expect(parsed.record.timeline).toHaveLength(1)
      expect(snapshotFromRecord(parsed.record, 0).turn).toBe(1)
      expect(snapshotFromRecord(parsed.record, 0).currentPlayer).toBe(0)
      expect(snapshotFromRecord(parsed.record, 1).turn).toBe(2)
      expect(snapshotFromRecord(parsed.record, 1).currentPlayer).toBe(1)
    }
  })

  it('rejects unsupported versions', () => {
    const payload = JSON.stringify({
      kind: 'cardgame.recording',
      version: 999,
    })
    const parsed = parseGameRecordJson(payload)
    expect(parsed.ok).toBe(false)
  })

  it('rejects malformed timeline steps', () => {
    const initial = createInitialGame(55)
    const payload = JSON.stringify({
      kind: 'cardgame.recording',
      version: 1,
      metadata: {
        seed: 55,
        mode: 'local-hvh',
        controllers: ['human', 'human'],
        aiLevel: 'basic',
        startedAt: 1,
        updatedAt: 1,
        completed: false,
      },
      initialState: initial,
      timeline: [
        {
          index: 9,
          source: 'human',
          action: { type: 'end_turn', actor: 0 },
          state: initial,
          timestamp: 2,
        },
      ],
    })
    const parsed = parseGameRecordJson(payload)
    expect(parsed.ok).toBe(false)
  })

  it('falls back to initial state when snapshot step is beyond an empty timeline', () => {
    const initial = createInitialGame(77)
    const record = createGameRecord(77, 'local-hvh', ['human', 'human'], 'basic', initial, 100)
    const snapshot = snapshotFromRecord(record, 4)
    expect(snapshot.turn).toBe(initial.turn)
    expect(snapshot.currentPlayer).toBe(initial.currentPlayer)
  })

  it('rejects out-of-range action actors in timeline entries', () => {
    const initial = createInitialGame(66)
    const payload = JSON.stringify({
      kind: 'cardgame.recording',
      version: 1,
      metadata: {
        seed: 66,
        mode: 'local-hvh',
        controllers: ['human', 'human'],
        aiLevel: 'basic',
        startedAt: 1,
        updatedAt: 1,
        completed: false,
      },
      initialState: initial,
      timeline: [
        {
          index: 1,
          source: 'human',
          action: { type: 'end_turn', actor: 3 },
          state: initial,
          timestamp: 2,
        },
      ],
    })
    const parsed = parseGameRecordJson(payload)
    expect(parsed.ok).toBe(false)
  })

  it('rejects out-of-range currentPlayer in initial state', () => {
    const initial = createInitialGame(88)
    const payload = JSON.stringify({
      kind: 'cardgame.recording',
      version: 1,
      metadata: {
        seed: 88,
        mode: 'local-hvh',
        controllers: ['human', 'human'],
        aiLevel: 'basic',
        startedAt: 1,
        updatedAt: 1,
        completed: false,
      },
      initialState: { ...initial, currentPlayer: 2 },
      timeline: [],
    })
    const parsed = parseGameRecordJson(payload)
    expect(parsed.ok).toBe(false)
  })

  it('rejects swapped player ids in game state tuple positions', () => {
    const initial = createInitialGame(89)
    const payload = JSON.stringify({
      kind: 'cardgame.recording',
      version: 1,
      metadata: {
        seed: 89,
        mode: 'local-hvh',
        controllers: ['human', 'human'],
        aiLevel: 'basic',
        startedAt: 1,
        updatedAt: 1,
        completed: false,
      },
      initialState: {
        ...initial,
        players: [initial.players[1], initial.players[0]],
      },
      timeline: [],
    })
    const parsed = parseGameRecordJson(payload)
    expect(parsed.ok).toBe(false)
  })

  it('drops unknown root metadata and timeline properties during parse', () => {
    const initial = createInitialGame(99)
    const payload = JSON.stringify({
      kind: 'cardgame.recording',
      version: 1,
      metadata: {
        seed: 99,
        mode: 'local-hvh',
        controllers: ['human', 'human'],
        aiLevel: 'basic',
        startedAt: 1,
        updatedAt: 2,
        completed: false,
        unknownProperty: 'metadata-noise',
      },
      initialState: initial,
      timeline: [
        {
          index: 1,
          source: 'human',
          action: { type: 'end_turn', actor: 0 },
          state: initial,
          timestamp: 3,
          unknownProperty: true,
        },
      ],
      unknownTopLevelProperty: 'unknownData',
    })
    const parsed = parseGameRecordJson(payload)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }
    expect(Object.hasOwn(parsed.record as unknown as Record<string, unknown>, 'unknownTopLevelProperty')).toBe(false)
    expect(Object.hasOwn(parsed.record.metadata as unknown as Record<string, unknown>, 'unknownProperty')).toBe(false)
    expect(Object.hasOwn(parsed.record.timeline[0] as unknown as Record<string, unknown>, 'unknownProperty')).toBe(false)
  })

  it('defaults missing aiLevel metadata to basic for backward compatibility', () => {
    const initial = createInitialGame(1234)
    const payload = JSON.stringify({
      kind: 'cardgame.recording',
      version: 1,
      metadata: {
        seed: 1234,
        mode: 'local-hvh',
        controllers: ['human', 'human'],
        startedAt: 1,
        updatedAt: 1,
        completed: false,
      },
      initialState: initial,
      timeline: [],
    })
    const parsed = parseGameRecordJson(payload)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }
    expect(parsed.record.metadata.aiLevel).toBe('basic')
  })
})
