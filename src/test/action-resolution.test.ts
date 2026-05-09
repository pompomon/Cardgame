import { describe, expect, it } from 'vitest'
import {
  groupCardTargetOptions,
  resolvePlainsReuseAction,
  resolvePlainsReuseTargetSelectionMode,
  resolvePlayLandDrop,
  resolvePlayLandTargetSelectionMode,
  resolveTargetedPlayLandAction,
} from '../app/action-resolution'
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
    p2pStarted: false,
    pendingP2PStartSeed: null,
    pendingRematchSeed: null,
  }
}

describe('action-resolution', () => {
  it('resolves single-target drop to a play_land action', () => {
    const state = createState(50)
    state.game!.players[1].hand = []
    const vm = buildViewModel(state, false)
    const game = vm.game!

    const card = game.players[0].handCards.find((entry) => game.legal.playLandByCard[entry.id]?.length === 1)
    expect(card).toBeTruthy()

    const resolution = resolvePlayLandDrop(game, card!.id)
    expect(resolution.kind).toBe('single')
    if (resolution.kind === 'single') {
      expect(resolution.action.type).toBe('play_land')
      expect(resolution.action.cardId).toBe(card!.id)
    }
  })

  it('requires target selection when multiple legal play targets exist', () => {
    const state = createState(51)
    state.game!.players[1].hand = []
    state.game!.players[0].graveyard = [
      { id: 'g-1', name: 'Forest', type: 'land' },
      { id: 'g-2', name: 'Swamp', type: 'land' },
    ]
    state.game!.players[0].hand = [{ id: 'forest-play', name: 'Forest', type: 'land' }]

    const vm = buildViewModel(state, false)
    const game = vm.game!

    const resolution = resolvePlayLandDrop(game, 'forest-play')
    expect(resolution.kind).toBe('needs_target')
    if (resolution.kind === 'needs_target') {
      expect(resolution.options.length).toBe(2)

      const action = resolveTargetedPlayLandAction(game, 'forest-play', 'g-2')
      expect(action?.effectTargetId).toBe('g-2')
    }
  })

  it('groups duplicate popup target cards and keeps deterministic target mapping', () => {
    const state = createState(54)
    state.game!.players[1].hand = []
    state.game!.players[0].graveyard = [
      { id: 'g-1', name: 'Plains', type: 'land' },
      { id: 'g-2', name: 'Plains', type: 'land' },
      { id: 'g-3', name: 'Swamp', type: 'land' },
    ]
    state.game!.players[0].hand = [{ id: 'forest-play', name: 'Forest', type: 'land' }]

    const vm = buildViewModel(state, false)
    const game = vm.game!
    const resolution = resolvePlayLandDrop(game, 'forest-play')
    expect(resolution.kind).toBe('needs_target')
    if (resolution.kind !== 'needs_target') {
      return
    }

    const grouped = groupCardTargetOptions(game, { kind: 'play_land', cardId: 'forest-play' }, resolution.options)
    expect(grouped.map((entry) => entry.label)).toEqual(['Plains X2', 'Swamp'])
    expect(grouped[0]?.effectTargetId).toBe('g-1')
    expect(grouped[1]?.effectTargetId).toBe('g-3')
  })

  it('routes target selection mode by effect context', () => {
    const state = createState(55)
    state.game!.players[0].hand = [{ id: 'mountain-play', name: 'Mountain', type: 'land' }]
    state.game!.players[1].battlefield = [
      { instanceId: 'bf-1', card: { id: 'x-1', name: 'Plains', type: 'land' } },
      { instanceId: 'bf-2', card: { id: 'x-2', name: 'Forest', type: 'land' } },
    ]

    let vm = buildViewModel(state, false)
    expect(resolvePlayLandTargetSelectionMode(vm.game!, 'mountain-play')).toBe('battlefield_highlight')

    state.game!.players[0].hand = [{ id: 'forest-play', name: 'Forest', type: 'land' }]
    state.game!.players[0].graveyard = [
      { id: 'g-1', name: 'Plains', type: 'land' },
      { id: 'g-2', name: 'Swamp', type: 'land' },
    ]
    vm = buildViewModel(state, false)
    expect(resolvePlayLandTargetSelectionMode(vm.game!, 'forest-play')).toBe('popup_cards')

    state.game!.phase = 'plains_target'
    state.game!.pendingPlainsReuse = {
      actor: 0,
      reusedInstanceId: 'self-1',
      reusedCardName: 'Mountain',
    }
    vm = buildViewModel(state, false)
    expect(resolvePlainsReuseTargetSelectionMode(vm.game!)).toBe('battlefield_highlight')

    state.game!.pendingPlainsReuse = {
      actor: 0,
      reusedInstanceId: 'self-2',
      reusedCardName: 'Swamp',
    }
    state.game!.players[1].hand = [
      { id: 'opp-1', name: 'Plains', type: 'land' },
      { id: 'opp-2', name: 'Plains', type: 'land' },
    ]
    vm = buildViewModel(state, false)
    expect(resolvePlainsReuseTargetSelectionMode(vm.game!)).toBe('popup_cards')
  })

  it('returns invalid for cards without legal play action', () => {
    const state = createState(52)
    state.game!.players[1].hand = []
    const vm = buildViewModel(state, false)

    const resolution = resolvePlayLandDrop(vm.game!, 'missing-card-id')
    expect(resolution.kind).toBe('invalid')
  })

  it('resolves plains reuse target selection action', () => {
    const state = createState(53)
    state.game!.phase = 'plains_target'
    state.game!.pendingPlainsReuse = {
      actor: 0,
      reusedInstanceId: 'self-swamp',
      reusedCardName: 'Swamp',
    }
    state.game!.players[1].hand = [
      { id: 'opp-1', name: 'Forest', type: 'land' },
      { id: 'opp-2', name: 'Mountain', type: 'land' },
    ]

    const vm = buildViewModel(state, false)
    const action = resolvePlainsReuseAction(vm.game!, 'opp-2')
    expect(action).toEqual({ type: 'resolve_plains_reuse', actor: 0, effectTargetId: 'opp-2' })
  })
})
