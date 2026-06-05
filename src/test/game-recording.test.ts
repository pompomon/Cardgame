import { describe, expect, it } from 'vitest'
import { applyAction, createInitialGame } from '../game/engine'
import {
  appendGameRecordStep,
  createGameRecord,
  parseGameRecordJson,
  sanitizeLogEvents,
  serializeGameRecord,
  snapshotFromRecord,
} from '../app/game-recording'
import type { LogEvent } from '../game/types'

function payloadForValidRecord(seed = 2026): Record<string, unknown> {
  const initial = createInitialGame(seed)
  const record = createGameRecord(seed, 'local-hvh', ['human', 'human'], 'basic', initial, 1000)
  return JSON.parse(serializeGameRecord(record)) as Record<string, unknown>
}

function payloadForRecordWithTimeline(seed = 2027): Record<string, unknown> {
  const initial = createInitialGame(seed)
  const next = applyAction(initial, { type: 'end_turn', actor: 0 })
  const record = appendGameRecordStep(
    createGameRecord(seed, 'local-hvh', ['human', 'human'], 'basic', initial, 1000),
    { type: 'end_turn', actor: 0 },
    next,
    'human',
    1100,
  )
  return JSON.parse(serializeGameRecord(record)) as Record<string, unknown>
}

function parsePayload(payload: Record<string, unknown>) {
  return parseGameRecordJson(JSON.stringify(payload))
}

function metadataOf(payload: Record<string, unknown>): Record<string, unknown> {
  return payload.metadata as Record<string, unknown>
}

function initialStateOf(payload: Record<string, unknown>): Record<string, unknown> {
  return payload.initialState as Record<string, unknown>
}

function timelineStepOf(payload: Record<string, unknown>, index = 0): Record<string, unknown> {
  return (payload.timeline as Array<Record<string, unknown>>)[index]
}

function stepStateOf(payload: Record<string, unknown>, index = 0): Record<string, unknown> {
  return timelineStepOf(payload, index).state as Record<string, unknown>
}

function playerOf(state: Record<string, unknown>, index: 0 | 1): Record<string, unknown> {
  return (state.players as Array<Record<string, unknown>>)[index]
}

