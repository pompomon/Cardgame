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

import { DomRenderer, renderGame, renderLobby } from '../renderers/dom'
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
    boardTheme: 'classic',
    renderQualityPreference: 'auto',
    p2pConnected: false,
    p2pStarted: false,
    tutorial: {
      active: false,
      stepId: null,
      hint: null,
    },
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
        swampDiscardOptions: [],
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
    addEventListener: () => {},
  } as unknown as HTMLElement & { innerHTML: string }
}

function makeController(view: AppViewModel): ControllerApi {
  return {
    subscribe: () => () => {},
    getViewModel: () => view,
    setAiLevel: () => {},
    setCardVisualStyle: () => {},
    setAnimationSpeed: () => {},
    setBoardTheme: () => {},
    setRenderQualityPreference: () => {},
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
    expect(html).toMatch(/class="[^"]*\bpanel\b[^"]*\blobby\b/)
    expect(html).toContain('dom-cardgame__lobby')
  })

  it('renders a tutorial mode button in the lobby mode list', () => {
    const html = renderLobby(makeView())
    expect(html).toContain('data-mode="tutorial"')
    expect(html).toContain('Tutorial (Learn to Play)')
  })

  it('renders board theme and render quality selectors with selected values', () => {
    const view = makeView()
    view.boardTheme = 'verdant'
    view.renderQualityPreference = 'balanced'

    const html = renderLobby(view)
    expect(html).toContain('id="board-theme-select"')
    expect(html).toContain('id="render-quality-select"')
    expect(html).toContain('<option value="verdant" selected>Verdant</option>')
    expect(html).toContain('<option value="balanced" selected>Balanced</option>')
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

  it('renders mobile-first DOM game layout markers with a collapsible replay log', () => {
    const gameView = makeGameView()
    const html = renderGame(gameView, false)

    expect(html).toContain('data-dom-layout="mobile-first"')
    expect(html).toContain('class="log dom-log-drawer"')
    expect(html).toContain('<summary>Replay Log</summary>')
    expect(html).toContain('dom-board__opponent')
    expect(html).toContain('dom-board__hand')
  })

  it('can keep the previous actor board orientation while effects finish', () => {
    const gameView = makeGameView()
    gameView.game!.actor = 1
    gameView.game!.players[0].handCount = 3
    gameView.game!.players[1].handCount = 7

    const html = renderGame(gameView, false, null, 0)

    expect(html).toContain('aria-label="Player 1 hand"')
    expect(html).toContain('Player 1')
    expect(html).toContain('Player 2 (human) — Active')
    expect(html.indexOf('Player 2')).toBeLessThan(html.indexOf('Player 1'))
  })

  it('keeps Player 1 near-side and marks Player 2 active during an AI turn', () => {
    const gameView = makeGameView()
    gameView.mode = 'local-hvai'
    gameView.controllers = ['human', 'ai']
    gameView.game!.actor = 1
    gameView.game!.actorControl = 'ai'
    gameView.game!.canInput = true
    gameView.game!.legal.canEndTurn = true
    gameView.game!.players[0].handCards = [{ id: 'p0-card', name: 'Forest' }]
    gameView.game!.legal.playLandByCard = {
      'p0-card': [{ action: { type: 'play_land', actor: 0, cardId: 'p0-card' }, label: 'Play Forest' }],
    }
    const renderer = new DomRenderer()
    const container = makeContainer()
    renderer.mount(container, makeController(gameView))

    renderer.render(gameView)

    expect(container.innerHTML).toContain('aria-label="Player 1 hand"')
    expect(container.innerHTML).toContain('Player 2 (ai) — Active')
    expect(container.innerHTML).not.toContain('Player 1 (human) — Active')
    expect(container.innerHTML).not.toContain('data-action="end_turn"')
    expect(container.innerHTML).toContain('draggable="false" data-draggable-card="p0-card"')
  })

  it('continues switching the near-side hand for human versus human games', () => {
    const gameView = makeGameView()
    gameView.game!.actor = 1
    gameView.game!.actorControl = 'human'
    gameView.game!.canInput = true
    gameView.game!.legal.canEndTurn = true
    gameView.game!.players[1].handCards = [{ id: 'p1-card', name: 'Island' }]
    gameView.game!.legal.playLandByCard = {
      'p1-card': [{ action: { type: 'play_land', actor: 1, cardId: 'p1-card' }, label: 'Play Island' }],
    }
    const renderer = new DomRenderer()
    const container = makeContainer()
    renderer.mount(container, makeController(gameView))

    renderer.render(gameView)

    expect(container.innerHTML).toContain('aria-label="Player 2 hand"')
    expect(container.innerHTML).toContain('Player 2 (human) — Active')
    expect(container.innerHTML).toContain('data-action="end_turn"')
    expect(container.innerHTML).toContain('data-draggable-card="p1-card"')
  })

  it('keeps the tutorial hint panel visible between scripted steps', () => {
    const gameView = makeGameView()
    gameView.mode = 'tutorial'
    gameView.tutorial = { active: true, stepId: null, hint: null }

    const html = renderGame(gameView, false)

    expect(html).toContain('class="dom-tutorial-hint"')
    expect(html).toContain('Keep playing to continue the tutorial.')
  })

  it('marks playable active-hand cards as draggable while preserving button fallback', () => {
    const gameView = makeGameView()
    gameView.game!.canInput = true
    gameView.game!.players[0].handCards = [{ id: 'card-1', name: 'Forest' }]
    gameView.game!.legal.playLandByCard = {
      'card-1': [{ action: { type: 'play_land', actor: 0, cardId: 'card-1' }, label: 'Play Forest' }],
    }

    const html = renderGame(gameView, false)

    expect(html).toContain('data-draggable-card="card-1"')
    expect(html).toContain('draggable="true"')
    expect(html).toContain('data-action="play_land"')
    expect(html).toContain('data-drop-zone="play-land"')
    expect(html).toContain('data-preview-card="card-1"')
  })

  it('suppresses card previews while choosing a play-land target', () => {
    const gameView = makeGameView()
    gameView.game!.canInput = true
    gameView.game!.players[0].handCards = [{ id: 'card-1', name: 'Mountain' }]
    gameView.game!.players[1].battlefield = [{ instanceId: 'target-1', cardId: 'target-card-1', name: 'Forest' }]
    gameView.game!.legal.playLandByCard = {
      'card-1': [
        { action: { type: 'play_land', actor: 0, cardId: 'card-1', effectTargetId: 'target-1' }, label: 'Destroy Forest' },
        { action: { type: 'play_land', actor: 0, cardId: 'card-1', effectTargetId: 'target-2' }, label: 'Destroy another land' },
      ],
    }

    const html = renderGame(gameView, false, { cardId: 'card-1' })

    expect(html).not.toContain('data-preview-card=')
    expect(html).toContain('dom-battlefield-card--target')
  })

  it('suppresses card previews in target-resolution phases', () => {
    const gameView = makeGameView()
    gameView.game!.canInput = true
    gameView.game!.phase = 'swamp_target'
    gameView.game!.players[0].handCards = [{ id: 'card-1', name: 'Swamp' }]

    expect(renderGame(gameView, false)).not.toContain('data-preview-card=')
  })

  it('renders hidden enemy hand placeholders without revealing real card names', () => {
    const gameView = makeGameView()
    gameView.game!.actor = 1
    gameView.game!.players[1].handCards = [{ id: 'hidden-1', name: '__hidden__' }]

    const html = renderGame(gameView, false)

    expect(html).toContain('card-tile--hidden')
    expect(html).toContain('Hidden card')
    expect(html).not.toContain('Forest')
    expect(html).not.toContain('Mountain')
    expect(html).not.toContain('Plains')
    expect(html).not.toContain('Swamp')
  })
})
