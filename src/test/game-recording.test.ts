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
      version: 2,
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
      version: 2,
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
      version: 2,
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
      version: 2,
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
      version: 2,
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

  it('round-trips recordings containing resolve_plains_reuse actions', () => {
    const initial = createInitialGame(1400)
    const record = createGameRecord(1400, 'local-hvh', ['human', 'human'], 'basic', initial, 1000)
    const plainsReuseState = {
      ...initial,
      phase: 'plains_target' as const,
      pendingPlainsReuse: {
        actor: 0 as const,
        reusedInstanceId: 'self-mountain',
        reusedCardName: 'Mountain' as const,
      },
      pendingLandPlay: null,
    }
    const updated = appendGameRecordStep(
      record,
      { type: 'resolve_plains_reuse', actor: 0, effectTargetId: 'enemy-a' },
      plainsReuseState,
      'human',
      1100,
    )

    const parsed = parseGameRecordJson(serializeGameRecord(updated))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }
    expect(parsed.record.timeline[0].action).toEqual({
      type: 'resolve_plains_reuse',
      actor: 0,
      effectTargetId: 'enemy-a',
    })
    if (parsed.record.timeline[0].action.type === 'resolve_plains_reuse') {
      expect(parsed.record.timeline[0].action.effectTargetId).toBe('enemy-a')
    }
  })

  it('upgrades legacy v1 plains resolution steps with synthesized resolve_plains_reuse', () => {
    const initial = createInitialGame(1401)
    const legacyBefore = {
      ...initial,
      phase: 'respond' as const,
      pendingLandPlay: {
        actor: 0 as const,
        card: { id: 'plains-play', name: 'Plains' as const, type: 'land' as const },
        effectTargetId: 'self-mountain::enemy-a',
      },
      players: [
        {
          ...initial.players[0],
          battlefield: [{ instanceId: 'self-mountain', card: { id: 'self-mountain-card', name: 'Mountain', type: 'land' } }],
        },
        {
          ...initial.players[1],
          battlefield: [{ instanceId: 'enemy-a', card: { id: 'enemy-a-card', name: 'Forest', type: 'land' } }],
        },
      ],
    }
    const legacyAfter = {
      ...initial,
      phase: 'main' as const,
      pendingLandPlay: null,
    }
    const payload = JSON.stringify({
      kind: 'cardgame.recording',
      version: 1,
      metadata: {
        seed: 1401,
        mode: 'local-hvh',
        controllers: ['human', 'human'],
        aiLevel: 'basic',
        startedAt: 1,
        updatedAt: 2,
        completed: false,
      },
      initialState: legacyBefore,
      timeline: [
        {
          index: 1,
          source: 'human',
          action: { type: 'pass_response', actor: 1 },
          state: legacyAfter,
          timestamp: 2,
        },
      ],
    })
    const parsed = parseGameRecordJson(payload)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }
    const synthesized = parsed.record.timeline.find((step) => step.action.type === 'resolve_plains_reuse')
    expect(synthesized).toBeDefined()
    if (synthesized?.action.type === 'resolve_plains_reuse') {
      expect(synthesized.action.effectTargetId).toBe('enemy-a')
    }
  })

  it('upgrades legacy v1 play_land plains resolution when target id includes nested legacy encoding', () => {
    const initial = createInitialGame(1402)
    const legacyBefore = {
      ...initial,
      phase: 'main' as const,
      pendingLandPlay: null,
      players: [
        {
          ...initial.players[0],
          hand: [{ id: 'plains-play', name: 'Plains' as const, type: 'land' as const }],
          battlefield: [{ instanceId: 'self-swamp', card: { id: 'self-swamp-card', name: 'Swamp', type: 'land' } }],
        },
        initial.players[1],
      ],
    }
    const legacyAfter = {
      ...initial,
      phase: 'main' as const,
      pendingLandPlay: null,
    }
    const payload = JSON.stringify({
      kind: 'cardgame.recording',
      version: 1,
      metadata: {
        seed: 1402,
        mode: 'local-hvh',
        controllers: ['human', 'human'],
        aiLevel: 'basic',
        startedAt: 1,
        updatedAt: 2,
        completed: false,
      },
      initialState: legacyBefore,
      timeline: [
        {
          index: 1,
          source: 'human',
          action: { type: 'play_land', actor: 0, cardId: 'plains-play', effectTargetId: 'self-swamp::enemy-a' },
          state: legacyAfter,
          timestamp: 2,
        },
      ],
    })
    const parsed = parseGameRecordJson(payload)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }
    const synthesized = parsed.record.timeline.find((step) => step.action.type === 'resolve_plains_reuse')
    expect(synthesized).toBeDefined()
    if (synthesized?.action.type === 'resolve_plains_reuse') {
      expect(synthesized.action.effectTargetId).toBe('enemy-a')
    }
  })

  it('does not synthesize resolve_plains_reuse when reused land has no nested targets', () => {
    const initial = createInitialGame(1403)
    const legacyBefore = {
      ...initial,
      phase: 'respond' as const,
      pendingLandPlay: {
        actor: 0 as const,
        card: { id: 'plains-play', name: 'Plains' as const, type: 'land' as const },
        effectTargetId: 'self-swamp::enemy-a',
      },
      players: [
        {
          ...initial.players[0],
          battlefield: [{ instanceId: 'self-swamp', card: { id: 'self-swamp-card', name: 'Swamp', type: 'land' } }],
        },
        {
          ...initial.players[1],
          hand: [],
        },
      ],
    }
    const legacyAfter = {
      ...initial,
      phase: 'main' as const,
      pendingLandPlay: null,
      players: [
        legacyBefore.players[0],
        legacyBefore.players[1],
      ],
    }
    expect(legacyAfter.pendingLandPlay).toBeNull()
    const payload = JSON.stringify({
      kind: 'cardgame.recording',
      version: 1,
      metadata: {
        seed: 1403,
        mode: 'local-hvh',
        controllers: ['human', 'human'],
        aiLevel: 'basic',
        startedAt: 1,
        updatedAt: 2,
        completed: false,
      },
      initialState: legacyBefore,
      timeline: [
        {
          index: 1,
          source: 'human',
          action: { type: 'pass_response', actor: 1 },
          state: legacyAfter,
          timestamp: 2,
        },
      ],
    })
    const parsed = parseGameRecordJson(payload)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }
    expect(parsed.record.timeline.some((step) => step.action.type === 'resolve_plains_reuse')).toBe(false)
  })
})
