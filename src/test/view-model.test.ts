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
    p2pStarted: false,
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
  })
})
