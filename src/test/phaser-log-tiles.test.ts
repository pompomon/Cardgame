import { describe, expect, it, vi } from 'vitest'

// log-tiles.ts's buildLogTiles depends (via card-factory.ts) on
// button.ts/visual-primitives.ts, which do a runtime `import Phaser from
// 'phaser'` that requires `window` and blows up under vitest's default node
// environment. Mock it — this file only exercises the pure
// selectVisibleLogEvents/selectVisibleLegacyLogLines/buildLogA11yLines
// helpers, none of which touch Phaser.
vi.mock('phaser', () => ({ default: {} }))

import {
  buildLogA11yLines,
  selectVisibleLegacyLogLines,
  selectVisibleLogEvents,
} from '../renderers/phaser/log-tiles'
import { MAX_RENDERED_LOG_TILES } from '../renderers/phaser/scene-config'
import type { LogEvent } from '../game/types'

function drawEvents(count: number): LogEvent[] {
  return Array.from({ length: count }, (_, index) => ({ kind: 'draw', actor: index % 2, cardName: 'Forest' }) as LogEvent)
}

describe('selectVisibleLogEvents', () => {
  it('returns every event and zero omitted when under the cap', () => {
    const events = drawEvents(5)
    expect(selectVisibleLogEvents(events)).toEqual({ visible: events, omittedCount: 0 })
  })

  it('returns exactly MAX_RENDERED_LOG_TILES events when exactly at the cap', () => {
    const events = drawEvents(MAX_RENDERED_LOG_TILES)
    const result = selectVisibleLogEvents(events)
    expect(result.omittedCount).toBe(0)
    expect(result.visible).toHaveLength(MAX_RENDERED_LOG_TILES)
  })

  it('caps to the most recent MAX_RENDERED_LOG_TILES events and reports the omitted count', () => {
    const events = drawEvents(MAX_RENDERED_LOG_TILES + 37)
    const result = selectVisibleLogEvents(events)
    expect(result.omittedCount).toBe(37)
    expect(result.visible).toHaveLength(MAX_RENDERED_LOG_TILES)
    // Keeps the *tail* (most recent), not the head.
    expect(result.visible[0]).toBe(events[37])
    expect(result.visible[result.visible.length - 1]).toBe(events[events.length - 1])
  })

  it('handles an empty event list', () => {
    expect(selectVisibleLogEvents([])).toEqual({ visible: [], omittedCount: 0 })
  })
})

describe('selectVisibleLegacyLogLines', () => {
  it('returns every line and zero omitted when under the cap', () => {
    const lines = ['a', 'b', 'c']
    expect(selectVisibleLegacyLogLines(lines)).toEqual({ visible: lines, omittedCount: 0 })
  })

  it('caps to the most recent MAX_RENDERED_LOG_TILES lines and reports the omitted count', () => {
    const lines = Array.from({ length: MAX_RENDERED_LOG_TILES + 12 }, (_, index) => `line-${index}`)
    const result = selectVisibleLegacyLogLines(lines)
    expect(result.omittedCount).toBe(12)
    expect(result.visible).toHaveLength(MAX_RENDERED_LOG_TILES)
    expect(result.visible[0]).toBe('line-12')
    expect(result.visible[result.visible.length - 1]).toBe(`line-${lines.length - 1}`)
  })
})

describe('buildLogA11yLines', () => {
  it('shows the empty placeholder when both events and legacyLog are empty', () => {
    expect(buildLogA11yLines([], [])).toEqual(['No log entries yet.'])
  })

  it('prefers structured events over legacyLog when both are present', () => {
    const events: LogEvent[] = [{ kind: 'draw', actor: 0, cardName: 'Forest' }]
    const lines = buildLogA11yLines(events, ['legacy line that should be ignored'])
    expect(lines).toEqual(['P1 draws Forest'])
  })

  it('falls back to legacyLog verbatim when events is empty (legacy back-filled recording)', () => {
    const lines = buildLogA11yLines([], ['P1 draws Forest', 'P2 draws Island'])
    expect(lines).toEqual(['P1 draws Forest', 'P2 draws Island'])
  })

  it('prepends an omitted-count note and keeps only the most recent events when capped', () => {
    const events = drawEvents(MAX_RENDERED_LOG_TILES + 5)
    const lines = buildLogA11yLines(events, [])
    expect(lines[0]).toBe('… 5 older entries omitted')
    expect(lines).toHaveLength(MAX_RENDERED_LOG_TILES + 1)
  })

  it('prepends an omitted-count note for a capped legacy fallback too', () => {
    const lines = Array.from({ length: MAX_RENDERED_LOG_TILES + 3 }, (_, index) => `line-${index}`)
    const result = buildLogA11yLines([], lines)
    expect(result[0]).toBe('… 3 older entries omitted')
    expect(result).toHaveLength(MAX_RENDERED_LOG_TILES + 1)
    expect(result[1]).toBe('line-3')
  })
})
