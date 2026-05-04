import { describe, expect, it } from 'vitest'
import { resolvePlayLandDrop, resolveTargetedPlayLandAction } from '../app/action-resolution'
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

  it('returns invalid for cards without legal play action', () => {
    const state = createState(52)
    state.game!.players[1].hand = []
    const vm = buildViewModel(state, false)

    const resolution = resolvePlayLandDrop(vm.game!, 'missing-card-id')
    expect(resolution.kind).toBe('invalid')
  })
})