function validOversizedEvents(): LogEvent[] {
  return Array.from({ length: 10000 }, (_value, index) => ({
    kind: 'turn_start',
    turn: index + 1,
    actor: 0,
  }))
}

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

  it('back-fills missing events array when loading legacy recordings', () => {
    const initial = createInitialGame(42)
    const record = createGameRecord(42, 'local-hvh', ['human', 'human'], 'basic', initial, 1000)
    // Simulate an old-format recording on disk: serialize, then strip the
    // structured `events` field from initial state and timeline snapshots.
    const payload = JSON.parse(serializeGameRecord(record)) as Record<string, unknown>
    const initialState = payload.initialState as Record<string, unknown>
    delete initialState.events
    for (const step of payload.timeline as Array<Record<string, unknown>>) {
      const stepState = step.state as Record<string, unknown>
      delete stepState.events
    }
    const parsed = parseGameRecordJson(JSON.stringify(payload))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.record.initialState.events).toEqual([])
      // Pre-existing log strings remain untouched.
      expect(parsed.record.initialState.log.length).toBeGreaterThan(0)
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
    expect(legacyBefore.players[1].hand).toHaveLength(0)
    expect(legacyBefore.players[0].battlefield.some((entry) => entry.instanceId === 'self-swamp')).toBe(true)
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

  it('synthesizes resolve_plains_reuse for legacy pass_response when swamp reuse has discard targets', () => {
    const initial = createInitialGame(1404)
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
          hand: [{ id: 'enemy-a', name: 'Forest' as const, type: 'land' as const }],
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
    const payload = JSON.stringify({
      kind: 'cardgame.recording',
      version: 1,
      metadata: {
        seed: 1404,
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

  it.each([
    ['negative seed', (payload: Record<string, unknown>) => { metadataOf(payload).seed = -1 }],
    ['fractional seed', (payload: Record<string, unknown>) => { metadataOf(payload).seed = 1.5 }],
    ['negative startedAt', (payload: Record<string, unknown>) => { metadataOf(payload).startedAt = -1 }],
    ['fractional updatedAt', (payload: Record<string, unknown>) => { metadataOf(payload).updatedAt = 2.5 }],
    ['invalid mode', (payload: Record<string, unknown>) => { metadataOf(payload).mode = 'invalid-mode' }],
    ['invalid controllers', (payload: Record<string, unknown>) => { metadataOf(payload).controllers = ['human', 'bot'] }],
    ['invalid aiLevel', (payload: Record<string, unknown>) => { metadataOf(payload).aiLevel = 'omniscient' }],
    ['invalid completed flag', (payload: Record<string, unknown>) => { metadataOf(payload).completed = 'false' }],
  ])('rejects malformed metadata: %s', (_label, mutate) => {
    const payload = payloadForValidRecord()
    mutate(payload)

    expect(parsePayload(payload).ok).toBe(false)
  })

  it('rejects metadata numeric fields that JSON parses as Infinity', () => {
    const payload = payloadForValidRecord()
    metadataOf(payload).seed = '__INF__'
    const parsed = parseGameRecordJson(JSON.stringify(payload).replace('"__INF__"', '1e309'))

    expect(parsed.ok).toBe(false)
  })

  it.each([
    ['negative turn', (state: Record<string, unknown>) => { state.turn = -1 }],
    ['fractional turn', (state: Record<string, unknown>) => { state.turn = 1.5 }],
    ['negative nextInstanceId', (state: Record<string, unknown>) => { state.nextInstanceId = -1 }],
    ['fractional nextInstanceId', (state: Record<string, unknown>) => { state.nextInstanceId = 2.5 }],
    ['negative landsPlayedThisTurn', (state: Record<string, unknown>) => { playerOf(state, 0).landsPlayedThisTurn = -1 }],
    ['fractional landsPlayedThisTurn', (state: Record<string, unknown>) => { playerOf(state, 0).landsPlayedThisTurn = 1.5 }],
    ['missing player', (state: Record<string, unknown>) => { state.players = (state.players as unknown[]).slice(0, 1) }],
    ['swapped player ids', (state: Record<string, unknown>) => {
      const players = state.players as unknown[]
      state.players = [players[1], players[0]]
    }],
    ['invalid phase', (state: Record<string, unknown>) => { state.phase = 'cleanup' }],
    ['invalid winner', (state: Record<string, unknown>) => { state.winner = 9 }],
    ['invalid currentPlayer', (state: Record<string, unknown>) => { state.currentPlayer = 2 }],
    ['invalid card name', (state: Record<string, unknown>) => {
      const deck = playerOf(state, 0).deck as Array<Record<string, unknown>>
      deck[0] = { ...deck[0], name: 'Bogus' }
    }],
    ['malformed battlefield entry', (state: Record<string, unknown>) => { playerOf(state, 0).battlefield = [{ instanceId: 'bf-1' }] }],
    ['malformed pending land play', (state: Record<string, unknown>) => {
      state.pendingLandPlay = {
        actor: 0,
        card: { id: 'c1', name: 'Forest', type: 'land' },
        effectTargetId: 5,
      }
    }],
    ['pending Plains reuse outside plains_target', (state: Record<string, unknown>) => {
      state.phase = 'main'
      state.pendingPlainsReuse = {
        actor: 0,
        reusedInstanceId: 'p0-1',
        reusedCardName: 'Forest',
      }
    }],
    ['malformed pending Plains reuse', (state: Record<string, unknown>) => {
      state.phase = 'plains_target'
      state.pendingPlainsReuse = {
        actor: 0,
        reusedInstanceId: 'p0-1',
        reusedCardName: 'Plains',
      }
    }],
  ])('rejects malformed initial game state: %s', (_label, mutate) => {
    const payload = payloadForValidRecord()
    mutate(initialStateOf(payload))

    expect(parsePayload(payload).ok).toBe(false)
  })

  it('rejects game-state numeric fields that JSON parses as Infinity', () => {
    const payload = payloadForValidRecord()
    initialStateOf(payload).turn = '__INF__'
    const parsed = parseGameRecordJson(JSON.stringify(payload).replace('"__INF__"', '1e309'))

    expect(parsed.ok).toBe(false)
  })

  it.each([
    ['unknown source', (step: Record<string, unknown>) => { step.source = 'spectator' }],
    ['unknown action discriminant', (step: Record<string, unknown>) => { step.action = { type: 'cheat', actor: 0 } }],
    ['out-of-range action actor', (step: Record<string, unknown>) => { step.action = { type: 'end_turn', actor: 2 } }],
    ['negative timestamp', (step: Record<string, unknown>) => { step.timestamp = -1 }],
    ['fractional timestamp', (step: Record<string, unknown>) => { step.timestamp = 1.5 }],
    ['non-sequential index', (step: Record<string, unknown>) => { step.index = 7 }],
    ['malformed nested state', (step: Record<string, unknown>) => { (step.state as Record<string, unknown>).currentPlayer = 9 }],
  ])('rejects malformed timeline step: %s', (_label, mutate) => {
    const payload = payloadForRecordWithTimeline()
    mutate(timelineStepOf(payload))

    expect(parsePayload(payload).ok).toBe(false)
  })

  it('rejects timeline numeric fields that JSON parses as Infinity', () => {
    const payload = payloadForRecordWithTimeline()
    timelineStepOf(payload).timestamp = '__INF__'
    const parsed = parseGameRecordJson(JSON.stringify(payload).replace('"__INF__"', '1e309'))

    expect(parsed.ok).toBe(false)
  })

  it('sanitizes oversized structured log events from the tail', () => {
    const trailingMalformedEvents = Array.from({ length: 300 }, () => ({ kind: 'unknown_event' }))
    const sanitized = sanitizeLogEvents([
      ...validOversizedEvents(),
      ...trailingMalformedEvents,
    ])

    expect(sanitized).toHaveLength(9700)
    expect(sanitized[0]).toEqual({ kind: 'turn_start', turn: 301, actor: 0 })
    expect(sanitized[sanitized.length - 1]).toEqual({ kind: 'turn_start', turn: 10000, actor: 0 })
    expect(sanitized).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ kind: 'unknown_event' }),
      ]),
    )
  })

  it('sanitizes oversized structured log events when parsing records', () => {
    const payload = payloadForRecordWithTimeline()
    initialStateOf(payload).events = [
      { kind: 'turn_start', turn: 0, actor: 0 },
      { kind: 'unknown_event' },
      ...validOversizedEvents(),
    ]
    stepStateOf(payload).events = [
      { kind: 'turn_start', turn: 0, actor: 0 },
      { kind: 'turn_start', turn: 1.5, actor: 0 },
      ...validOversizedEvents(),
    ]

    const parsed = parsePayload(payload)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }
    expect(parsed.record.initialState.events).toHaveLength(10000)
    expect(parsed.record.initialState.events[0]).toEqual({ kind: 'turn_start', turn: 1, actor: 0 })
    expect(parsed.record.timeline[0].state.events).toHaveLength(10000)
    expect(parsed.record.timeline[0].state.events[0]).toEqual({ kind: 'turn_start', turn: 1, actor: 0 })
    expect(parsed.record.timeline[0].state.events.some((event) => event.kind === 'turn_start' && event.turn === 0)).toBe(false)
  })
})
