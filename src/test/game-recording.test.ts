import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../game/engine'
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
    const record = createGameRecord(123, 'local-hvh', ['human', 'human'], initial, 1000)
    const next = createInitialGame(124)
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
      expect(snapshotFromRecord(parsed.record, 0).turn).toBe(initial.turn)
      expect(snapshotFromRecord(parsed.record, 1).turn).toBe(next.turn)
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
})
