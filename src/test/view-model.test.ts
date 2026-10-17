import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createAdventureRun,
  createInactiveAdventureState,
  migrateLegacyAdventureRun,
  type AdventureOpponentDeck,
  type AdventureRunState,
  type AdventureRunStateV1,
} from '../app/adventure'
import { displayAdventureOpponentLabel } from '../app/game-presentation'
import { buildViewModel } from '../app/view-model'
import { applyAction, createInitialGame, getLegalActions } from '../game/engine'
import { HIDDEN_HAND_CARD_NAME, type AppState } from '../app/types'

const TEST_RUN_ID = '0123456789abcdef0123456789abcdef'

function v1FixtureRun(): AdventureRunStateV1 {
  const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures', 'adventure-v1-saves.json'), 'utf8')) as {
    closedMidRound: Record<string, string>
  }
  return JSON.parse(fixture.closedMidRound['cardgame.adventure-run']) as AdventureRunStateV1
}

function runWithOpponents(opponents: Record<number, Omit<AdventureOpponentDeck, 'deck'>>): AdventureRunState {
  const run = createAdventureRun(57, TEST_RUN_ID)
  for (const [tierIndex, opponent] of Object.entries(opponents)) {
    const node = run.map.tiers[Number(tierIndex)].nodes[0]
    node.opponent = { ...opponent, deck: node.opponent.deck }
  }
  return run
}

function createState(seed: number): AppState {
  return {
    mode: 'local-hvh',
    game: createInitialGame(seed),
    controllers: ['human', 'human'],
    seed,
    offer: '',
    answer: '',
    status: '',
    recording: null,
    replay: null,
    hasSavedRecording: false,
    aiLevel: 'basic',
    cardVisualStyle: 'classic',
    animationSpeed: 'normal',
    boardTheme: 'classic',
    renderQualityPreference: 'auto',
    p2pStarted: false,
    pendingP2PStartSeed: null,
    pendingRematchSeed: null,
    adventure: createInactiveAdventureState(),
  }
}

function expectAllCardsHidden(cards: ReadonlyArray<{ name: string }>): void {
  expect(cards.every((card) => card.name === HIDDEN_HAND_CARD_NAME)).toBe(true)
}

