import { describe, expect, it } from 'vitest'
import { cardCatalogEntry, displayCardName } from '../app/card-catalog'
import {
  formatLogEventText,
  formatLogEventTile,
  isLandTileEvent,
  MAX_RENDERED_LOG_TILES,
  presentLegacyLogLine,
  presentLogEvent,
} from '../app/log-presentation'
import type { ControllerKind } from '../app/types'
import { BASIC_LANDS, type LogEvent } from '../game/types'

const HUMAN_VS_AI: [ControllerKind, ControllerKind] = ['human', 'ai']
const HUMAN_VS_HUMAN: [ControllerKind, ControllerKind] = ['human', 'human']

describe('log presentation', () => {
  it('formats every structured event with approved catalog copy', () => {
    const cases: Array<{
      event: LogEvent
      actor: number | null
      label: string
      text: string
      glyph: string
      card: { serializedKey: 'Forest' | 'Island' | 'Mountain' | 'Plains' | 'Swamp'; displayName: string } | null
    }> = [
      {
        event: { kind: 'game_started' },
        actor: null,
        label: 'Game started',
        text: 'Game started',
        glyph: '🏳',
        card: null,
      },
      {
        event: { kind: 'game_start_skip_draw', actor: 0 },
        actor: 0,
        label: 'starts (skips first draw)',
        text: 'P1 starts (skips first draw)',
        glyph: '▶',
        card: null,
      },
      {
        event: { kind: 'turn_start', turn: 12, actor: 1 },
        actor: 1,
        label: 'Turn 12 • Action phase',
        text: 'P2 · Turn 12 • Action phase',
        glyph: '▶',
        card: null,
      },
      {
        event: { kind: 'draw', actor: 0, cardName: 'Forest' },
        actor: 0,
        label: 'draws Gravebloom Dryad',
        text: 'P1 draws Gravebloom Dryad',
        glyph: '+',
        card: { serializedKey: 'Forest', displayName: 'Gravebloom Dryad' },
      },
      {
        event: { kind: 'play_land', actor: 0, cardName: 'Island' },
        actor: 0,
        label: 'summons Signal Siren',
        text: 'P1 summons Signal Siren',
        glyph: '◆',
        card: { serializedKey: 'Island', displayName: 'Signal Siren' },
      },
      {
        event: { kind: 'ability_forest_return', actor: 0, cardName: 'Island' },
        actor: 0,
        label: 'reclaims Signal Siren from their discard pile',
        text: 'P1 reclaims Signal Siren from their discard pile',
        glyph: '↩',
        card: { serializedKey: 'Island', displayName: 'Signal Siren' },
      },
      {
        event: { kind: 'ability_swamp_discard', actor: 0, target: 1, cardName: 'Swamp' },
        actor: 0,
        label: 'drains a memory; P2 discards Memory Vampire',
        text: 'P1 drains a memory; P2 discards Memory Vampire',
        glyph: '✖',
        card: { serializedKey: 'Swamp', displayName: 'Memory Vampire' },
      },
      {
        event: { kind: 'ability_mountain_destroy', actor: 1, target: 0, cardName: 'Island' },
        actor: 1,
        label: "banishes P1's Signal Siren to its owner's discard pile",
        text: "P2 banishes P1's Signal Siren to its owner's discard pile",
        glyph: '✖',
        card: { serializedKey: 'Island', displayName: 'Signal Siren' },
      },
      {
        event: { kind: 'ability_plains_reuse', actor: 0, reusedName: 'Mountain' },
        actor: 0,
        label: 'Echo Doppelgänger mimics Rooftop Gargoyle — Banish',
        text: "P1's Echo Doppelgänger mimics Rooftop Gargoyle — Banish",
        glyph: '↺',
        card: { serializedKey: 'Mountain', displayName: 'Rooftop Gargoyle' },
      },
      {
        event: { kind: 'counter_offered', responder: 1, cardName: 'Island' },
        actor: 1,
        label: "may intercept P1's summon of Signal Siren",
        text: "P2 may intercept P1's summon of Signal Siren",
        glyph: '⏸',
        card: { serializedKey: 'Island', displayName: 'Signal Siren' },
      },
      {
        event: {
          kind: 'counter_resolved',
          actor: 1,
          cardName: 'Island',
          discardCardName: 'Swamp',
        },
        actor: 1,
        label: 'intercepts Signal Siren by discarding Signal Siren and Memory Vampire',
        text: 'P2 intercepts Signal Siren by discarding Signal Siren and Memory Vampire',
        glyph: '✖',
        card: { serializedKey: 'Island', displayName: 'Signal Siren' },
      },
      {
        event: { kind: 'deck_empty_loss', actor: 1 },
        actor: 1,
        label: 'loses (empty deck)',
        text: 'P2 loses (empty deck)',
        glyph: '🏁',
        card: null,
      },
      {
        event: { kind: 'game_end', winner: 'draw' },
        actor: null,
        label: 'Game ends in a draw',
        text: 'Game ends in a draw',
        glyph: '🏁',
        card: null,
      },
      {
        event: { kind: 'game_end', winner: null },
        actor: null,
        label: 'Game ended',
        text: 'Game ended',
        glyph: '🏁',
        card: null,
      },
      {
        event: { kind: 'game_end', winner: 0 },
        actor: 0,
        label: 'wins the game',
        text: 'P1 wins the game',
        glyph: '🏁',
        card: null,
      },
    ]

    for (const expected of cases) {
      const entry = presentLogEvent(expected.event, { controllers: HUMAN_VS_HUMAN })
      expect(entry).toEqual({
        actor: expected.actor,
        label: expected.label,
        text: expected.text,
        card: expected.card,
        glyph: expected.glyph,
        translated: true,
      })
      expect(Object.isFrozen(entry)).toBe(true)
      if (entry.card) {
        expect(Object.isFrozen(entry.card)).toBe(true)
      }
    }
  })

  it('redacts hidden AI and remote draws from text, metadata, and tile art', () => {
    for (const [controllers, actor] of [
      [HUMAN_VS_AI, 1],
      [['human', 'remote'], 1],
      [['remote', 'human'], 0],
    ] as const) {
      const event: LogEvent = { kind: 'draw', actor, cardName: 'Mountain' }
      const viewer = { controllers }
      const entry = presentLogEvent(event, viewer)

      expect(entry).toEqual({
        actor,
        label: 'draws a card',
        text: `P${actor + 1} draws a card`,
        card: null,
        glyph: '+',
        translated: true,
      })
      expect(formatLogEventTile(event, viewer).cardName).toBeNull()
      expect(formatLogEventText(event, viewer)).toBe(`P${actor + 1} draws a card`)
      expect(isLandTileEvent(event, viewer)).toBe(false)
      expect(JSON.stringify(entry)).not.toMatch(/Mountain|Rooftop Gargoyle/)
    }

    const visibleEvent: LogEvent = { kind: 'draw', actor: 0, cardName: 'Forest' }
    const visibleViewer = { controllers: HUMAN_VS_AI }
    expect(formatLogEventTile(visibleEvent, visibleViewer)).toEqual({
      actor: 0,
      label: 'draws Gravebloom Dryad',
      cardName: 'Forest',
      glyph: '+',
    })
    expect(formatLogEventText(visibleEvent, visibleViewer)).toBe('P1 draws Gravebloom Dryad')
    expect(isLandTileEvent(visibleEvent, visibleViewer)).toBe(true)
  })

  it('uses the generic Intercept cost for legacy counter events', () => {
    expect(presentLogEvent({
      kind: 'counter_resolved',
      actor: 1,
      cardName: 'Mountain',
    }, { controllers: HUMAN_VS_HUMAN }).text).toBe(
      'P2 intercepts Rooftop Gargoyle by discarding Signal Siren and another card',
    )
  })

  it('conservatively translates known legacy templates', () => {
    const viewer = { controllers: HUMAN_VS_AI }
    const cases = [
      ['Game started.', 'Game started'],
      ['Player 1 starts and skips first draw step.', 'P1 starts (skips first draw)'],
      ['Turn 12: Player 1 main phase.', 'P1 · Turn 12 • Action phase'],
      ['Player 1 draws Forest.', 'P1 draws Gravebloom Dryad'],
      ['Player 1 plays Forest.', 'P1 summons Gravebloom Dryad'],
      ['Forest returns Swamp from graveyard to hand.', 'Gravebloom Dryad reclaims Memory Vampire from the discard pile'],
      ['Swamp makes Player 2 discard Plains.', 'Memory Vampire drains a memory; P2 discards Echo Doppelgänger'],
      ["Mountain destroys Player 2's Island.", "Rooftop Gargoyle banishes P2's Signal Siren to its owner's discard pile"],
      ['Plains reuses Mountain.', 'Echo Doppelgänger mimics Rooftop Gargoyle — Banish'],
      ['Player 2 may counter Mountain with Island.', "P2 may intercept P1's summon of Rooftop Gargoyle"],
      ['Player 2 counters Mountain.', 'P2 intercepts Rooftop Gargoyle by discarding Signal Siren and another card'],
      ['Player 2 loses by drawing from empty deck.', 'P2 loses (empty deck)'],
      ['Player 1 wins.', 'P1 wins the game'],
      ['Game ends in a draw.', 'Game ends in a draw'],
    ]

    for (const [line, text] of cases) {
      const entry = presentLegacyLogLine(line, viewer)
      expect(entry.text).toBe(text)
      expect(entry.translated).toBe(true)
    }

    const hiddenDraw = presentLegacyLogLine('Player 2 draws Mountain.', viewer)
    expect(hiddenDraw.text).toBe('P2 draws a card')
    expect(hiddenDraw.card).toBeNull()
    expect(JSON.stringify(hiddenDraw)).not.toMatch(/Mountain|Rooftop Gargoyle/)
  })

  it.each(BASIC_LANDS)('keeps structured and legacy source copy in catalog parity for %s', (key) => {
    const viewer = { controllers: HUMAN_VS_HUMAN }
    const target = cardCatalogEntry(key)
    const reuse = `${displayCardName('Plains')} mimics ${target.displayName} — ${target.primaryAbility.name}`
    expect(presentLogEvent({
      kind: 'ability_plains_reuse', actor: 0, reusedName: key,
    }, viewer).text).toBe(`P1's ${reuse}`)
    expect(presentLegacyLogLine(`Plains reuses ${key}.`, viewer).text).toBe(reuse)
    expect(presentLegacyLogLine(`Forest returns ${key} from graveyard to hand.`, viewer).text)
      .toBe(`${displayCardName('Forest')} reclaims ${target.displayName} from the discard pile`)
    expect(presentLegacyLogLine(`Swamp makes Player 2 discard ${key}.`, viewer).text)
      .toBe(`${displayCardName('Swamp')} drains a memory; P2 discards ${target.displayName}`)
    expect(presentLegacyLogLine(`Mountain destroys Player 2's ${key}.`, viewer).text)
      .toBe(`${displayCardName('Mountain')} banishes P2's ${target.displayName} to its owner's discard pile`)
    expect(presentLogEvent({
      kind: 'counter_resolved', actor: 0, cardName: key, discardCardName: key,
    }, viewer).text).toBe(
      `P1 intercepts ${target.displayName} by discarding ${displayCardName('Island')} and ${target.displayName}`,
    )
    expect(presentLegacyLogLine(`Player 1 counters ${key}.`, viewer).text)
      .toBe(`P1 intercepts ${target.displayName} by discarding ${displayCardName('Island')} and another card`)
  })

  it('does not expand legacy parsing to display names or near-matching templates', () => {
    const viewer = { controllers: HUMAN_VS_AI }
    for (const line of [
      `Player 2 draws ${displayCardName('Mountain')}.`,
      `${displayCardName('Forest')} returns Island from graveyard to hand.`,
      `Plains reuses ${displayCardName('Forest')}.`,
      'Player 2 draws Mountain',
      'Player 2 draws Mountain. Extra text.',
      ' Player 2 draws Mountain.',
      'Player 3 draws Mountain.',
    ]) {
      expect(presentLegacyLogLine(line, viewer)).toMatchObject({
        label: line,
        text: line,
        card: null,
        translated: false,
      })
    }
  })

  it('preserves unknown legacy text and safely handles unknown events', () => {
    const viewer = { controllers: HUMAN_VS_AI }
    const unknownLine = 'Player 2 custom log: Mountain destroys everything.'
    expect(presentLegacyLogLine(unknownLine, viewer)).toEqual({
      actor: null,
      label: unknownLine,
      text: unknownLine,
      card: null,
      glyph: '?',
      translated: false,
    })

    const unknownEvent = { kind: 'future_event' } as unknown as LogEvent
    expect(presentLogEvent(unknownEvent, viewer)).toEqual({
      actor: null,
      label: 'Unknown event',
      text: 'Unknown event',
      card: null,
      glyph: '?',
      translated: false,
    })
    expect(MAX_RENDERED_LOG_TILES).toBe(200)
  })
})
