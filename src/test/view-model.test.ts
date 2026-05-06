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
    p2pStarted: false,
    pendingP2PStartSeed: null,
    pendingRematchSeed: null,
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
  })

  it('labels Plains nested target options with reused and nested effect context', () => {
    const state = createState(54)
    state.game!.players[0].hand = [{ id: 'plains-play', name: 'Plains', type: 'land' }]
    state.game!.players[0].battlefield = [
      { instanceId: 'self-swamp', card: { id: 'self-swamp-card', name: 'Swamp', type: 'land' } },
    ]
    state.game!.players[1].hand = [
      { id: 'opp-a', name: 'Forest', type: 'land' },
      { id: 'opp-b', name: 'Mountain', type: 'land' },
    ]

    const vm = buildViewModel(state, false)
    const options = vm.game?.legal.playLandByCard['plains-play'] ?? []
    const labels = options.map((option) => option.label)

    expect(labels.some((label) => label.includes('reuse Swamp'))).toBe(true)
    expect(labels.some((label) => label.includes('discard Forest'))).toBe(true)
    expect(labels.some((label) => label.includes('discard Mountain'))).toBe(true)
  })
})
