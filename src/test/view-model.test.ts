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
