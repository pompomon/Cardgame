import { describe, expect, it } from 'vitest'
import { buildViewModel } from '../app/view-model'
import { createInitialGame } from '../game/engine'
import type { AppState } from '../app/types'

function createState(seed: number): AppState {
  return {
    mode: 'local-hvh',
    game: createInitialGame(seed),
    controllers: ['human', 'human'],
    seed,
    offer: '',
    answer: '',
    status: '',
    renderer: 'dom',
    recording: null,
    replay: null,
    hasSavedRecording: false,
    aiLevel: 'basic',
    cardVisualStyle: 'classic',
    animationSpeed: 'normal',
    p2pStarted: false,
    pendingP2PStartSeed: null,
    pendingRematchSeed: null,
    adventure: {
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
      highScore: 0,
      hasSavedRun: false,
    },
  }
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
    expect(vm.adventure.status).toBe('inactive')
    // The structured event stream is exposed alongside the log strings so
    // renderers (Phaser visual log, ability animations) can consume it.
    expect(Array.isArray(vm.game?.events)).toBe(true)
    expect(vm.game?.events[0]).toEqual({ kind: 'game_started' })
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
    expect(vm.game?.legal.plainsReuseOptions.map((entry) => entry.action.effectTargetId)).toEqual(['g-1', 'g-2'])
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
    expect(vm.game?.players[1].handCards.every((c) => c.name === '__hidden__')).toBe(true)
  })

  it('redacts the AI hand in adventure-hvai too', () => {
    const state = createState(102)
    state.mode = 'adventure-hvai'
    state.controllers = ['human', 'ai']
    state.game!.players[1].hand = [{ id: 'a-1', name: 'Swamp', type: 'land' }]

    const vm = buildViewModel(state, false)
    expect(vm.game?.players[1].handCards[0].name).toBe('__hidden__')
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

  it('does not leak the AI discard target name in Swamp play-land button labels (hvai)', () => {
    const state = createState(105)
    state.mode = 'local-hvai'
    state.controllers = ['human', 'ai']
    // Human (actor=0) has a Swamp to play.
    state.game!.players[0].hand = [{ id: 'p0-swamp', name: 'Swamp', type: 'land' }]
    // Need lands on the active side for the cost; cards.ts requires a battlefield
    // entry for each color cost. Give P0 a Swamp on the battlefield so Swamp is playable.
    state.game!.players[0].battlefield = [
      { instanceId: 'bf-1', card: { id: 'pre-swamp', name: 'Swamp', type: 'land' } },
    ]
    state.game!.players[1].hand = [
      { id: 'ai-1', name: 'Mountain', type: 'land' },
      { id: 'ai-2', name: 'Forest', type: 'land' },
    ]

    const vm = buildViewModel(state, false)
    // Any play_land label generated for the human's Swamp must NOT mention
    // the actual AI card names (Mountain/Forest); it should fall back to
    // the generic "hidden card" wording.
    const labels = Object.values(vm.game!.legal.playLandByCard).flat().map((o) => o.label).join('|')
    if (labels.length > 0) {
      expect(labels).not.toMatch(/discard Mountain|discard Forest/)
      expect(labels).toMatch(/hidden card/)
    }
  })
})
