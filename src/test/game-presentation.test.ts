import { describe, expect, it } from 'vitest'
import {
  labelGameAction,
  labelGameActions,
  presentLegacyLogLine,
  presentLogEvent,
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
      { id: 'play-mountain', name: 'Mountain', type: 'land' },
      { id: 'play-plains', name: 'Plains', type: 'land' },
      { id: 'counter-island', name: 'Island', type: 'land' },
      { id: 'counter-extra', name: 'Mountain', type: 'land' },
    ]
    state.players[0].graveyard = [{ id: 'grave-swamp', name: 'Swamp', type: 'land' }]
    state.players[1].hand = [{ id: 'enemy-plains', name: 'Plains', type: 'land' }]
    state.players[0].battlefield = [{
      instanceId: 'friendly-island',
      card: { id: 'friendly-island-card', name: 'Island', type: 'land' },
    }]
    state.players[1].battlefield = [{
      instanceId: 'enemy-island',
      card: { id: 'enemy-island-card', name: 'Island', type: 'land' },
    }]
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
    }, HUMAN_VS_AI)).toBe(
      'Summon Gravebloom Dryad (Reclaim Memory Vampire from your discard pile)',
    )
    expect(labelGameAction(state, {
      type: 'play_land',
      actor: 0,
      cardId: 'play-mountain',
      effectTargetId: 'enemy-island',
    }, HUMAN_VS_AI)).toBe(
      "Summon Rooftop Gargoyle (Banish Signal Siren to its owner's discard pile)",
    )
    expect(labelGameAction(state, {
      type: 'play_land',
      actor: 0,
      cardId: 'play-plains',
      effectTargetId: 'friendly-island',
    }, HUMAN_VS_AI)).toBe(
      'Summon Echo Doppelgänger (Mimic Signal Siren — Listen In)',
    )
    expect(labelGameAction(state, {
      type: 'resolve_plains_reuse',
      actor: 0,
      effectTargetId: 'grave-swamp',
    }, HUMAN_VS_AI)).toBe(
      'Mimic Gravebloom Dryad — Reclaim (Reclaim Memory Vampire from your discard pile)',
    )
    expect(labelGameAction(state, {
      type: 'resolve_swamp_discard',
      actor: 0,
      effectTargetId: 'enemy-plains',
    }, HUMAN_VS_AI, true)).toBe(
      'Drain Memory — choose Echo Doppelgänger for your opponent to discard',
    )
    expect(labelGameAction(state, {
      type: 'counter_land',
      actor: 0,
      discardCardId: 'counter-extra',
    }, HUMAN_VS_AI)).toBe(
      'Intercept with Signal Siren (discard Signal Siren + Rooftop Gargoyle)',
    )
    expect(labelGameAction(state, { type: 'end_turn', actor: 0 }, HUMAN_VS_AI)).toBe('End Turn')
    expect(labelGameAction(state, { type: 'pass_response', actor: 0 }, HUMAN_VS_AI)).toBe('Let It Through')

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
      'Summon Gravebloom Dryad [1/2]',
      'Summon Gravebloom Dryad [2/2]',
      'End Turn',
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
    expect(Object.isFrozen(players[1].handCards[0])).toBe(true)
    expect(players[1].handCards[0]).toEqual({
      id: 'enemy-a',
      name: HIDDEN_HAND_CARD_NAME,
      displayName: 'Hidden card',
    })
    expect(revealedEnemyHandForSwamp(state, 0, HUMAN_VS_AI)).toBeNull()

    state.phase = 'swamp_target'
    state.pendingSwampDiscard = { actor: 0 }
    const revealed = revealedEnemyHandForSwamp(state, 0, HUMAN_VS_AI)
    expect(revealed?.map((card) => ({
      name: card.name,
      serializedKey: card.serializedKey,
      displayName: card.displayName,
    }))).toEqual([
      {
        name: 'Mountain',
        serializedKey: 'Mountain',
        displayName: 'Rooftop Gargoyle',
      },
      {
        name: 'Forest',
        serializedKey: 'Forest',
        displayName: 'Gravebloom Dryad',
      },
    ])

    state.pendingSwampDiscard = { actor: 1 }
    expect(revealedEnemyHandForSwamp(state, 0, HUMAN_VS_AI)).toBeNull()
  })

  it('redacts the remote hand for both P2P seats', () => {
    for (const [controllers, remotePlayer] of [
      [['human', 'remote'], 1],
      [['remote', 'human'], 0],
    ] as const) {
      const state = createInitialGame(4)
      state.players[remotePlayer].hand = [
        { id: 'remote-secret', name: 'Mountain', type: 'land' },
      ]

      const players = projectPlayersForPresentation(state, controllers)
      expect(players[remotePlayer].handCards).toEqual([{
        id: 'remote-secret',
        name: HIDDEN_HAND_CARD_NAME,
        displayName: 'Hidden card',
      }])
      expect(JSON.stringify(players[remotePlayer].handCards)).not.toContain('Mountain')
      expect(JSON.stringify(players[remotePlayer].handCards)).not.toContain('Rooftop Gargoyle')

      const humanPlayer = 1 - remotePlayer
      expect(revealedEnemyHandForSwamp(state, humanPlayer, controllers)).toBeNull()
      state.phase = 'swamp_target'
      state.pendingSwampDiscard = { actor: humanPlayer }
      expect(revealedEnemyHandForSwamp(state, humanPlayer, controllers)?.[0]).toMatchObject({
        id: 'remote-secret',
        serializedKey: 'Mountain',
        displayName: 'Rooftop Gargoyle',
      })
      expect(projectPlayersForPresentation(state, controllers)[remotePlayer].handCards[0]?.name)
        .toBe(HIDDEN_HAND_CARD_NAME)
    }
  })

  it('projects structured events through catalog copy without revealing hidden draws', () => {
    const viewer = { controllers: HUMAN_VS_AI }
    const visibleDraw = presentLogEvent(
      { kind: 'draw', actor: 0, cardName: 'Forest' },
      viewer,
    )
    expect(visibleDraw).toEqual({
      actor: 0,
      label: 'draws Gravebloom Dryad',
      text: 'P1 draws Gravebloom Dryad',
      card: { serializedKey: 'Forest', displayName: 'Gravebloom Dryad' },
      translated: true,
    })
    expect(Object.isFrozen(visibleDraw)).toBe(true)
    expect(Object.isFrozen(visibleDraw.card)).toBe(true)

    const hiddenDraw = presentLogEvent(
      { kind: 'draw', actor: 1, cardName: 'Mountain' },
      viewer,
    )
    expect(hiddenDraw).toEqual({
      actor: 1,
      label: 'draws a card',
      text: 'P2 draws a card',
      card: null,
      translated: true,
    })
    expect(JSON.stringify(hiddenDraw)).not.toContain('Mountain')
    expect(JSON.stringify(hiddenDraw)).not.toContain('Rooftop Gargoyle')

    for (const [controllers, actor] of [
      [['human', 'remote'], 1],
      [['remote', 'human'], 0],
    ] as const) {
      const remoteDraw = presentLogEvent(
        { kind: 'draw', actor, cardName: 'Mountain' },
        { controllers },
      )
      expect(remoteDraw).toEqual({
        actor,
        label: 'draws a card',
        text: `P${actor + 1} draws a card`,
        card: null,
        translated: true,
      })
      expect(JSON.stringify(remoteDraw)).not.toContain('Mountain')
      expect(JSON.stringify(remoteDraw)).not.toContain('Rooftop Gargoyle')
    }

    expect(presentLogEvent({
      kind: 'play_land',
      actor: 0,
      cardName: 'Island',
    }, viewer).text).toBe('P1 summons Signal Siren')
    expect(presentLogEvent({
      kind: 'ability_forest_return',
      actor: 0,
      cardName: 'Island',
    }, viewer).text).toBe('P1 reclaims Signal Siren from their discard pile')
    expect(presentLogEvent({
      kind: 'ability_swamp_discard',
      actor: 0,
      target: 1,
      cardName: 'Swamp',
    }, viewer).text).toBe('P1 drains a memory; P2 discards Memory Vampire')
    expect(presentLogEvent({
      kind: 'ability_mountain_destroy',
      actor: 0,
      target: 1,
      cardName: 'Island',
    }, viewer).text).toBe(
      "P1 banishes P2's Signal Siren to its owner's discard pile",
    )
    expect(presentLogEvent({
      kind: 'ability_plains_reuse',
      actor: 0,
      reusedName: 'Mountain',
    }, viewer).text).toBe(
      "P1's Echo Doppelgänger mimics Rooftop Gargoyle — Banish",
    )
    expect(presentLogEvent({
      kind: 'counter_offered',
      responder: 1,
      cardName: 'Island',
    }, viewer).text).toBe(
      "P2 may intercept P1's summon of Signal Siren",
    )
    expect(presentLogEvent({
      kind: 'counter_resolved',
      actor: 1,
      cardName: 'Island',
      discardCardName: 'Swamp',
    }, viewer).text).toBe(
      'P2 intercepts Signal Siren by discarding Signal Siren and Memory Vampire',
    )
  })

  it('conservatively translates known legacy templates and preserves unknown lines', () => {
    const viewer = { controllers: HUMAN_VS_AI }
    expect(presentLegacyLogLine('Player 2 draws Mountain.', viewer)).toEqual({
      actor: 1,
      label: 'draws a card',
      text: 'P2 draws a card',
      card: null,
      translated: true,
    })
    expect(presentLegacyLogLine(
      "Mountain destroys Player 2's Island.",
      viewer,
    ).text).toBe(
      "Rooftop Gargoyle banishes P2's Signal Siren to its owner's discard pile",
    )
    expect(presentLegacyLogLine(
      'Forest returns Swamp from graveyard to hand.',
      viewer,
    ).text).toBe(
      'Gravebloom Dryad reclaims Memory Vampire from the discard pile',
    )
    expect(presentLegacyLogLine(
      'Plains reuses Mountain.',
      viewer,
    ).text).toBe(
      'Echo Doppelgänger mimics Rooftop Gargoyle — Banish',
    )
    expect(presentLegacyLogLine(
      'Player 1 plays Forest.',
      viewer,
    ).text).toBe('P1 summons Gravebloom Dryad')
    expect(presentLegacyLogLine(
      'Swamp makes Player 2 discard Plains.',
      viewer,
    ).text).toBe(
      'Memory Vampire drains a memory; P2 discards Echo Doppelgänger',
    )
    expect(presentLegacyLogLine(
      'Player 2 may counter Mountain with Island.',
      viewer,
    ).text).toBe(
      "P2 may intercept P1's summon of Rooftop Gargoyle",
    )
    expect(presentLegacyLogLine(
      'Player 2 counters Mountain.',
      viewer,
    ).text).toBe(
      'P2 intercepts Rooftop Gargoyle by discarding Signal Siren and another card',
    )
    expect(presentLegacyLogLine(
      'Turn 12: Player 1 main phase.',
      viewer,
    ).text).toBe('P1 · Turn 12 • Action phase')
    expect(presentLegacyLogLine(
      'Player 2 loses by drawing from empty deck.',
      viewer,
    ).text).toBe('P2 loses (empty deck)')
    expect(presentLegacyLogLine(
      'Player 1 wins.',
      viewer,
    ).text).toBe('P1 wins the game')
    const unknown = 'Player 2 custom log: Mountain destroys everything.'
    expect(presentLegacyLogLine(unknown, viewer)).toEqual({
      actor: null,
      label: unknown,
      text: unknown,
      card: null,
      translated: false,
    })
  })
})
