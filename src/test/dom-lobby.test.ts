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

import { DomRenderer, renderLobby } from '../renderers/dom'
import type { AppViewModel, Mode } from '../app/types'
import type { ControllerApi } from '../app/controller'
import type { GameAction } from '../game/types'

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

function makeGameView(): AppViewModel {
  return {
    ...makeView(),
    mode: 'local-hvh',
    game: {
      turn: 1,
      phase: 'main',
      winnerText: '',
      actor: 0,
      actorControl: 'human',
      canInput: false,
      pendingLandName: null,
      pendingPlainsReuseName: null,
      players: [{
        id: 0,
        handCount: 0,
        deckCount: 0,
        graveyardCount: 0,
        handCards: [],
        graveyardCards: [],
        battlefield: [],
      }, {
        id: 1,
        handCount: 0,
        deckCount: 0,
        graveyardCount: 0,
        handCards: [],
        graveyardCards: [],
        battlefield: [],
      }],
      legal: {
        playLandByCard: {},
        counterOptions: [],
        plainsReuseOptions: [],
        canEndTurn: false,
        canPassResponse: false,
      },
      log: [],
      events: [],
      isReplay: false,
      revealedEnemyHandForSwamp: null,
    },
    recording: {
      canSave: true,
      canLoadLocal: true,
      hasLocalSave: true,
      metadata: null,
    },
  }
}

function extractIds(html: string): string[] {
  return Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1])
}

function makeContainer(): HTMLElement & { innerHTML: string } {
  return {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => [],
  } as unknown as HTMLElement & { innerHTML: string }
}

function makeController(view: AppViewModel): ControllerApi {
  return {
    subscribe: () => () => {},
    getViewModel: () => view,
    setAiLevel: () => {},
    setCardVisualStyle: () => {},
    setAnimationSpeed: () => {},
    startGame: (_mode: Mode) => {},
    startAdventure: () => {},
    resumeAdventure: () => {},
    pauseAdventure: () => {},
    abandonAdventure: () => {},
    backToLobby: () => {},
    createOffer: async () => {},
    acceptAnswer: async () => {},
    createAnswer: async () => {},
    startP2PGame: () => {},
    submitAction: (_action: GameAction) => {},
    rematch: () => {},
    exportRecordingJson: () => null,
    importRecordingJson: () => {},
    saveRecordingToLocalStorage: () => {},
    loadRecordingFromLocalStorage: () => {},
    reportStatus: () => {},
    startReplay: () => {},
    pauseReplay: () => {},
    stepReplay: () => {},
    jumpReplayToEnd: () => {},
    exitReplay: () => {},
  }
}

describe('DOM lobby layout', () => {
  it('tags the lobby panel with the `lobby` class so centering CSS applies', () => {
    const html = renderLobby(makeView())
    // The `.lobby` modifier on `.panel` scopes the
    // `justify-content: center` / `text-align: center` rules in style.css.
    expect(html).toContain('class="panel lobby"')
  })

  it('does not duplicate element ids across lobby and in-game menu shells', () => {
    const lobbyHtml = renderLobby(makeView())
    const gameView = makeGameView()
    const renderer = new DomRenderer()
    const container = makeContainer()
    renderer.mount(container, makeController(gameView))
    ;(renderer as unknown as { menuOpen: boolean }).menuOpen = true

    renderer.render(gameView)

    const counts = new Map<string, number>()
    for (const id of extractIds(`${lobbyHtml}\n${container.innerHTML}`)) {
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    const duplicates = Array.from(counts, ([id, count]) => ({ id, count }))
      .filter(({ count }) => count > 1)

    expect(duplicates).toEqual([])
  })
})
