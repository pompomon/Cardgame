import { describe, expect, it, beforeAll } from 'vitest'

// `renderLobby` reaches into `renderInstallControls` → `getInstallUiState`,
// which probes `navigator` / `window`. Vitest runs in Node by default and
// has neither — stub the bare minimum so the lobby renderer is exercisable
// from a Node test.
beforeAll(() => {
  const g = globalThis as unknown as { navigator?: unknown; window?: unknown }
  if (typeof g.navigator === 'undefined') {
    g.navigator = { userAgent: 'node-test', standalone: false }
  }
  if (typeof g.window === 'undefined') {
    g.window = {
      matchMedia: () => ({ matches: false }),
      navigator: g.navigator,
    }
  }
})

import { renderLobby } from '../renderers/dom'
import type { AppViewModel } from '../app/types'

function makeView(): AppViewModel {
  return {
    mode: null,
    renderer: 'dom',
    status: '',
    offer: '',
    answer: '',
    seed: 1,
    controllers: ['human', 'human'],
    aiLevel: 'basic',
    cardVisualStyle: 'classic',
    animationSpeed: 'normal',
    p2pConnected: false,
    p2pStarted: false,
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
    game: null,
    recording: {
      canSave: false,
      canLoadLocal: true,
      hasLocalSave: false,
      metadata: null,
    },
    replay: { active: false, step: 0, totalSteps: 0, isPlaying: false },
  }
}

describe('DOM lobby layout', () => {
  it('tags the lobby panel with the `lobby` class so centering CSS applies', () => {
    const html = renderLobby(makeView())
    // The `.lobby` modifier on `.panel` scopes the
    // `justify-content: center` / `text-align: center` rules in style.css.
    expect(html).toContain('class="panel lobby"')
  })
})
