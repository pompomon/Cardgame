import { describe, expect, it } from 'vitest'
import { cardCatalogEntry, displayCardName } from '../app/card-catalog'
import {
  displayAdventureOpponentLabel,
  labelGameAction,
  labelGameActions,
  projectPlayersForPresentation,
  revealedEnemyHandForSwamp,
  targetPromptForCard,
} from '../app/game-presentation'
import { HIDDEN_HAND_CARD_NAME, type ControllerKind } from '../app/types'
import { createInitialGame, getLegalActions } from '../game/engine'
import type { GameAction } from '../game/types'

const HUMAN_VS_AI: [ControllerKind, ControllerKind] = ['human', 'ai']

describe('shared game presentation', () => {
  it('derives Adventure opponent labels from stable card identities', () => {
    expect(displayAdventureOpponentLabel('standard', [
      'Forest',
      'Island',
      'Mountain',
      'Plains',
      'Swamp',
    ])).toBe('Balanced roster (10 of each creature)')
    expect(displayAdventureOpponentLabel('dual', ['Forest', 'Island']))
      .toBe('Duo: Gravebloom Dryad + Signal Siren')
    expect(displayAdventureOpponentLabel('random', [
      'Forest',
      'Island',
      'Mountain',
      'Plains',
      'Swamp',
    ])).toBe('Mystery roster')
    expect(displayAdventureOpponentLabel('mono', ['Forest']))
      .toBe('Boss: Gravebloom Dryad specialist')
  })

  it('uses safe Adventure labels for irregular or unknown lineup data', () => {
    expect(displayAdventureOpponentLabel('dual', [])).toBe('Duo roster')
    expect(displayAdventureOpponentLabel('dual', ['Forest'])).toBe('Duo roster')
    expect(displayAdventureOpponentLabel('dual', ['Forest', 'Island', 'Swamp']))
      .toBe('Duo: Gravebloom Dryad + Signal Siren')
    expect(displayAdventureOpponentLabel('mono', [])).toBe('Boss specialist')
    expect(displayAdventureOpponentLabel('mono', ['Forest', 'Island']))
      .toBe('Boss: Gravebloom Dryad specialist')
    expect(displayAdventureOpponentLabel('future' as never, ['Forest']))
      .toBe('Mystery roster')
  })

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

  it.each(['Forest', 'Island', 'Mountain', 'Swamp'] as const)(
    'uses catalog copy for Mimic of %s and never offers another Echo Doppelgänger',
    (reusedName) => {
      const state = createInitialGame(5)
      state.players[0].hand = [{ id: 'echo', name: 'Plains', type: 'land' }]
      state.players[0].battlefield = [
        { instanceId: 'reused', card: { id: 'reused-card', name: reusedName, type: 'land' } },
        { instanceId: 'echo-a', card: { id: 'echo-card-a', name: 'Plains', type: 'land' } },
        { instanceId: 'echo-b', card: { id: 'echo-card-b', name: 'Plains', type: 'land' } },
      ]
      const actions = getLegalActions(state, 0).filter((action) => action.type === 'play_land')
      const echo = cardCatalogEntry('Plains')
      const reused = cardCatalogEntry(reusedName)
      expect(actions).toEqual([{
        type: 'play_land',
        actor: 0,
        cardId: 'echo',
        effectTargetId: 'reused',
      }])
      expect(labelGameAction(state, actions[0], HUMAN_VS_AI)).toBe(
        `Summon ${echo.displayName} (${echo.primaryAbility.name} ${reused.displayName} — ${reused.primaryAbility.name})`,
      )
      expect(targetPromptForCard('Plains')).toBe(
        `Choose one of your creatures other than ${echo.displayName} for ${echo.primaryAbility.name}.`,
      )
    },
  )

  it.each(['Forest', 'Mountain', 'Swamp'] as const)(
    'uses catalog ability and card names for nested %s choices without leaking hidden hands',
    (reusedName) => {
      const state = createInitialGame(6)
      state.phase = 'plains_target'
      state.pendingPlainsReuse = {
        actor: 0,
        reusedInstanceId: 'reused',
        reusedCardName: reusedName,
      }
      state.players[0].graveyard = [{ id: 'grave', name: 'Island', type: 'land' }]
      state.players[1].battlefield = [{
        instanceId: 'enemy-board',
        card: { id: 'enemy-card', name: 'Island', type: 'land' },
      }]
      state.players[1].hand = [{ id: 'enemy-hand', name: 'Island', type: 'land' }]
      const reused = cardCatalogEntry(reusedName)
      const ability = reused.primaryAbility.name
      const prefix = `${cardCatalogEntry('Plains').primaryAbility.name} ${reused.displayName} — ${ability}`
      const suffix = {
        Forest: `${ability} ${displayCardName('Island')} from your discard pile`,
        Mountain: `${ability} ${displayCardName('Island')} to its owner's discard pile`,
        Swamp: `${ability} — choose ${displayCardName('Island')} for your opponent to discard`,
      }[reusedName]
      const [action] = getLegalActions(state, 0)
      expect(action.type).toBe('resolve_plains_reuse')
      expect(labelGameAction(state, action, HUMAN_VS_AI, true)).toBe(`${prefix} (${suffix})`)
      expect(labelGameAction(state, action, HUMAN_VS_AI)).toBe(
        reusedName === 'Swamp'
          ? `${prefix} (${ability} — choose a hidden card for your opponent to discard)`
          : `${prefix} (${suffix})`,
      )
    },
  )

  it('derives Intercept costs and fallback ability labels from the catalog', () => {
    const state = createInitialGame(7)
    state.players[0].hand = [
      { id: 'siren', name: 'Island', type: 'land' },
      { id: 'extra', name: 'Plains', type: 'land' },
    ]
    const siren = cardCatalogEntry('Island')
    const prefix = `${siren.responseAbility!.name} with ${siren.displayName} (discard ${siren.displayName}`
    expect(labelGameAction(state, {
      type: 'counter_land', actor: 0, discardCardId: 'extra',
    }, HUMAN_VS_AI)).toBe(`${prefix} + ${displayCardName('Plains')})`)
    expect(labelGameAction(state, {
      type: 'counter_land', actor: 0,
    }, HUMAN_VS_AI)).toBe(`${prefix} + one other card)`)
    expect(labelGameAction(state, {
      type: 'resolve_plains_reuse', actor: 0,
    }, HUMAN_VS_AI)).toBe(`Resolve ${cardCatalogEntry('Plains').primaryAbility.name} ability`)
    expect(labelGameAction(state, {
      type: 'resolve_swamp_discard', actor: 0,
    }, HUMAN_VS_AI)).toBe(
      `${cardCatalogEntry('Swamp').primaryAbility.name} — choose a card for your opponent to discard`,
    )
    expect(targetPromptForCard(null)).toBe("Choose a target for this creature's ability.")
    expect(targetPromptForCard('future' as never)).toBe("Choose a target for this creature's ability.")
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

})