describe('buildViewModel', () => {
  it('exposes the full game log to renderers without truncation', () => {
    const state = createState(53)
    const entries = Array.from({ length: 50 }, (_, index) => `entry-${index}`)
    state.game!.log = entries

    const vm = buildViewModel(state, false)

    expect(vm.game?.log).toEqual(entries)
    expect(vm.game?.log.length).toBe(entries.length)
    expect(vm.aiLevel).toBe('basic')
    expect(vm.cardVisualStyle).toBe('classic')
    expect(vm.boardTheme).toBe('classic')
    expect(vm.renderQualityPreference).toBe('auto')
    expect(vm.adventure.status).toBe('inactive')
    // The structured event stream is exposed alongside the log strings so
    // presentation code (visual log, ability animations) can consume it.
    expect(Array.isArray(vm.game?.events)).toBe(true)
    expect(vm.game?.events[0]).toEqual({ kind: 'game_started' })
    expect(vm.tutorial).toEqual({ active: false, stepId: null, hint: null })
  })

  it('projects tutorial hint state when in tutorial mode', () => {
    const state = createState(56)
    state.mode = 'tutorial'
    state.controllers = ['human', 'ai']
    state.game!.players[0].hand = [{ id: 'tutorial-island', name: 'Island', type: 'land' }]
    state.game!.players[0].battlefield = []

    const vm = buildViewModel(state, false)

    expect(vm.tutorial.active).toBe(true)
    expect(vm.tutorial.stepId).toBe('play-island-first')
    expect(vm.tutorial.hint).toBeTruthy()
  })

  it('exposes plains reuse options and pending reused card name', () => {
    const state = createState(54)
    state.game!.phase = 'plains_target'
    state.game!.pendingPlainsReuse = {
      actor: 0,
      reusedInstanceId: 'self-forest',
      reusedCardName: 'Forest',
    }
    state.game!.players[0].graveyard = [
      { id: 'g-1', name: 'Swamp', type: 'land' },
      { id: 'g-2', name: 'Mountain', type: 'land' },
    ]

    const vm = buildViewModel(state, false)
    expect(vm.game?.pendingPlainsReuseName).toBe('Forest')
    expect(vm.game?.pendingPlainsReuseDisplayName).toBe('Gravebloom Dryad')
    expect(vm.game?.legal.plainsReuseOptions.map((entry) => entry.action.effectTargetId)).toEqual(['g-1', 'g-2'])
  })

  it('keeps detailed counter labels distinct by additional discarded card', () => {
    const state = createState(57)
    state.game!.phase = 'respond'
    state.game!.pendingLandPlay = {
      actor: 1,
      card: { id: 'target-swamp', name: 'Swamp', type: 'land' },
    }
    state.game!.players[0].hand = [
      { id: 'counter-island', name: 'Island', type: 'land' },
      { id: 'discard-forest', name: 'Forest', type: 'land' },
      { id: 'discard-mountain', name: 'Mountain', type: 'land' },
    ]

    const vm = buildViewModel(state, false)

    expect(vm.game?.pendingLandName).toBe('Swamp')
    expect(vm.game?.pendingLandDisplayName).toBe('Memory Vampire')
    expect(vm.game?.legal.counterOptions.map((option) => option.label)).toEqual([
      'Intercept with Signal Siren (discard Signal Siren + Gravebloom Dryad)',
      'Intercept with Signal Siren (discard Signal Siren + Rooftop Gargoyle)',
    ])
  })

  it.each([0, 1])('projects only the public pending card, detached from player %s state', (actor) => {
    const state = createState(57)
    state.controllers = ['human', 'ai']
    state.mode = 'local-hvai'
    state.game!.currentPlayer = actor
    state.game!.players[actor].hand = [
      { id: 'pending', name: 'Swamp', type: 'land' },
      { id: 'secret', name: 'Forest', type: 'land' },
    ]
    state.game!.players[1 - actor].hand = [
      { id: 'island', name: 'Island', type: 'land' },
      { id: 'discard', name: 'Mountain', type: 'land' },
    ]
    expect(buildViewModel(state, false).game!.pendingLandPlay).toBeNull()
    const play = getLegalActions(state.game!, actor).find((action) => action.type === 'play_land' && action.cardId === 'pending')!
    state.game = applyAction(state.game!, play)
    const snapshot = buildViewModel(state, false)
    expect(snapshot.game!.pendingLandPlay).toEqual({
      cardId: 'pending',
      name: 'Swamp',
      serializedKey: 'Swamp',
      displayName: 'Memory Vampire',
      actor,
    })
    expect(snapshot.game!.pendingLandPlay).not.toBe(state.game.pendingLandPlay)
    expect(Object.isFrozen(snapshot.game!.pendingLandPlay)).toBe(true)
    expectAllCardsHidden(snapshot.game!.players[1].handCards)
    state.game.pendingLandPlay!.card.name = 'Forest'
    expect(snapshot.game!.pendingLandPlay!.name).toBe('Swamp')
    expect(snapshot.game!.pendingLandPlay!.serializedKey).toBe('Swamp')
    expect(snapshot.game!.pendingLandPlay!.displayName).toBe('Memory Vampire')
  })

  it.each(['counter_land', 'pass_response'] as const)('clears the pending snapshot after %s', (type) => {
    const state = createState(57)
    state.game!.players[0].hand = [{ id: 'play', name: 'Island', type: 'land' }]
    state.game!.players[1].hand = [
      { id: 'island', name: 'Island', type: 'land' },
      { id: 'discard', name: 'Forest', type: 'land' },
    ]
    state.game = applyAction(state.game!, getLegalActions(state.game!, 0).find((action) => action.type === 'play_land')!)
    const pending = buildViewModel(state, false).game!.pendingLandPlay
    expect(pending).not.toBeNull()
    state.game = applyAction(state.game!, getLegalActions(state.game!, 1).find((action) => action.type === type)!)
    const next = buildViewModel(state, false).game!
    expect(next.pendingLandPlay).toBeNull()
    expect(next.pendingLandName).toBeNull()
    expect(next.pendingLandDisplayName).toBeNull()
    expect(pending!.cardId).toBe('play')
  })

  it('projects game and adventure snapshots without sharing controller-owned references', () => {
    const state = createState(55)
    state.game!.log = ['entry-0', 'entry-1']
    state.game!.events = [
      { kind: 'game_started' },
      { kind: 'turn_start', turn: 1, actor: 0 },
    ]
    state.game!.players[0].hand = [{ id: 'h-1', name: 'Forest', type: 'land' }]
    state.game!.players[0].graveyard = [{ id: 'g-1', name: 'Swamp', type: 'land' }]
    state.game!.players[0].battlefield = [
      { instanceId: 'bf-1', card: { id: 'bf-card-1', name: 'Mountain', type: 'land' } },
    ]
    const run = runWithOpponents({
      0: { id: 'opponent-1', label: 'Opponent 1', kind: 'dual', lands: ['Forest', 'Swamp'] },
    })
    state.adventure = { run, highScore: 0, hasSavedRun: true }
    const source = run.map.tiers[0].nodes[0].opponent

    const vm = buildViewModel(state, false)

    expect(vm.game).not.toBe(state.game)
    expect(vm.game?.players).not.toBe(state.game!.players)
    expect(vm.game?.players[0]).not.toBe(state.game!.players[0])
    expect(vm.game?.players[1]).not.toBe(state.game!.players[1])
    expect(vm.game?.players[0].handCards).not.toBe(state.game!.players[0].hand)
    expect(vm.game?.players[0].graveyardCards).not.toBe(state.game!.players[0].graveyard)
    expect(vm.game?.players[0].battlefield).not.toBe(state.game!.players[0].battlefield)
    expect(vm.game?.players[0].battlefield[0]).toEqual({
      instanceId: 'bf-1',
      cardId: 'bf-card-1',
      name: 'Mountain',
      serializedKey: 'Mountain',
      displayName: 'Rooftop Gargoyle',
    })
    expect(vm.game?.players[0].handCards[0]).toEqual({
      id: 'h-1',
      name: 'Forest',
      serializedKey: 'Forest',
      displayName: 'Gravebloom Dryad',
    })
    expect(vm.game?.players[0].graveyardCards[0]).toEqual({
      id: 'g-1',
      name: 'Swamp',
      serializedKey: 'Swamp',
      displayName: 'Memory Vampire',
    })
    expect(Object.isFrozen(vm.game?.players)).toBe(true)
    expect(Object.isFrozen(vm.game?.players[0])).toBe(true)
    expect(Object.isFrozen(vm.game?.players[0].handCards)).toBe(true)
    expect(Object.isFrozen(vm.game?.players[0].handCards[0])).toBe(true)
    expect(vm.game?.log).toEqual(state.game!.log)
    expect(vm.game?.log).not.toBe(state.game!.log)
    expect(vm.game?.events).toEqual(state.game!.events)
    expect(vm.game?.events).not.toBe(state.game!.events)
    expect(vm.game?.events[0]).not.toBe(state.game!.events[0])

    expect(vm.adventure).not.toBe(state.adventure)
    expect(vm.adventure.opponentLineup).not.toBe(run.map.tiers)
    expect(vm.adventure.opponentLineup[0]).not.toBe(source)
    expect(vm.adventure.opponentLineup[0].label).toBe(
      'Duo: Gravebloom Dryad + Memory Vampire',
    )
    expect(vm.adventure.opponentLineup[0].label).not.toBe(source.label)
    expect(vm.adventure.opponentLineup[0].lands).toEqual(['Forest', 'Swamp'])
    expect(vm.adventure.opponentLineup[0].lands).not.toBe(source.lands)
  })

  it('never exposes pre-migration Adventure opponent labels', () => {
    const state = createState(58)
    state.adventure = {
      run: runWithOpponents({
        0: {
          id: 'legacy-standard',
          label: 'Standard Deck (10 of each land)',
          kind: 'standard',
          lands: ['Forest', 'Island', 'Mountain', 'Plains', 'Swamp'],
        },
        6: {
          id: 'legacy-boss',
          label: 'Boss: Mono Forest Deck',
          kind: 'mono',
          lands: ['Forest'],
        },
      }),
      highScore: 0,
      hasSavedRun: true,
    }

    const lineup = buildViewModel(state, false).adventure.opponentLineup

    expect([lineup[0].label, lineup[6].label]).toEqual([
      'Balanced roster (10 of each creature)',
      'Boss: Gravebloom Dryad specialist',
    ])
    expect(JSON.stringify(lineup)).not.toMatch(/Standard Deck|Mono Forest|each land|Deck/)
  })

  it('projects a migrated version 1 run exactly like the version 1 Adventure view', () => {
    const legacy = v1FixtureRun()
    const run = migrateLegacyAdventureRun(legacy, TEST_RUN_ID)
    expect(run).not.toBeNull()
    const state = createState(59)
    state.adventure = { run: run!, highScore: 321, hasSavedRun: true }

    expect(buildViewModel(state, false).adventure).toEqual({
      baseSeed: legacy.baseSeed,
      currentRound: legacy.currentRound,
      remainingChances: legacy.remainingChances,
      winStreak: legacy.winStreak,
      totalRoundsPlayed: legacy.totalRoundsPlayed,
      totalCardsPlayed: legacy.totalCardsPlayed,
      opponentLineup: legacy.opponentLineup.map((entry) => ({
        id: entry.id,
        label: displayAdventureOpponentLabel(entry.kind, entry.lands),
        kind: entry.kind,
        lands: entry.lands,
      })),
      currentOpponentIndex: legacy.currentOpponentIndex,
      activeGameSeed: legacy.activeGameSeed,
      status: legacy.status,
      highScore: 321,
      hasSavedRun: true,
    })
  })

  it('projects the inactive Adventure baseline when no run is loaded', () => {
    const state = createState(60)
    state.adventure = createInactiveAdventureState(77, false)

    const adventure = buildViewModel(state, false).adventure

    expect(adventure).toEqual({
      baseSeed: 0,
      currentRound: 0,
      remainingChances: 0,
      winStreak: 0,
      totalRoundsPlayed: 0,
      totalCardsPlayed: 0,
      opponentLineup: [],
      currentOpponentIndex: 0,
      activeGameSeed: null,
      status: 'inactive',
      highScore: 77,
      hasSavedRun: false,
    })
    expect(Object.isFrozen(adventure)).toBe(true)
    expect(Object.isFrozen(adventure.opponentLineup)).toBe(true)
  })

  it('returns frozen deck-free Adventure snapshots that ignore later run changes', () => {
    const state = createState(61)
    const run = createAdventureRun(61, TEST_RUN_ID)
    state.adventure = { run, highScore: 5, hasSavedRun: true }

    const adventure = buildViewModel(state, false).adventure
    const before = JSON.stringify(adventure)

    expect(Object.isFrozen(adventure)).toBe(true)
    expect(Object.isFrozen(adventure.opponentLineup)).toBe(true)
    expect(adventure.opponentLineup).toHaveLength(7)
    for (const entry of adventure.opponentLineup) {
      expect(Object.isFrozen(entry)).toBe(true)
      expect(Object.isFrozen(entry.lands)).toBe(true)
      expect(Object.keys(entry).sort()).toEqual(['id', 'kind', 'label', 'lands'])
    }
    expect(adventure.currentRound).toBe(1)
    expect(adventure.currentOpponentIndex).toBe(0)
    expect(adventure.activeGameSeed).toBe(run.attemptSeed)
    expect(adventure.status).toBe('active')

    run.totalCardsPlayed += 9
    run.currentTierIndex = 3
    run.map.tiers[0].nodes[0].opponent.lands.push('Island')
    run.map.tiers[0].nodes[0].opponent.id = 'changed'

    expect(JSON.stringify(adventure)).toBe(before)
  })
})

describe('buildViewModel hand-redaction', () => {
  it('redacts the AI hand from the human in local-hvai while keeping handCount and card ids', () => {
    const state = createState(101)
    state.mode = 'local-hvai'
    state.controllers = ['human', 'ai']
    state.game!.players[0].hand = [
      { id: 'h-1', name: 'Forest', type: 'land' },
      { id: 'h-2', name: 'Island', type: 'land' },
    ]
    state.game!.players[1].hand = [
      { id: 'a-1', name: 'Swamp', type: 'land' },
      { id: 'a-2', name: 'Mountain', type: 'land' },
      { id: 'a-3', name: 'Plains', type: 'land' },
    ]

    const vm = buildViewModel(state, false)

    // Human hand stays visible.
    expect(vm.game?.players[0].handCards.map((c) => c.name)).toEqual(['Forest', 'Island'])
    // AI hand is fully redacted but the count + ids remain.
    expect(vm.game?.players[1].handCount).toBe(3)
    expect(vm.game?.players[1].handCards.map((c) => c.id)).toEqual(['a-1', 'a-2', 'a-3'])
    expectAllCardsHidden(vm.game!.players[1].handCards)
    expect(vm.game?.players[1].handCards.every((card) =>
      card.serializedKey === undefined && card.displayName === 'Hidden card')).toBe(true)
  })

  it('redacts the AI hand in adventure-hvai too', () => {
    const state = createState(102)
    state.mode = 'adventure-hvai'
    state.controllers = ['human', 'ai']
    state.game!.players[1].hand = [{ id: 'a-1', name: 'Swamp', type: 'land' }]

    const vm = buildViewModel(state, false)
    expect(vm.game?.players[1].handCards[0].name).toBe(HIDDEN_HAND_CARD_NAME)
    expectAllCardsHidden(vm.game!.players[1].handCards)
  })

  it('keeps both hands visible for local-hvh', () => {
    const state = createState(103)
    state.mode = 'local-hvh'
    state.controllers = ['human', 'human']
    state.game!.players[0].hand = [{ id: 'a', name: 'Forest', type: 'land' }]
    state.game!.players[1].hand = [{ id: 'b', name: 'Swamp', type: 'land' }]

    const vm = buildViewModel(state, false)
    expect(vm.game?.players[0].handCards[0].name).toBe('Forest')
    expect(vm.game?.players[1].handCards[0].name).toBe('Swamp')
  })

  it('keeps both hands visible for local-aivai (no human viewer to protect)', () => {
    const state = createState(104)
    state.mode = 'local-aivai'
    state.controllers = ['ai', 'ai']
    state.game!.players[0].hand = [{ id: 'a', name: 'Forest', type: 'land' }]
    state.game!.players[1].hand = [{ id: 'b', name: 'Swamp', type: 'land' }]

    const vm = buildViewModel(state, false)
    expect(vm.game?.players[0].handCards[0].name).toBe('Forest')
    expect(vm.game?.players[1].handCards[0].name).toBe('Swamp')
  })

  it('reveals real AI hand names during direct Swamp discard targeting (hvai)', () => {
    // This test was deliberately reversed: previously the design hid the AI
    // hand here to mirror the AI's information set when *it* plays Swamp.
    // Players expect to see the discard candidates when *they* play Swamp,
    // so the view model now narrows the redaction: the enemy hand is
    // revealed only for the duration of this decision. The AI continues to
    // play Swamp without enemy-hand visibility (see `ai-visibility.ts`).
    const state = createState(105)
    state.mode = 'local-hvai'
    state.controllers = ['human', 'ai']
    state.game!.phase = 'swamp_target'
    state.game!.pendingSwampDiscard = { actor: 0 }
    state.game!.players[1].hand = [
      { id: 'ai-1', name: 'Mountain', type: 'land' },
      { id: 'ai-2', name: 'Forest', type: 'land' },
    ]

    const vm = buildViewModel(state, false)
    const labels = vm.game!.legal.swampDiscardOptions.map((o) => o.label).join('|')
    expect(labels).toMatch(/Rooftop Gargoyle/)
    expect(labels).toMatch(/Gravebloom Dryad/)
    expect(labels).not.toMatch(/hidden card/)
    // The reveal is exposed on the view model so renderers can show the
    // real card art in the target picker.
    expect(vm.game?.revealedEnemyHandForSwamp?.map((c) => c.name)).toEqual(['Mountain', 'Forest'])
    // The general hand projection is still redacted everywhere else.
    expectAllCardsHidden(vm.game!.players[1].handCards)
  })

  it('does not leak hidden AI hand names outside the scoped Swamp reveal', () => {
    const state = createState(106)
    state.mode = 'local-hvai'
    state.controllers = ['human', 'ai']
    // Human has no Swamp in hand, so no scoped reveal is active.
    state.game!.players[0].hand = [{ id: 'p0-island', name: 'Island', type: 'land' }]
    state.game!.players[1].hand = [
      { id: 'ai-1', name: 'Mountain', type: 'land' },
      { id: 'ai-2', name: 'Forest', type: 'land' },
    ]

    const vm = buildViewModel(state, false)
    const labels = Object.values(vm.game!.legal.playLandByCard).flat().map((option) => option.label).join('|')
    const serializedProtectedSurfaces = JSON.stringify({
      handCards: vm.game!.players[1].handCards,
      revealedEnemyHandForSwamp: vm.game!.revealedEnemyHandForSwamp,
      labels,
    })

    expect(vm.game?.revealedEnemyHandForSwamp).toBeNull()
    expectAllCardsHidden(vm.game!.players[1].handCards)
    expect(labels).not.toContain('Mountain')
    expect(labels).not.toContain('Forest')
    expect(serializedProtectedSurfaces).not.toContain('Mountain')
    expect(serializedProtectedSurfaces).not.toContain('Forest')
    expect(serializedProtectedSurfaces).not.toContain('Rooftop Gargoyle')
    expect(serializedProtectedSurfaces).not.toContain('Gravebloom Dryad')
  })

  it('reveals the AI hand for Swamp targeting in adventure-hvai too', () => {
    const state = createState(107)
    state.mode = 'adventure-hvai'
    state.controllers = ['human', 'ai']
    state.game!.phase = 'swamp_target'
    state.game!.pendingSwampDiscard = { actor: 0 }
    state.game!.players[1].hand = [{ id: 'ai-1', name: 'Mountain', type: 'land' }]

    const vm = buildViewModel(state, false)
    const labels = vm.game!.legal.swampDiscardOptions.map((o) => o.label).join('|')
    expect(labels).toMatch(/Rooftop Gargoyle/)
    expect(vm.game?.revealedEnemyHandForSwamp?.map((c) => c.name)).toEqual(['Mountain'])
  })

  it('reveals the enemy hand for a Plains→Swamp reuse decision', () => {
    const state = createState(108)
    state.mode = 'local-hvai'
    state.controllers = ['human', 'ai']
    state.game!.phase = 'plains_target'
    state.game!.pendingPlainsReuse = {
      actor: 0,
      reusedInstanceId: 'bf-swamp',
      reusedCardName: 'Swamp',
    }
    state.game!.players[1].hand = [
      { id: 'ai-1', name: 'Mountain', type: 'land' },
      { id: 'ai-2', name: 'Forest', type: 'land' },
    ]

    const vm = buildViewModel(state, false)
    const labels = vm.game!.legal.plainsReuseOptions.map((o) => o.label).join('|')
    expect(labels).toMatch(/Rooftop Gargoyle/)
    expect(labels).toMatch(/Gravebloom Dryad/)
    expect(labels).not.toMatch(/hidden card/)
    expect(vm.game?.revealedEnemyHandForSwamp?.map((c) => c.name)).toEqual(['Mountain', 'Forest'])
    // Outside the play-land label path, the projected enemy hand is still
    // redacted in players[].handCards.
    expectAllCardsHidden(vm.game!.players[1].handCards)
  })
})
