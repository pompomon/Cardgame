import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppController, type ControllerApi } from '../app/controller'
import { ADVENTURE_GAME_STORAGE_KEY, type AdventureNodeLane, type AdventureNodeStatus } from '../app/adventure'
import { ADVENTURE_RUN_STORAGE_KEY } from '../app/adventure-persistence'
import { cardAssetSlug, cardCatalogEntry, displayCardName } from '../app/card-catalog'
import { createGameRecord } from '../app/game-recording'
import { cardArtFallbackUrl, cardArtUrl } from '../app/card-art'
import { CARD_VISUAL_STYLES, isRasterCardVisualStyle } from '../app/card-visual-styles'
import { actionableAdventureNodes } from '../app/lobby-presentation'
import {
  HIDDEN_HAND_CARD_NAME,
  type AdventureNodeSummary,
  type AdventureRelicSummary,
  type AdventureResultSummary,
  type AdventureRewardOfferSummary,
  type AdventureTierSummary,
  type AdventureUiState,
  type AppViewModel,
} from '../app/types'
import { createInitialGame } from '../game/engine'
import { BASIC_LANDS, type BasicLand, type GameState } from '../game/types'
import { escapeHtml, noteRasterCardArtLoadFailure, resetRasterCardArtLoadFailuresForTests } from '../renderers/three/native-html'
import { THREE_STATUS_ANNOUNCER_ID, ThreeInterface } from '../renderers/three/interface'
import {
  canThreeInput,
  isThreeMode,
  renderThreeDock,
  renderThreeInterface,
  renderThreeHud,
  threeDecisionKey,
  threePrimaryAction,
  threeResponse,
  threeTargets,
  type InterfaceUi,
} from '../renderers/three/interface-model'
import { NO_BOARD_SELECTION, THREE_DOCK_PROMPT_ID, type BoardHit } from '../renderers/three/contracts'
import { withFakeTimers } from './helpers/timers'
import { createTrackedStorage, type TrackedStorage } from './helpers/tracked-storage'

function makeView(): AppViewModel {
  return {
    mode: 'local-hvh', seed: 42, status: 'Ready', offer: '', answer: '',
    controllers: ['human', 'human'], aiLevel: 'basic', cardVisualStyle: 'classic', monochromeCards: false,
    animationSpeed: 'normal', boardTheme: 'classic', renderQualityPreference: 'auto',
    p2pConnected: false, p2pStarted: false,
    tutorial: { active: false, stepId: null, hint: null },
    adventure: {
      runId: null, baseSeed: 0, status: 'inactive', stage: null, currentTier: 0, attemptOrdinal: 0,
      remainingChances: 3, winStreak: 0, totalRoundsPlayed: 0, totalCardsPlayed: 0, tiers: [],
      activeGameSeed: null, pendingCompletion: null, lastResult: null, relics: [], pendingReward: null,
      highScore: 0, hasSavedRun: false, decisionKey: 'none',
    },
    recording: { canSave: true, canLoadLocal: true, hasLocalSave: true, metadata: null },
    replay: { active: false, step: 0, totalSteps: 10, isPlaying: false },
    game: {
      turn: 1, phase: 'main', actor: 0, actorControl: 'human', canInput: true, winnerText: '',
      pendingLandName: null, pendingLandPlay: null, pendingPlainsReuseName: null, log: [], events: [], isReplay: false,
      revealedEnemyHandForSwamp: null,
      players: [
        { id: 0, handCount: 1, deckCount: 43, graveyardCount: 0, handCards: [{ id: 'source', name: 'Mountain' }], graveyardCards: [], battlefield: [] },
        { id: 1, handCount: 0, deckCount: 43, graveyardCount: 0, handCards: [], graveyardCards: [], battlefield: [
          { instanceId: 'target-1', cardId: 'card-1', name: 'Forest' },
          { instanceId: 'target-2', cardId: 'card-2', name: 'Island' },
        ] },
      ],
      legal: {
        playLandByCard: {
          source: [
            { action: { type: 'play_land', actor: 0, cardId: 'source', effectTargetId: 'target-1' }, label: 'Destroy Forest' },
            { action: { type: 'play_land', actor: 0, cardId: 'source', effectTargetId: 'target-2' }, label: 'Destroy Island' },
          ],
        },
        counterOptions: [], plainsReuseOptions: [], swampDiscardOptions: [],
        canEndTurn: true, canPassResponse: false,
      },
    },
  }
}

function responseView(actor = 0): AppViewModel {
  const view = makeView()
  const game = view.game!
  game.actor = actor
  game.phase = 'respond'
  game.pendingLandName = 'Swamp'
  game.pendingLandDisplayName = 'Memory Vampire'
  game.pendingLandPlay = { cardId: 'pending-swamp', name: 'Swamp', actor: 1 - actor }
  game.players[actor].handCards = [
    { id: 'required-island', name: 'Island' },
    { id: 'discard-forest-1', name: 'Forest' },
    { id: 'discard-forest-2', name: 'Forest' },
    { id: 'discard-island', name: 'Island' },
  ]
  game.players[actor].handCount = 4
  game.legal.playLandByCard = {}
  game.legal.canEndTurn = false
  game.legal.canPassResponse = true
  game.legal.counterOptions = game.players[actor].handCards.slice(1).map((card) => ({
    action: { type: 'counter_land', actor, discardCardId: card.id },
    label: `Counter with Island (discard Island + ${card.name})`,
  }))
  return view
}

function responseHit(cardId = 'discard-forest-1', owner = 0): BoardHit {
  return { key: cardId, cardId, owner, zone: 'hand', name: cardId.includes('island') ? 'Island' : 'Forest', playable: false }
}

const defaultUi: InterfaceUi = {
  presentedActor: 0, menuOpen: false, cardsOpen: false, pendingCardId: null, preview: null,
  previewReturnToCards: false,
  phaseDismissed: false, hostAnswerDraft: '', joinOfferDraft: '',
}

describe('Three pending-play decisions', () => {
  it('invalidates same-name pending plays by card identity and owner, not status', () => {
    const view = responseView()
    const initial = threeDecisionKey(view)
    view.status = 'Action rejected'
    expect(threeDecisionKey(view)).toBe(initial)
    view.game!.pendingLandPlay = { cardId: 'another-swamp', name: 'Swamp', actor: 1 }
    expect(threeDecisionKey(view)).not.toBe(initial)
    const next = threeDecisionKey(view)
    view.game!.pendingLandPlay = { ...view.game!.pendingLandPlay, actor: 0 }
    expect(threeDecisionKey(view)).not.toBe(next)
    expect(threeResponse(view, defaultUi)?.instruction).toContain('blue frame')
    expect(threeResponse(view, defaultUi)?.instruction).toContain('pink frames')
  })
})

function hit(overrides: Partial<BoardHit> = {}): BoardHit {
  return { key: 'target-1', cardId: 'card-1', instanceId: 'target-1', name: 'Forest', owner: 1, zone: 'battlefield', playable: false, ...overrides }
}

// This project runs DOM tests in Node. A small tree stub exercises delegated
// events, focus restoration and file lifetime without adding a browser package.
function decode(value: string): string {
  return value.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
}

class ElementStub {
  readonly tagName: string
  readonly ownerDocument: DocumentStub
  readonly dataset: Record<string, string> = {}
  readonly attributes = new Map<string, string>()
  readonly listeners = new Map<string, (event: never) => unknown>()
  readonly children: ElementStub[] = []
  parent: ElementStub | null = null
  value = ''
  checked = false
  selectionStart: number | null = null
  selectionEnd: number | null = null
  scrollTop = 0
  scrollLeft = 0
  scrollHeight = 1000
  clientHeight = 200
  open = false
  hidden = false
  type = ''
  accept = ''
  href = ''
  download = ''
  files: Array<{ text(): Promise<string> }> = []
  builds = 0
  private html = ''
  private classes = new Set<string>()
  classList = {
    add: (name: string) => { this.classes.add(name) },
    remove: (name: string) => { this.classes.delete(name) },
  }

  constructor(tag: string, ownerDocument: DocumentStub) {
    this.tagName = tag.toUpperCase()
    this.ownerDocument = ownerDocument
  }
  get id(): string { return this.getAttribute('id') ?? '' }
  get isConnected(): boolean { return this === this.ownerDocument.body || !!this.parent?.isConnected }
  get innerHTML(): string { return this.html }
  set innerHTML(value: string) {
    this.html = value
    this.builds += 1
    for (const child of this.children) child.parent = null
    this.children.length = 0
    const stack: ElementStub[] = [this]
    const voids = new Set(['INPUT', 'IMG', 'BR', 'HR', 'META', 'LINK'])
    for (const match of value.matchAll(/<(\/?)([a-z][\w-]*)([^>]*)>/gi)) {
      const tag = match[2].toUpperCase()
      if (match[1]) {
        if (stack[stack.length - 1].tagName === tag) stack.pop()
        continue
      }
      const element = this.ownerDocument.createElement(tag)
      for (const attr of match[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) element.setAttribute(attr[1], decode(attr[2] ?? ''))
      stack[stack.length - 1].append(element)
      if (tag === 'TEXTAREA') {
        const start = (match.index ?? 0) + match[0].length
        element.value = decode(value.slice(start, value.indexOf('</textarea>', start)))
      }
      if (!voids.has(tag)) stack.push(element)
    }
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
    if (name === 'class') this.classes = new Set(value.split(/\s+/))
    if (name === 'open') this.open = true
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value
  }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  hasAttribute(name: string): boolean { return this.attributes.has(name) }
  append(...elements: ElementStub[]): void { for (const element of elements) { this.children.push(element); element.parent = this } }
  remove(): void {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1)
    this.parent = null
  }
  contains(element: ElementStub | null): boolean { return !!element && (element === this || this.children.some((child) => child.contains(element))) }
  matches(selector: string): boolean {
    if (selector.includes(',')) return selector.split(',').some((part) => this.matches(part.trim()))
    const excluded = Array.from(selector.matchAll(/:not\(\[([^\]]+)\]\)/g), (match) => match[1])
    if (excluded.some((name) => this.hasAttribute(name))) return false
    const simple = selector.replace(/:not\([^)]*\)/g, '')
    const tag = simple.match(/^[a-z]+/i)?.[0]
    if (tag && this.tagName !== tag.toUpperCase()) return false
    const className = simple.match(/\.([\w-]+)/)?.[1]
    if (className && !this.classes.has(className)) return false
    const id = simple.match(/#([\w-]+)/)?.[1]
    if (id && this.id !== id) return false
    return Array.from(simple.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g))
      .every((match) => this.hasAttribute(match[1]) && (match[2] === undefined || this.getAttribute(match[1]) === match[2]))
  }
  querySelectorAll(selector: string): ElementStub[] {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)])
  }
  querySelector(selector: string): ElementStub | null { return this.querySelectorAll(selector)[0] ?? null }
  closest(selector: string): ElementStub | null { return this.matches(selector) ? this : this.parent?.closest(selector) ?? null }
  addEventListener(name: string, fn: (event: never) => unknown): void { this.listeners.set(name, fn) }
  removeEventListener(name: string): void { this.listeners.delete(name) }
  emit(name: string, event: unknown = {}): unknown { return this.listeners.get(name)?.(event as never) }
  focus(): void { this.ownerDocument.activeElement = this }
  setSelectionRange(start: number, end: number): void { this.selectionStart = start; this.selectionEnd = end }
  showModal(): void { this.open = true; this.setAttribute('open', '') }
  close(): void { this.open = false; this.attributes.delete('open') }
  click(): void { this.emit('click', { target: this }) }
}

class DocumentStub {
  readonly body = new ElementStub('body', this)
  readonly listeners = new Map<string, (event: never) => unknown>()
  activeElement: ElementStub | null = this.body
  hidden = false
  createElement(tag: string): ElementStub { return new ElementStub(tag, this) }
  addEventListener(name: string, fn: (event: never) => unknown): void { this.listeners.set(name, fn) }
  removeEventListener(name: string): void { this.listeners.delete(name) }
  emit(name: string, event: unknown): unknown { return this.listeners.get(name)?.(event as never) }
}

function setup(view = makeView(), separateHud = false, narrow: { enabled: boolean } | null = null) {
  let current = view
  const document = new DocumentStub()
  const host = document.createElement('section')
  const hud = separateHud ? document.createElement('section') : null
  const dock = narrow ? document.createElement('section') : null
  const board = document.createElement('canvas')
  if (hud) document.body.append(hud)
  if (dock) document.body.append(dock)
  document.body.append(board, host)
  const controller = {
    subscribe: vi.fn(() => () => {}), getViewModel: vi.fn(() => current),
    setAiLevel: vi.fn(), setCardVisualStyle: vi.fn(), setMonochromeCards: vi.fn(), setAnimationSpeed: vi.fn(), setBoardTheme: vi.fn(), setRenderQualityPreference: vi.fn(),
    startGame: vi.fn(), startAdventure: vi.fn(), startAdventureNode: vi.fn(), retryAdventureCompletion: vi.fn(),
    chooseAdventureReward: vi.fn(), skipAdventureReward: vi.fn(),
    resumeAdventure: vi.fn(), pauseAdventure: vi.fn(), abandonAdventure: vi.fn(), backToLobby: vi.fn(),
    createOffer: vi.fn(async () => {}), acceptAnswer: vi.fn(async () => {}), createAnswer: vi.fn(async () => {}), startP2PGame: vi.fn(),
    submitAction: vi.fn(), rematch: vi.fn(), exportRecordingJson: vi.fn((): string | null => '{}'),
    importRecordingJson: vi.fn(), saveRecordingToLocalStorage: vi.fn(), loadRecordingFromLocalStorage: vi.fn(), reportStatus: vi.fn(),
    startReplay: vi.fn(), pauseReplay: vi.fn(), stepReplay: vi.fn(), jumpReplayToEnd: vi.fn(), exitReplay: vi.fn(),
  } satisfies ControllerApi
  const onChange = vi.fn()
  const onBlock = vi.fn()
  const ui = new ThreeInterface(host as unknown as HTMLElement, controller, onChange, onBlock, hud as unknown as HTMLElement | null,
    dock ? { dockHost: dock as unknown as HTMLElement, narrow: () => narrow!.enabled } : {})
  ui.update(view, view.game?.actor ?? 0)
  const content = host.children[0]
  // The interface owns the dock's prompt (first child) and action row (second).
  const dockPrompt = dock?.children[0] ?? null
  const dockActions = dock?.children[1] ?? null
  const click = (selector: string): ElementStub => {
    const element = content.querySelector(selector) ?? hud?.querySelector(selector) ?? dockActions?.querySelector(selector)
    if (!element) throw new Error(`Missing button ${selector}`)
    element.focus()
    ;(hud?.contains(element) ? hud : dockActions?.contains(element) ? dockActions : host).emit('click', { target: element })
    return element
  }
  const openCards = (): void => {
    click('[data-action="menu"]')
    click('[data-action="cards"]')
  }
  const update = (next: AppViewModel, actor = next.game?.actor ?? 0): void => { current = next; ui.update(next, actor) }
  return {
    ui, host, content, hud, dock, dockPrompt, dockActions, board, document, controller, onChange, onBlock, click, openCards, update,
    latest: (next: AppViewModel) => { current = next },
  }
}

function setupPlainsForest({
  graveyard = ['Mountain', 'Swamp', 'Swamp'],
  multipleSources = false,
  counter = false,
  actor = 0,
}: {
  graveyard?: BasicLand[]
  multipleSources?: boolean
  counter?: boolean
  actor?: number
} = {}) {
  const game = createInitialGame(42)
  game.currentPlayer = actor
  game.players[actor].hand = [{ id: 'plains-play', name: 'Plains', type: 'land' }]
  game.players[actor].battlefield = [
    { instanceId: 'self-forest', card: { id: 'forest-card', name: 'Forest', type: 'land' } },
    ...(multipleSources ? [{ instanceId: 'self-island', card: { id: 'island-card', name: 'Island' as const, type: 'land' as const } }] : []),
  ]
  game.players[actor].graveyard = graveyard.map((name, index) => ({ id: `grave-${index}`, name, type: 'land' }))
  game.players[1 - actor].hand = counter
    ? [{ id: 'counter-island', name: 'Island', type: 'land' }, { id: 'counter-discard', name: 'Forest', type: 'land' }]
    : []
  const controller = new AppController()
  controller.importRecordingJson(JSON.stringify(createGameRecord(42, 'local-hvh', ['human', 'human'], 'basic', game)))
  controller.exitReplay()
  const h = setup(controller.getViewModel())
  h.controller.getViewModel.mockImplementation(() => controller.getViewModel())
  h.controller.submitAction.mockImplementation((action) => controller.submitAction(action))
  h.onChange.mockImplementation(() => h.update(controller.getViewModel()))
  const unsubscribe = controller.subscribe((view) => h.update(view))
  return {
    ...h,
    realController: controller,
    forestHit: hit({ key: 'self-forest', cardId: 'forest-card', instanceId: 'self-forest', owner: actor }),
    dispose: () => { unsubscribe(); h.ui.dispose() },
  }
}

beforeEach(() => {
  resetRasterCardArtLoadFailuresForTests()
  vi.stubGlobal('navigator', { userAgent: 'node-test', standalone: false })
  const browserWindow = new EventTarget()
  Object.assign(browserWindow, { matchMedia: () => ({ matches: false }), navigator: { standalone: false } })
  vi.stubGlobal('window', browserWindow)
  vi.stubGlobal('Element', ElementStub)
  vi.stubGlobal('HTMLElement', ElementStub)
  vi.stubGlobal('Node', ElementStub)
  vi.stubGlobal('HTMLTextAreaElement', ElementStub)
  vi.stubGlobal('HTMLSelectElement', ElementStub)
  vi.stubGlobal('HTMLInputElement', ElementStub)
})

afterEach(() => { resetRasterCardArtLoadFailuresForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Three native markup and decisions', () => {
  it('offers read-only discard contents and catalog rules alongside Hand and Board controls', () => {
    const view = makeView()
    view.game!.players[0].graveyardCards = [
      { id: 'discard-a', name: 'Plains' }, { id: 'discard-b', name: 'Plains' },
    ]
    view.game!.players[0].graveyardCount = 2
    const html = renderThreeInterface(view, { ...defaultUi, cardsOpen: true })
    expect(html).toContain('aria-label="Player 1 discard pile"')
    expect(html).toContain('aria-label="Player 2 discard pile"')
    expect(html).toContain('Discard pile empty.')
    expect(html.match(/data-card-art="echo-doppelganger"/g)).toHaveLength(2)
    for (const key of ['Forest', 'Island', 'Mountain', 'Plains'] as const) {
      expect(html).toContain(escapeHtml(cardCatalogEntry(key).primaryAbility.rulesText))
    }
    expect(html).toContain(escapeHtml(cardCatalogEntry('Island').responseAbility!.rulesText))
    expect(html).not.toMatch(/data-card-id="discard-[ab]"/)
  })

  it('never exposes hidden hand abilities, copy or art in the Cards dialog', () => {
    const view = makeView()
    view.game!.players[1].handCards = [{
      id: 'secret', name: HIDDEN_HAND_CARD_NAME,
      serializedKey: 'Swamp', displayName: 'Memory Vampire',
    }]
    view.game!.players[1].handCount = 1
    const html = renderThreeInterface(view, { ...defaultUi, cardsOpen: true })
    expect(html).toContain('Hidden card')
    expect(html).not.toMatch(/Memory Vampire|Drain Memory|memory-vampire|data-card-id="secret"/)
  })

  it('shows ability rules in previews and during interception without changing action choices', () => {
    const view = responseView()
    const html = renderThreeInterface(view, { ...defaultUi, cardsOpen: true })
    expect(html).toContain(escapeHtml(cardCatalogEntry('Island').responseAbility!.rulesText))
    expect(html.match(/data-action="respond-card"/g)).toHaveLength(3)
    expect(html).not.toContain('data-action="play"')
    const preview = renderThreeInterface(makeView(), {
      ...defaultUi, preview: hit({ zone: 'hand', owner: 0, cardId: 'source' }),
    })
    expect(preview).toContain('data-modal="preview"')
    expect(preview).toContain(escapeHtml(cardCatalogEntry('Mountain').primaryAbility.rulesText))
  })

  it('describes the Adventure counter as both players’ attempted summons', () => {
    const view = { ...makeView(), game: null }
    view.adventure = { ...view.adventure, totalCardsPlayed: 7 }
    const html = renderThreeInterface(view, defaultUi)
    expect(html).toContain('Summons attempted (both players): 7')
    expect(html).not.toContain('Cards Played')
  })

  it('uses native lobby root, Settings and Recording subviews without duplicating controls', () => {
    const view = { ...makeView(), game: null }
    const html = renderThreeInterface(view, defaultUi)
    for (const mode of ['tutorial', 'local-hvh', 'local-hvai', 'local-aivai', 'adventure-hvai', 'p2p-host', 'p2p-join']) {
      expect(html).toContain(`data-mode="${mode}"`)
      expect(isThreeMode(mode)).toBe(true)
    }
    expect(html).toContain('Install')
    expect(html).toContain('>Urban Creatures<')
    expect(html).toContain('Urban-fantasy 2-player card game with local AI and optional P2P mode.')
    expect(html).toContain('data-action="lobby-settings"')
    expect(html).toContain('data-action="lobby-recording"')
    expect(html).not.toContain('dom-cardgame__lobby')
    expect(html).not.toContain('ai-level-select')
    expect(html).not.toContain('load-recording-file')
    const settings = renderThreeInterface(view, { ...defaultUi, lobbyPage: 'settings' })
    for (const name of ['ai-level-select', 'card-visual-style-select', 'animation-speed-select', 'board-theme-select', 'render-quality-select']) expect(settings).toContain(name)
    expect(settings).not.toContain('data-mode=')
    const recording = renderThreeInterface(view, { ...defaultUi, lobbyPage: 'recording' })
    for (const name of ['load-recording-file', 'load-recording-local', 'data-action="lobby-root"']) expect(recording).toContain(name)
    expect(recording).not.toContain('ai-level-select')
    expect(isThreeMode('remote')).toBe(false)
    expect(isThreeMode(null)).toBe(false)
  })

  it('keeps P2P signaling visible until acknowledged and exposes connection readiness', () => {
    const view = makeView()
    view.mode = 'p2p-host'
    const html = renderThreeInterface(view, { ...defaultUi, hostAnswerDraft: '<answer>' })
    expect(html).toContain('P2P Manual Signaling')
    expect(html).toContain('id="start-p2p-game" disabled')
    expect(html).toContain('&lt;answer&gt;')
    expect(html).not.toContain('class="three-hud"')
    // Status reads once as plain text; the persistent announcer speaks it.
    expect(html).not.toContain('role="status"')
    expect(html.match(/Ready/g)).toHaveLength(1)
    view.p2pConnected = true
    expect(renderThreeInterface(view, defaultUi)).toContain('id="start-p2p-game">')
    view.p2pStarted = true
    expect(renderThreeInterface(view, defaultUi)).toContain('class="three-hud"')
  })

  it('offers settings, recorder and rematch in game, plus replay transport', () => {
    const view = makeView()
    const html = renderThreeInterface(view, { ...defaultUi, menuOpen: true })
    for (const action of ['rematch', 'back-to-lobby', 'save-recording-download', 'save-recording-local', 'load-recording-file', 'load-recording-local', 'replay-start']) expect(html).toContain(`data-action="${action}"`)
    for (const id of ['ai-level-select', 'card-visual-style-select', 'animation-speed-select', 'board-theme-select', 'render-quality-select']) expect(html).toContain(`id="${id}"`)
    expect(html).toContain('data-action="cards"')
    expect(html).not.toContain('data-modal="cards"')
    const cards = renderThreeInterface(view, { ...defaultUi, cardsOpen: true })
    expect(cards).toContain('data-modal="cards"')
    expect(cards).toContain('data-action="cards-back"')
    expect(cards).toContain('data-action="play"')
    expect(cards).not.toContain('data-modal="menu"')
    expect(html).not.toContain('Switch to')
    view.replay.active = true
    const replay = renderThreeInterface(view, { ...defaultUi, menuOpen: true })
    for (const action of ['replay-playpause', 'replay-prev', 'replay-next', 'replay-end', 'replay-exit']) expect(replay).toContain(`data-action="${action}"`)
    expect(replay).not.toContain('data-action="replay-start"')
    const ids = Array.from(replay.matchAll(/ id="([^"]*)"/g), (match) => match[1])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('provides tutorial hints/exit and adventure pause/reset/resume', () => {
    const view = makeView()
    view.mode = 'tutorial'
    view.tutorial = { active: true, stepId: 'first', hint: '<Play a land>' }
    const tutorial = renderThreeInterface(view, { ...defaultUi, menuOpen: true })
    expect(tutorial).toContain('&lt;Play a land&gt;')
    expect(tutorial).toContain('Exit Tutorial')
    expect(tutorial).not.toContain('data-action="rematch"')
    view.mode = 'adventure-hvai'
    view.adventure = { ...view.adventure, status: 'paused', hasSavedRun: true }
    const adventure = renderThreeInterface(view, { ...defaultUi, menuOpen: true })
    expect(adventure).toContain('Pause Adventure')
    expect(adventure).toContain('Reset Adventure Run')
    expect(adventure).not.toContain('data-action="rematch"')
    expect(renderThreeInterface({ ...view, mode: null, game: null }, defaultUi)).toContain('Resume Adventure')
    // With no game, Adventure mode is the map hub, which never offers Resume.
    const hub = renderThreeInterface({ ...view, game: null }, defaultUi)
    expect(hub).toContain('aria-label="Adventure map"')
    expect(hub).not.toContain('Resume Adventure')
  })

  it('bounds legacy menu logs to the latest 200 and escapes all text', () => {
    const view = makeView()
    view.status = '<script>alert("status")</script>'
    view.game!.log = Array.from({ length: 206 }, (_, index) => `<entry-${index}>`)
    const html = renderThreeInterface(view, { ...defaultUi, menuOpen: true })
    expect(html).toContain('6 older entries omitted')
    expect(html).not.toContain('&lt;entry-5&gt;')
    expect(html).toContain('&lt;entry-6&gt;')
    expect(html).toContain('&lt;entry-205&gt;')
    expect(html).not.toContain('<script>')
    expect(renderThreeInterface(view, defaultUi)).not.toContain('Replay Log')
  })

  it('prioritizes capped structured log tiles, actor badges, art and single accessible equivalents', () => {
    const view = makeView()
    view.game!.events = [
      ...Array.from({ length: 202 }, (_, index) => ({ kind: 'turn_start' as const, actor: 0, turn: index })),
      { kind: 'play_land', actor: 1, cardName: 'Island' },
    ]
    view.game!.log = ['Legacy line must not duplicate events']
    const html = renderThreeInterface(view, { ...defaultUi, menuOpen: true })
    expect(html).toContain('3 older entries omitted')
    expect(html).not.toContain('Turn 2 • Action phase')
    expect(html).toContain('Turn 3 • Action phase')
    expect(html).not.toContain('Legacy line must not duplicate events')
    expect(html.match(/class="three-log-entry"/g)).toHaveLength(200)
    expect(html.match(/class="three-log-visual" aria-hidden="true"/g)).toHaveLength(200)
    expect(html.match(/class="three-sr-only"/g)).toHaveLength(200)
    expect(html).toContain('class="three-log-actor" data-active="false">P2')
    expect(html).toContain('class="three-log-art"')
    expect(html.match(/P2 summons Signal Siren/g)).toHaveLength(1)
    expect(html).not.toContain('role="log"')
    expect(html).not.toContain('aria-live')
    const empty = renderThreeInterface(makeView(), { ...defaultUi, menuOpen: true })
    expect(empty).toContain('No log entries yet.')
  })

  it('translates known legacy Replay Log lines and preserves escaped unknown text', () => {
    const view = makeView()
    view.game!.events = []
    view.game!.log = [
      'Player 1 plays Plains.',
      "Mountain destroys Player 2's Island.",
      '<custom log>',
    ]

    const html = renderThreeInterface(view, { ...defaultUi, menuOpen: true })

    expect(html).toContain('P1 summons Echo Doppelgänger')
    expect(html).toContain(
      'Rooftop Gargoyle banishes P2&#39;s Signal Siren to its owner&#39;s discard pile',
    )
    expect(html).toContain('class="three-log-art"')
    expect(html).toContain('&lt;custom log&gt;')
    expect(html).not.toContain('<custom log>')
  })

  it('omits hidden draw names and art from the Replay Log', () => {
    const view = makeView()
    view.controllers = ['human', 'ai']
    view.game!.events = [{ kind: 'draw', actor: 1, cardName: 'Mountain' }]
    view.game!.log = ['Player 2 draws Mountain.']

    const html = renderThreeInterface(view, { ...defaultUi, menuOpen: true })

    expect(html.match(/P2 draws a card/g)).toHaveLength(1)
    expect(html).not.toContain('Rooftop Gargoyle')
    expect(html).not.toContain('three-log-art')
  })

  it.each([
    { mode: 'p2p-host' as const, controllers: ['human', 'remote'] as const, actor: 1, source: 'structured' as const },
    { mode: 'p2p-host' as const, controllers: ['human', 'remote'] as const, actor: 1, source: 'legacy' as const },
    { mode: 'p2p-join' as const, controllers: ['remote', 'human'] as const, actor: 0, source: 'structured' as const },
    { mode: 'p2p-join' as const, controllers: ['remote', 'human'] as const, actor: 0, source: 'legacy' as const },
  ])('uses imported $mode recording visibility for $source Replay Log draws during and after replay', ({
    mode,
    controllers,
    actor,
    source,
  }) => {
    const view = makeView()
    view.replay.active = true
    view.game!.isReplay = true
    view.recording.metadata = {
      seed: 42,
      mode,
      controllers: [...controllers],
      aiLevel: 'basic',
      completed: true,
    }
    if (source === 'structured') {
      view.game!.events = [{ kind: 'draw', actor, cardName: 'Mountain' }]
    } else {
      view.game!.events = []
      view.game!.log = [`Player ${actor + 1} draws Mountain.`]
    }

    for (const replayActive of [true, false]) {
      view.replay.active = replayActive
      view.game!.isReplay = replayActive
      const html = renderThreeInterface(view, { ...defaultUi, menuOpen: true })

      expect(html.match(new RegExp(`P${actor + 1} draws a card`, 'g'))).toHaveLength(1)
      expect(html).not.toContain('Rooftop Gargoyle')
      expect(html).not.toContain('three-log-art')
    }
  })

  it('places menu/status/winner in the HUD and keeps native controls out of document flow', () => {
    const view = responseView()
    view.game!.winnerText = 'Winner announcement'
    const hud = renderThreeHud(view, defaultUi)
    for (const text of ['☰ Menu', 'Turn 1 · Interception window', 'Player 1', 'Ready', 'Winner announcement']) expect(hud).toContain(text)
    expect(hud).not.toContain('Cards &amp; keyboard controls')
    const controls = renderThreeInterface(view, defaultUi, false)
    expect(controls).not.toContain('data-modal="cards"')
    expect(controls).not.toContain('class="three-hud"')
    expect(controls).not.toContain('data-action="end_turn"')
    expect(controls).not.toContain('data-action="pass_response"')
    expect(renderThreeInterface(view, { ...defaultUi, cardsOpen: true }, false)).toContain('data-modal="cards"')
  })

  it.each([true, false])('leaves response instructions to the battlefield (can counter: %s)', (canCounter) => {
    const view = responseView()
    view.game!.pendingLandName = 'Mountain'
    if (!canCounter) view.game!.legal.counterOptions = []
    for (const status of ['Local Human vs AI game started.', 'Storage unavailable.']) {
      view.status = status
      for (const html of [renderThreeHud(view, defaultUi), renderThreeInterface(view, defaultUi)]) {
        expect(html).not.toContain('Intercept the summon of Rooftop Gargoyle')
        expect(html).not.toContain('class="three-required-prompt"')
        expect(html).toContain(`<p>${status}</p>`)
        for (const text of ['☰ Menu', 'Turn 1 · Interception window', 'Player 1']) expect(html).toContain(text)
      }
    }
  })

  it('groups Forest targets but keeps battlefield copies individually selectable', () => {
    const view = makeView()
    const battlefield = threeTargets(view, { ...defaultUi, pendingCardId: 'source' })!
    expect(battlefield.battlefield).toBe(true)
    expect(battlefield.options).toHaveLength(2)
    expect(renderThreeHud(view, { ...defaultUi, pendingCardId: 'source' }))
      .toContain('<p class="three-required-prompt">Choose an opposing creature to send to its owner&#39;s discard pile.</p>')
    view.game!.players[0].handCards[0].name = 'Forest'
    view.game!.players[0].graveyardCards = [{ id: 'target-1', name: 'Island' }, { id: 'target-2', name: 'Island' }]
    const targets = threeTargets(view, { ...defaultUi, pendingCardId: 'source' })!
    expect(targets.battlefield).toBe(false)
    expect(targets.options).toEqual([{
      cardName: 'Island',
      serializedKey: 'Island',
      displayName: 'Signal Siren',
      assetSlug: 'signal-siren',
      label: 'Signal Siren X2',
      effectTargetId: 'target-1',
      count: 2,
    }])
  })

  it('never widens hidden hand previews and scopes the Swamp reveal to the picker', () => {
    const view = makeView()
    view.game!.players[1].handCards = [{ id: 'secret', name: HIDDEN_HAND_CARD_NAME }]
    view.game!.revealedEnemyHandForSwamp = [{ id: 'secret', name: 'Private Swamp name' }]
    expect(renderThreeInterface(view, defaultUi)).not.toContain('Hidden card')
    expect(renderThreeInterface(view, { ...defaultUi, cardsOpen: true })).toContain('Hidden card')
    expect(renderThreeInterface(view, defaultUi)).not.toContain('Private Swamp name')
    view.game!.phase = 'swamp_target'
    view.game!.legal.swampDiscardOptions = [{ action: { type: 'resolve_swamp_discard', actor: 0, effectTargetId: 'secret' }, label: 'Choose hidden card' }]
    const html = renderThreeInterface(view, defaultUi)
    expect(html).toContain('Private Swamp name')
    expect(html).toContain('data-modal="target"')
    expect(renderThreeHud(view, defaultUi))
      .toContain('<p class="three-required-prompt">Choose a card from your opponent&#39;s hand for them to discard.</p>')
    expect(html).not.toContain('Hidden card')
    expect(html).not.toContain('Preview Private Swamp name')
  })

  it('makes single Plains targets explicit and highlights the battlefield', () => {
    const view = makeView()
    view.game!.phase = 'plains_target'
    view.game!.pendingPlainsReuseName = 'Mountain'
    view.game!.legal.plainsReuseOptions = [{ action: { type: 'resolve_plains_reuse', actor: 0, effectTargetId: 'target-1' }, label: 'Destroy Forest' }]
    const target = threeTargets(view, defaultUi)!
    expect(target.battlefield).toBe(true)
    expect(target.options).toHaveLength(1)
    expect(renderThreeHud(view, defaultUi))
      .toContain('<p class="three-required-prompt">Choose an opposing creature to send to its owner&#39;s discard pile.</p>')
    expect(renderThreeInterface(view, defaultUi)).toContain('data-action="target" data-target-id="target-1"')
    expect(renderThreeInterface(view, { ...defaultUi, phaseDismissed: true })).toContain('data-action="resume-target"')
  })

  it('gates gameplay by input, replay and presented actor without reacting to status/settings', () => {
    const view = makeView()
    expect(canThreeInput(view, 0)).toBe(true)
    expect(canThreeInput(view, 1)).toBe(false)
    expect(canThreeInput({ ...view, replay: { ...view.replay, active: true } }, 0)).toBe(false)
    expect(threeDecisionKey(view)).toBe(threeDecisionKey({ ...view, status: 'New status', animationSpeed: 'off' }))
    expect(threeDecisionKey(view)).not.toBe(threeDecisionKey({ ...view, seed: 43 }))
  })
})

describe('Three battlefield primary action', () => {
  it('projects one phase-specific action and removes duplicate lower-panel buttons', () => {
    for (const [view, type, label] of [
      [makeView(), 'end_turn', 'End Turn'],
      [responseView(), 'pass_response', 'Let It Through'],
    ] as const) {
      const action = threePrimaryAction(view, defaultUi)
      expect(action).toMatchObject({ type, label, disabled: false, decision: threeDecisionKey(view) })
      const html = renderThreeInterface(view, defaultUi)
      expect(html).not.toContain('data-action="end_turn"')
      expect(html).not.toContain('data-action="pass_response"')
      expect(renderThreeInterface(view, { ...defaultUi, cardsOpen: true }))
        .toContain(`Hand ${view.game!.players[0].handCount}`)
    }
  })

  it.each(['main', 'respond'] as const)('respects legality and blocking during %s', (phase) => {
    const view = phase === 'main' ? makeView() : responseView()
    const h = setup(view)
    const original = h.ui.primaryAction!
    h.click('[data-action="menu"]')
    h.ui.activatePrimaryAction(original)
    h.click('[data-action="close"]')
    h.ui.activate(hit())
    h.ui.activatePrimaryAction(original)
    h.click('[data-action="close"]')
    if (phase === 'main') {
      h.ui.playCard('source')
      expect(h.ui.primaryAction?.disabled).toBe(true)
      h.ui.activatePrimaryAction(original)
    }
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    const next = { ...view, game: { ...view.game!, legal: {
      ...view.game!.legal, canEndTurn: false, canPassResponse: false,
    } } }
    h.update(next)
    expect(h.ui.primaryAction?.disabled).toBe(true)
    h.ui.activatePrimaryAction(h.ui.primaryAction!)
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    h.ui.dispose()
  })

  it.each([
    ['AI', (view: AppViewModel) => { view.controllers[0] = 'ai'; view.game!.actorControl = 'ai' }],
    ['remote', (view: AppViewModel) => { view.controllers[0] = 'remote'; view.game!.actorControl = 'remote' }],
    ['no input', (view: AppViewModel) => { view.game!.canInput = false }],
    ['replay', (view: AppViewModel) => { view.replay.active = true }],
    ['game replay', (view: AppViewModel) => { view.game!.isReplay = true }],
    ['game over', (view: AppViewModel) => { view.game!.phase = 'gameOver' }],
    ['Plains target', (view: AppViewModel) => { view.game!.phase = 'plains_target' }],
    ['Swamp target', (view: AppViewModel) => { view.game!.phase = 'swamp_target' }],
    ['P2P lobby', (view: AppViewModel) => { view.mode = 'p2p-host' }],
  ] as const)('does not offer or submit a primary action for %s', (_name, prepare) => {
    const view = makeView()
    const h = setup(view)
    const old = h.ui.primaryAction!
    prepare(view)
    h.update(view)
    expect(h.ui.primaryAction).toBeNull()
    h.ui.activatePrimaryAction(old)
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    h.ui.dispose()
  })

  it('rejects stale presses before and after a new decision is presented', () => {
    const h = setup()
    const old = h.ui.primaryAction!
    const next = makeView()
    next.game!.turn += 1
    h.latest(next)
    h.ui.activatePrimaryAction(old)
    h.ui.activatePrimaryAction(old)
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    h.update(next, 1)
    expect(h.ui.primaryAction).toBeNull()
    h.ui.activatePrimaryAction(old)
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    h.ui.dispose()
    expect(h.ui.primaryAction).toBeNull()
    h.ui.activatePrimaryAction(old)
    expect(h.controller.submitAction).not.toHaveBeenCalled()
  })

  it.each([0, 1])('passes for the presented responder %s, even without counter cards', (actor) => {
    const view = responseView(actor)
    view.game!.legal.counterOptions = []
    const h = setup(view)
    const action = h.ui.primaryAction!
    expect(action.prompt).toContain('No legal card combination can intercept the summon of Memory Vampire. Choose Let It Through.')
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    h.controller.submitAction.mockImplementation(() => h.latest({ ...view, game: { ...view.game!, canInput: false } }))
    h.ui.activatePrimaryAction(action)
    h.ui.activatePrimaryAction(action)
    expect(h.controller.submitAction).toHaveBeenCalledExactlyOnceWith({ type: 'pass_response', actor })
    h.ui.dispose()
  })

  it('keeps a battlefield button focused across status changes and respects modal focus', () => {
    const view = makeView()
    const h = setup(view)
    const boardButton = h.document.createElement('button')
    h.document.body.append(boardButton)
    boardButton.focus()
    h.update({ ...view, status: 'Saved' })
    expect(h.document.activeElement).toBe(boardButton)
    h.click('[data-action="menu"]')
    boardButton.focus()
    h.document.emit('focusin', { target: boardButton })
    expect(h.document.activeElement?.closest('dialog')).not.toBeNull()
    h.ui.dispose()
  })
})

describe('Three HUD, lobby navigation and replay log state', () => {
  it('keeps the canvas and native controls stable when only the separate HUD changes', () => {
    const view = makeView()
    const h = setup(view, true)
    expect(h.document.body.children).toEqual([h.hud, h.board, h.host])
    const native = h.content.querySelector('[data-detail-key="cards"]')!
    const builds = h.content.builds
    h.board.focus()
    h.update({ ...view, status: 'Saved successfully' })
    expect(h.content.builds).toBe(builds)
    expect(h.content.querySelector('[data-detail-key="cards"]')).toBe(native)
    expect(h.document.activeElement).toBe(h.board)
    expect(h.hud!.innerHTML).toContain('Saved successfully')
    expect(h.content.innerHTML).not.toContain('Saved successfully')
    h.click('[data-action="menu"]')
    expect(h.content.querySelector('dialog')?.open).toBe(true)
    h.update({ ...view, status: 'Menu status changed' })
    expect(h.document.activeElement?.closest('dialog')).not.toBeNull()
    h.click('[data-action="close"]')
    expect(h.document.activeElement).toBe(h.hud!.querySelector('[data-action="menu"]'))
    h.ui.dispose()
    expect(h.hud!.innerHTML).toBe('')
    expect(h.hud!.listeners.size).toBe(0)
    expect(h.board.isConnected).toBe(true)
  })

  it('navigates Menu, Cards and Preview as nested dialogs with focus restoration', () => {
    const h = setup(makeView(), true)
    h.openCards()
    expect(h.content.querySelector('dialog')?.dataset.modal).toBe('cards')
    const previewSelector = '[data-action="preview"][data-zone="hand"][data-card-id="source"]'
    h.click(previewSelector)
    expect(h.content.querySelector('dialog')?.dataset.modal).toBe('preview')
    expect(h.content.querySelector('[data-action="close"]')?.getAttribute('aria-label')).toBe('Back to Cards')
    h.document.emit('keydown', { key: 'Escape', preventDefault: vi.fn() })
    expect(h.content.querySelector('dialog')?.dataset.modal).toBe('cards')
    expect(h.document.activeElement).toBe(h.content.querySelector(previewSelector))
    h.document.emit('keydown', { key: 'Escape', preventDefault: vi.fn() })
    expect(h.content.querySelector('dialog')?.dataset.modal).toBe('menu')
    expect(h.document.activeElement?.dataset.action).toBe('cards')
    h.document.emit('keydown', { key: 'Escape', preventDefault: vi.fn() })
    expect(h.content.querySelector('dialog')).toBeNull()
    expect(h.document.activeElement).toBe(h.hud!.querySelector('[data-action="menu"]'))
    h.ui.dispose()
  })

  it('preserves discard scroll and updates read-only contents across notifications and preview return', () => {
    const view = makeView()
    view.game!.players[0].graveyardCards = [{ id: 'discard', name: 'Plains' }]
    view.game!.players[0].graveyardCount = 1
    const h = setup(view)
    h.openCards()
    const discard = h.content.querySelector('[data-scroll-key="discard-0"]')!
    discard.scrollTop = 29
    const selector = '[data-action="preview"][data-zone="hand"][data-card-id="source"]'
    h.click(selector)
    expect(h.content.innerHTML).toContain('Banish')
    h.document.emit('keydown', { key: 'Escape', preventDefault: vi.fn() })
    expect(h.content.querySelector('[data-scroll-key="discard-0"]')!.scrollTop).toBe(29)
    expect(h.document.activeElement).toBe(h.content.querySelector(selector))
    h.update({ ...view, status: 'Saved', cardVisualStyle: 'anime' })
    expect(h.content.innerHTML).toContain('data-card-art="echo-doppelganger"')
    const next = structuredClone(view)
    next.game!.players[0].graveyardCards = []
    next.game!.players[0].graveyardCount = 0
    h.update(next)
    expect(h.content.innerHTML).not.toContain('Echo Doppelgänger')
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    h.ui.dispose()
  })

  it('preserves Cards dialog scroll on settings updates and closes only after an accepted action', () => {
    const view = makeView()
    view.game!.legal.playLandByCard.source = [view.game!.legal.playLandByCard.source[0]]
    const h = setup(view)
    h.openCards()
    const hand = h.content.querySelector('[data-scroll-key="hand-0"]')!
    hand.scrollLeft = 37
    hand.scrollTop = 19
    h.update({ ...view, cardVisualStyle: 'anime' })
    expect(h.content.querySelector('[data-scroll-key="hand-0"]')!.scrollLeft).toBe(37)
    expect(h.content.querySelector('[data-scroll-key="hand-0"]')!.scrollTop).toBe(19)

    h.controller.submitAction.mockImplementationOnce(() => h.latest({ ...view, status: 'Rejected' }))
    h.click('[data-action="play"]')
    expect(h.content.querySelector('dialog')?.dataset.modal).toBe('cards')

    h.controller.submitAction.mockImplementationOnce(() => h.latest({
      ...view, game: { ...view.game!, canInput: false },
    }))
    h.click('[data-action="play"]')
    expect(h.content.querySelector('dialog')).toBeNull()
    expect(h.controller.submitAction).toHaveBeenCalledTimes(2)
    h.ui.dispose()
  })

  it('retains separate subviews after notifications, restores navigation focus and guards recording readiness', () => {
    const view = { ...makeView(), game: null, recording: {
      canSave: false, canLoadLocal: false, hasLocalSave: false, metadata: null,
    } }
    const h = setup(view)
    h.click('[data-action="lobby-settings"]')
    expect(h.document.activeElement?.hasAttribute('data-lobby-heading')).toBe(true)
    h.update({ ...view, status: 'Settings saved', aiLevel: 'hard' })
    expect(h.content.querySelector('[data-lobby-page="settings"]')).not.toBeNull()
    h.click('[data-action="lobby-root"]')
    expect(h.document.activeElement?.dataset.action).toBe('lobby-settings')
    h.click('[data-action="lobby-recording"]')
    const unavailable = h.content.querySelector('[data-action="load-recording-local"]')!
    expect(unavailable.hasAttribute('disabled')).toBe(true)
    h.host.emit('click', { target: unavailable })
    expect(h.controller.loadRecordingFromLocalStorage).not.toHaveBeenCalled()
    h.update({ ...view, recording: { ...view.recording, hasLocalSave: true, canLoadLocal: true } })
    expect(h.content.querySelector('[data-lobby-page="recording"]')).not.toBeNull()
    h.click('[data-action="load-recording-local"]')
    expect(h.controller.loadRecordingFromLocalStorage).toHaveBeenCalledOnce()
    h.ui.dispose()
  })

  it.each(['p2p-host', 'p2p-join'] as const)('preserves %s signaling drafts, selection and readiness through subviews', (mode) => {
    const view = { ...makeView(), game: null, mode }
    const h = setup(view)
    const selector = mode === 'p2p-host' ? '#answer-text' : '#join-offer-text'
    const input = h.content.querySelector(selector)!
    input.value = 'pasted <signal>'
    input.setSelectionRange(2, 7)
    input.focus()
    h.host.emit('input', { target: input })
    h.update({ ...view, p2pConnected: true, status: 'Connected' })
    let restored = h.content.querySelector(selector)!
    expect(restored.value).toBe('pasted <signal>')
    expect(restored.selectionStart).toBe(2)
    expect(restored.selectionEnd).toBe(7)
    expect(h.document.activeElement).toBe(restored)
    h.click('[data-action="lobby-settings"]')
    restored = h.content.querySelector(selector)!
    expect(restored.value).toBe('pasted <signal>')
    h.click(mode === 'p2p-host' ? '#accept-answer' : '#create-answer')
    expect(mode === 'p2p-host' ? h.controller.acceptAnswer : h.controller.createAnswer).toHaveBeenCalledExactlyOnceWith('pasted <signal>')
    h.ui.dispose()
  })

  it('preserves independent log expansion and reading position across menu close, status and replay steps', () => {
    const view = makeView()
    view.replay.active = true
    const h = setup(view)
    h.click('[data-action="menu"]')
    const menu = h.content.querySelector('dialog')!
    menu.scrollTop = 90
    let detail = h.content.querySelector('[data-detail-key="log"]')!
    detail.open = true
    h.host.emit('toggle', { target: detail })
    expect(menu.scrollTop).toBe(90)
    let log = h.content.querySelector('[data-scroll-key="log"]')!
    expect(log.scrollTop).toBe(log.scrollHeight)
    log.scrollTop = 140
    h.host.emit('scroll', { target: log })
    h.click('[data-action="close"]')
    h.update({ ...view, status: 'Replay status', replay: { ...view.replay, step: 4 } })
    h.click('[data-action="menu"]')
    detail = h.content.querySelector('[data-detail-key="log"]')!
    log = h.content.querySelector('[data-scroll-key="log"]')!
    expect(detail.open).toBe(true)
    expect(log.scrollTop).toBe(140)
    h.ui.reset(true)
    h.update({ ...view, replay: { ...view.replay, step: 2 } })
    expect(h.content.querySelector('dialog')?.dataset.modal).toBe('menu')
    expect(h.content.querySelector('[data-scroll-key="log"]')!.scrollTop).toBe(140)
    h.content.querySelector('dialog')!.scrollTop = 70
    h.click('[data-action="log-latest"]')
    expect(h.content.querySelector('dialog')!.scrollTop).toBe(70)
    log = h.content.querySelector('[data-scroll-key="log"]')!
    expect(log.scrollTop).toBe(log.scrollHeight)
    h.click('[data-action="close"]')
    h.update({ ...view, status: 'Another event', replay: { ...view.replay, step: 3 } })
    h.click('[data-action="menu"]')
    log = h.content.querySelector('[data-scroll-key="log"]')!
    expect(log.scrollTop).toBe(log.scrollHeight)
    detail = h.content.querySelector('[data-detail-key="log"]')!
    detail.open = false
    h.host.emit('toggle', { target: detail })
    h.click('[data-action="close"]')
    h.click('[data-action="menu"]')
    expect(h.content.querySelector('[data-detail-key="log"]')!.open).toBe(false)
    h.ui.dispose()
  })

  it('clears log expansion and reading position on a full session reset', () => {
    const h = setup()
    h.click('[data-action="menu"]')
    const detail = h.content.querySelector('[data-detail-key="log"]')!
    detail.open = true
    h.host.emit('toggle', { target: detail })
    let log = h.content.querySelector('[data-scroll-key="log"]')!
    log.scrollTop = 140
    h.host.emit('scroll', { target: log })

    h.ui.reset()
    h.click('[data-action="menu"]')
    const resetDetail = h.content.querySelector('[data-detail-key="log"]')!
    expect(resetDetail.open).toBe(false)
    resetDetail.open = true
    h.host.emit('toggle', { target: resetDetail })
    log = h.content.querySelector('[data-scroll-key="log"]')!
    expect(log.scrollTop).toBe(log.scrollHeight)
    h.ui.dispose()
  })
})

describe('Three non-modal hover previews', () => {
  it('suppresses hover while choosing a response', () => {
    const h = setup(responseView())
    h.ui.setHover(hit())
    expect(h.host.children[2].innerHTML).toBe('')
    h.ui.dispose()
  })

  it('updates only its own decorative overlay without focus, input blocking or notifications', () => {
    const h = setup(makeView(), true)
    h.board.focus()
    const builds = h.content.builds
    const hudBuilds = h.hud!.builds
    h.ui.setHover(hit())
    const overlay = h.host.children[2]
    expect(overlay.innerHTML).toContain('class="three-hover-preview" aria-hidden="true"')
    expect(overlay.querySelector('dialog')).toBeNull()
    expect(overlay.querySelector('button')).toBeNull()
    expect(h.document.activeElement).toBe(h.board)
    expect(h.ui.isBlocked()).toBe(false)
    expect(h.ui.primaryAction?.disabled).toBe(false)
    expect(h.content.builds).toBe(builds)
    expect(h.hud!.builds).toBe(hudBuilds)
    expect(h.onChange).not.toHaveBeenCalled()
    h.ui.activate(hit())
    expect(overlay.innerHTML).toBe('')
    expect(h.content.querySelector('[data-modal="preview"]')?.open).toBe(true)
    h.ui.dispose()
  })

  it.each(['decision', 'menu', 'target', 'visibility', 'reset', 'dispose'] as const)('clears hover on %s', (reason) => {
    const view = makeView()
    const h = setup(view)
    const overlay = h.host.children[2]
    h.ui.setHover(hit())
    expect(overlay.innerHTML).not.toBe('')
    if (reason === 'decision') h.update({ ...view, game: { ...view.game!, turn: 2 } })
    else if (reason === 'menu') h.click('[data-action="menu"]')
    else if (reason === 'target') h.ui.playCard('source')
    else if (reason === 'visibility') { h.document.hidden = true; h.document.emit('visibilitychange', {}) }
    else if (reason === 'reset') h.ui.reset()
    else h.ui.dispose()
    expect(reason === 'dispose' ? overlay.isConnected : overlay.innerHTML.length > 0).toBe(false)
    h.ui.setHover(hit())
    if (reason === 'menu' || reason === 'target' || reason === 'visibility') expect(overlay.innerHTML).toBe('')
    h.ui.dispose()
  })

  it('does not reveal hidden cards or reuse a vanished hover target', () => {
    const view = makeView()
    view.game!.players[1].handCards = [{ id: 'secret', name: HIDDEN_HAND_CARD_NAME }]
    const h = setup(view)
    h.ui.setHover(hit({ zone: 'hand', cardId: 'secret', name: 'Secret Forest' }))
    expect(h.host.children[2].innerHTML).toBe('')
    h.ui.setHover(hit())
    expect(h.host.children[2].innerHTML).toContain('Gravebloom Dryad')
    h.update({ ...view, status: 'Saved' })
    expect(h.host.children[2].innerHTML).toContain('Gravebloom Dryad')
    h.update({ ...view, game: { ...view.game!, players: [
      view.game!.players[0], { ...view.game!.players[1], battlefield: [] },
    ] } })
    expect(h.host.children[2].innerHTML).toBe('')
    h.ui.dispose()
  })
})

describe('Plains-triggered Forest picker', () => {
  it.each(['board', 'native'] as const)('opens the graveyard dialog after selecting Forest via %s', (input) => {
    const h = setupPlainsForest({ multipleSources: true })
    if (input === 'board') h.ui.playCard('plains-play')
    else {
      h.openCards()
      h.click('[data-action="play"]')
    }
    expect([...h.ui.targetIds]).toEqual(['self-forest', 'self-island'])
    if (input === 'board') h.ui.activate(h.forestHit)
    else h.click('[data-target-id="self-forest"]')

    const game = h.realController.getViewModel().game!
    expect(game.phase).toBe('plains_target')
    expect(game.pendingPlainsReuseName).toBe('Forest')
    expect(game.players[0].handCards).toEqual([])
    expect(h.content.querySelector('[data-modal="target"]')?.open).toBe(true)
    expect(h.content.querySelector('dialog')?.getAttribute('aria-label'))
      .toBe('Choose a creature in your discard pile to return to your hand.')
    expect(h.content.innerHTML).toContain('Memory Vampire X2')
    expect(h.ui.targetIds.size).toBe(0)
    expect(h.ui.isBlocked()).toBe(true)
    expect(h.content.querySelector('.three-target-panel')).toBeNull()
    expect(h.document.activeElement?.closest('dialog')).not.toBeNull()
    expect(h.controller.submitAction).toHaveBeenCalledExactlyOnceWith({
      type: 'play_land', actor: 0, cardId: 'plains-play', effectTargetId: 'self-forest',
    })
    h.dispose()
  })

  it.each([0, 1])('opens for caster %s with a sole Forest source and resolves a grouped choice once', (actor) => {
    const h = setupPlainsForest({ actor })
    h.ui.playCard('plains-play')
    const dialog = h.content.querySelector('[data-modal="target"]')!
    const targets = dialog.querySelectorAll('[data-action="target"]')
    expect(targets.map((button) => button.dataset.targetId)).toEqual(['grave-0', 'grave-1'])
    const staleButton = targets[1]
    h.click('[data-target-id="grave-1"]')
    h.host.emit('click', { target: staleButton })
    expect(h.controller.submitAction).toHaveBeenCalledTimes(2)
    expect(h.controller.submitAction).toHaveBeenLastCalledWith({
      type: 'resolve_plains_reuse', actor, effectTargetId: 'grave-1',
    })
    const game = h.realController.getViewModel().game!
    expect(game.phase).toBe('main')
    expect(game.players[actor].handCards).toEqual([{
      id: 'grave-1',
      name: 'Swamp',
      serializedKey: 'Swamp',
      displayName: 'Memory Vampire',
    }])
    expect(game.players[actor].graveyardCards.map((card) => card.id)).toEqual(['grave-0', 'grave-2'])
    expect(h.content.querySelector('dialog')).toBeNull()
    expect(h.ui.isBlocked()).toBe(false)
    h.dispose()
  })

  it('requires explicit confirmation of a sole graveyard card', () => {
    const h = setupPlainsForest({ graveyard: ['Island'] })
    h.ui.playCard('plains-play')
    expect(h.content.querySelector('[data-modal="target"]')?.open).toBe(true)
    expect(h.content.querySelectorAll('[data-action="target"]')).toHaveLength(1)
    expect(h.controller.submitAction).toHaveBeenCalledTimes(1)
    expect(h.realController.getViewModel().game!.players[0].handCards).toEqual([])
    h.click('[data-target-id="grave-0"]')
    expect(h.realController.getViewModel().game!.players[0].handCards).toEqual([{
      id: 'grave-0',
      name: 'Island',
      serializedKey: 'Island',
      displayName: 'Signal Siren',
    }])
    h.dispose()
  })

  it('does not block on an empty graveyard', () => {
    const h = setupPlainsForest({ graveyard: [] })
    h.ui.playCard('plains-play')
    expect(h.realController.getViewModel().game!.phase).toBe('main')
    expect(h.content.querySelector('dialog')).toBeNull()
    expect(h.ui.isBlocked()).toBe(false)
    h.dispose()
  })

  it('opens only after the opponent passes, not while awaiting a response', () => {
    const h = setupPlainsForest({ counter: true })
    h.ui.playCard('plains-play')
    expect(h.realController.getViewModel().game!.phase).toBe('respond')
    expect(h.content.querySelector('dialog')).toBeNull()
    h.ui.activatePrimaryAction(h.ui.primaryAction!)
    expect(h.realController.getViewModel().game!.phase).toBe('plains_target')
    expect(h.content.querySelector('[data-modal="target"]')?.open).toBe(true)
    h.click('[data-target-id="grave-0"]')
    expect(h.controller.submitAction).toHaveBeenLastCalledWith({
      type: 'resolve_plains_reuse', actor: 0, effectTargetId: 'grave-0',
    })
    h.dispose()
  })

  it('does not open when Plains is countered', () => {
    const h = setupPlainsForest({ counter: true })
    h.ui.playCard('plains-play')
    h.openCards()
    h.click('[data-action="respond-card"]')
    const game = h.realController.getViewModel().game!
    expect(game.phase).toBe('main')
    expect(game.pendingPlainsReuseName).toBeNull()
    expect(h.content.querySelector('dialog')).toBeNull()
    expect(game.players[0].graveyardCards.at(-1)?.id).toBe('plains-play')
    h.dispose()
  })

  it.each(['close', 'Escape'])('keeps a dismissed choice available after %s and status/settings updates', (dismiss) => {
    const h = setupPlainsForest()
    h.ui.playCard('plains-play')
    if (dismiss === 'close') h.click('[data-action="close"]')
    else h.document.emit('keydown', { key: 'Escape', preventDefault: vi.fn() })
    h.realController.reportStatus('Updated status')
    h.realController.setAnimationSpeed('off')
    expect(h.content.querySelector('dialog')).toBeNull()
    expect(h.realController.getViewModel().game!.phase).toBe('plains_target')
    expect(h.controller.submitAction).toHaveBeenCalledTimes(1)
    h.click('[data-action="resume-target"]')
    const selected = h.content.querySelector('[data-target-id="grave-1"]')!
    selected.focus()
    h.realController.reportStatus('Another status')
    expect(h.content.querySelector('dialog')?.open).toBe(true)
    expect(h.document.activeElement?.dataset.targetId).toBe('grave-1')
    h.click('[data-target-id="grave-1"]')
    expect(h.content.querySelector('dialog')).toBeNull()
    expect(h.document.activeElement?.dataset.action).toBe('menu')
    h.dispose()
  })

  it('keeps the picker open and focused when submission is rejected without advancing the decision', () => {
    const h = setupPlainsForest()
    h.ui.playCard('plains-play')
    h.controller.submitAction.mockImplementationOnce(() => h.realController.reportStatus('Send failed. Try again.'))
    h.click('[data-target-id="grave-1"]')
    expect(h.realController.getViewModel().game!.phase).toBe('plains_target')
    expect(h.content.querySelector('[data-modal="target"]')?.open).toBe(true)
    expect(h.document.activeElement?.dataset.targetId).toBe('grave-1')
    expect(h.ui.isBlocked()).toBe(true)
    h.click('[data-target-id="grave-1"]')
    expect(h.realController.getViewModel().game!.phase).toBe('main')
    h.dispose()
  })

  it('retains the initial Plains selection after rejection, then opens the Forest picker on retry', () => {
    const h = setupPlainsForest({ multipleSources: true })
    h.ui.playCard('plains-play')
    h.controller.submitAction.mockImplementationOnce(() => h.realController.reportStatus('Send failed. Try again.'))
    h.click('[data-target-id="self-forest"]')
    expect(h.realController.getViewModel().game!.phase).toBe('main')
    expect([...h.ui.targetIds]).toEqual(['self-forest', 'self-island'])
    expect(h.document.activeElement?.dataset.targetId).toBe('self-forest')
    h.click('[data-target-id="self-forest"]')
    expect(h.content.querySelector('[data-modal="target"]')?.open).toBe(true)
    expect(h.realController.getViewModel().game!.phase).toBe('plains_target')
    h.dispose()
  })

  it('ignores stale battlefield hits and blocks unrelated plays during the popup', () => {
    const h = setupPlainsForest({ multipleSources: true })
    const oldPrimary = h.ui.primaryAction!
    h.ui.playCard('plains-play')
    h.ui.activate(h.forestHit)
    h.ui.activate(h.forestHit)
    h.ui.playCard('plains-play')
    h.ui.activatePrimaryAction(oldPrimary)
    expect(h.controller.submitAction).toHaveBeenCalledTimes(1)
    expect(h.content.querySelector('[data-modal="target"]')?.open).toBe(true)
    expect(h.content.querySelector('[data-modal="preview"]')).toBeNull()
    h.dispose()
  })

  it.each(['replay', 'AI', 'unavailable', 'presentation'] as const)('does not expose choices during %s', (reason) => {
    const h = setupPlainsForest()
    h.ui.playCard('plains-play')
    const view = h.realController.getViewModel()
    if (reason === 'replay') view.replay.active = true
    if (reason === 'AI') {
      view.controllers[0] = 'ai'
      view.game!.actorControl = 'ai'
    }
    if (reason === 'AI' || reason === 'unavailable') view.game!.canInput = false
    const ui = { ...defaultUi, presentedActor: reason === 'presentation' ? 1 : 0 }
    expect(threeTargets(view, ui)).toBeNull()
    expect(renderThreeInterface(view, ui)).not.toContain('data-modal="target"')
    h.dispose()
  })
})

describe('Three native interface behavior', () => {
  it('submits a sole legal action exactly once across duplicate native/board calls', () => {
    const view = makeView()
    view.game!.legal.playLandByCard.source = [view.game!.legal.playLandByCard.source[0]]
    const h = setup(view)
    h.controller.submitAction.mockImplementation(() => h.latest({
      ...view,
      game: { ...view.game!, canInput: false },
    }))
    h.openCards()
    const native = h.content.querySelector('[data-action="play"]')!
    h.ui.playCard('source')
    h.ui.playCard('source')
    h.host.emit('click', { target: native })
    expect(h.controller.submitAction).toHaveBeenCalledExactlyOnceWith(view.game!.legal.playLandByCard.source[0].action)
    h.ui.dispose()
  })

  it('allows retry when a synchronous submission rejection leaves the decision unchanged', () => {
    const view = makeView()
    const h = setup(view)
    h.controller.submitAction.mockImplementation(() => h.latest({ ...view, status: 'Send failed. Try again.' }))
    h.ui.activatePrimaryAction(h.ui.primaryAction!)
    h.ui.activatePrimaryAction(h.ui.primaryAction!)
    expect(h.controller.submitAction).toHaveBeenCalledTimes(2)
    h.ui.dispose()
  })

  it('blocks drags, exposes Mountain rings, selects the exact legal target and submits once', () => {
    const h = setup()
    h.controller.submitAction.mockImplementation(() => h.latest({
      ...makeView(), game: { ...makeView().game!, canInput: false },
    }))
    h.ui.playCard('source')
    expect(h.onBlock).toHaveBeenCalledTimes(1)
    expect(h.ui.isBlocked()).toBe(true)
    expect([...h.ui.targetIds]).toEqual(['target-1', 'target-2'])
    h.ui.playCard('source')
    h.ui.activate(hit())
    h.ui.activate(hit())
    expect(h.controller.submitAction).toHaveBeenCalledExactlyOnceWith({ type: 'play_land', actor: 0, cardId: 'source', effectTargetId: 'target-1' })
    expect(h.ui.targetIds.size).toBe(0)
    h.ui.dispose()
  })

  it('requires canInput and matching presented actor for all submissions', () => {
    const view = makeView()
    const h = setup(view)
    h.update(view, 1)
    h.ui.playCard('source')
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    expect(h.ui.targetIds.size).toBe(0)
    view.game!.canInput = false
    h.update(view)
    h.ui.playCard('source')
    expect(h.ui.isBlocked()).toBe(false)
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    h.ui.dispose()
  })

  it('preserves a pending decision on status/settings updates but invalidates phase, replay and seed changes', () => {
    const view = makeView()
    const h = setup(view)
    h.ui.playCard('source')
    h.update({ ...view, status: 'Storage unavailable', animationSpeed: 'off' })
    expect(h.ui.targetIds.size).toBe(2)
    h.update({ ...view, seed: 43 })
    expect(h.ui.targetIds.size).toBe(0)
    h.ui.playCard('source')
    const replay = { ...view, replay: { ...view.replay, active: true } }
    h.update(replay)
    expect(h.ui.isBlocked()).toBe(false)
    h.ui.playCard('source')
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    h.ui.dispose()
  })

  it('revalidates against the latest controller view before applying stale hits/buttons', () => {
    const view = makeView()
    const h = setup(view)
    h.ui.playCard('source')
    const next = makeView()
    next.game!.phase = 'respond'
    h.latest(next)
    h.ui.activate(hit())
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    expect(h.ui.targetIds.size).toBe(0)
    expect(h.content.innerHTML).not.toContain('three-target-panel')
    h.ui.dispose()
  })

  it('automatically opens single Swamp target dialog without auto-submitting, and can close/reopen it', () => {
    const view = makeView()
    view.game!.phase = 'swamp_target'
    view.game!.legal.swampDiscardOptions = [{ action: { type: 'resolve_swamp_discard', actor: 0, effectTargetId: 'discard' }, label: 'Discard' }]
    const h = setup(view)
    expect(h.content.querySelector('dialog')?.open).toBe(true)
    expect(h.ui.isBlocked()).toBe(true)
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    h.click('[data-action="close"]')
    expect(h.ui.isBlocked()).toBe(false)
    h.click('[data-action="resume-target"]')
    h.click('[data-action="target"]')
    expect(h.controller.submitAction).toHaveBeenCalledExactlyOnceWith(view.game!.legal.swampDiscardOptions[0].action)
    h.ui.dispose()
  })

  it('allows an explicit single Plains battlefield target while blocking new plays', () => {
    const view = makeView()
    view.game!.phase = 'plains_target'
    view.game!.pendingPlainsReuseName = 'Mountain'
    view.game!.legal.plainsReuseOptions = [{ action: { type: 'resolve_plains_reuse', actor: 0, effectTargetId: 'target-1' }, label: 'Destroy Forest' }]
    const h = setup(view)
    expect([...h.ui.targetIds]).toEqual(['target-1'])
    h.ui.playCard('source')
    h.ui.activate(hit())
    expect(h.controller.submitAction).toHaveBeenCalledExactlyOnceWith(view.game!.legal.plainsReuseOptions[0].action)
    h.ui.dispose()
  })

  it('previews only current public card data, ignoring hit names and stale/hidden ids', () => {
    const view = makeView()
    view.game!.players[1].handCards = [{ id: 'secret', name: HIDDEN_HAND_CARD_NAME }]
    const h = setup(view)
    h.ui.activate(hit({ zone: 'hand', cardId: 'secret', name: 'Private name' }))
    expect(h.ui.isBlocked()).toBe(false)
    h.ui.activate(hit({ instanceId: 'missing' }))
    expect(h.ui.isBlocked()).toBe(false)
    h.ui.activate(hit({ name: '<script>wrong</script>' }))
    expect(h.ui.isBlocked()).toBe(true)
    expect(h.content.innerHTML).toContain('Gravebloom Dryad card preview')
    expect(h.content.innerHTML).not.toContain('wrong')
    h.ui.playCard('source')
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    h.ui.dispose()
  })

  describe.each(CARD_VISUAL_STYLES)('%s preview artwork', (style) => {
    it.each(BASIC_LANDS)('renders the %s image and name inside the dialog', (name) => {
      const view = makeView()
      view.cardVisualStyle = style
      view.game!.players[1].battlefield[0].name = name
      const h = setup(view)
      h.ui.activate(hit())
      const dialog = h.content.querySelector('[data-modal="preview"]')!
      expect(dialog.open).toBe(true)
      expect(dialog.getAttribute('aria-label')).toBe(`${displayCardName(name)} card preview`)
      expect(dialog.querySelector('.three-card__name')).not.toBeNull()
      expect(h.content.innerHTML).toContain(displayCardName(name))
      expect(h.content.innerHTML).toContain(`data-card-art="${cardAssetSlug(name)}"`)
      const image = dialog.querySelector('.three-card__art-frame')!.querySelector('img')!
      if (isRasterCardVisualStyle(style)) {
        expect(image.getAttribute('src')).toBe(cardArtUrl(name, style))
        // The tree stub does not parse '>' inside quoted arrow-function handlers.
        const previewMarkup = h.content.innerHTML.match(/<dialog[\s\S]*?<\/dialog>/)?.[0]
        expect(previewMarkup).toMatch(/onerror="[^"]*data:image\/svg\+xml/)
      } else {
        expect(image.getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
      }
      expect(h.controller.submitAction).not.toHaveBeenCalled()
      h.ui.dispose()
    })
  })

  it('retains Anime fallbacks through preview rerenders and reopening', () => {
    const view = makeView()
    view.cardVisualStyle = 'anime'
    const h = setup(view)
    h.ui.activate(hit())
    const primary = cardArtUrl('Forest', 'anime')
    const fallback = cardArtFallbackUrl('Forest', 'anime')
    noteRasterCardArtLoadFailure(primary)
    h.update({ ...view, status: 'Updated while previewing' })
    let dialog = h.content.querySelector('[data-modal="preview"]')!
    if (fallback) {
      expect(dialog.querySelector('img')?.getAttribute('src')).toBe(fallback)
      expect(dialog.querySelector('.card-tile--raster')).not.toBeNull()
      noteRasterCardArtLoadFailure(fallback)
      h.update({ ...view, status: 'Fallback unavailable' })
    }
    dialog = h.content.querySelector('[data-modal="preview"]')!
    expect(dialog.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
    expect(dialog.querySelector('.card-tile--raster')).toBeNull()
    h.click('[data-action="close"]')
    h.ui.activate(hit())
    expect(h.content.querySelector('dialog')?.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    h.ui.dispose()
  })

  it('retries failed native raster art after online recovery and removes the listener on disposal', () => {
    const view = makeView()
    view.cardVisualStyle = 'anime'
    const primary = cardArtUrl('Forest', 'anime')
    const fallback = cardArtFallbackUrl('Forest', 'anime')!
    const h = setup(view)
    h.ui.activate(hit())
    const image = h.content.querySelector('[data-modal="preview"]')?.querySelector('img')
    expect(image?.getAttribute('src')).toBe(primary)
    noteRasterCardArtLoadFailure(primary)
    noteRasterCardArtLoadFailure(fallback)
    image?.setAttribute('src', 'data:image/svg+xml,fallback')
    const builds = h.content.builds

    window.dispatchEvent(new Event('online'))
    expect(h.content.querySelector('[data-modal="preview"]')?.querySelector('img')?.getAttribute('src')).toBe(primary)
    expect(h.content.builds).toBe(builds + 1)

    h.ui.dispose()
    noteRasterCardArtLoadFailure(primary)
    noteRasterCardArtLoadFailure(fallback)
    window.dispatchEvent(new Event('online'))
    expect(renderThreeInterface(view, defaultUi)).not.toContain(primary)
  })

  it('retries failed hovered raster art after online recovery', () => {
    const view = makeView()
    view.cardVisualStyle = 'anime'
    const primary = cardArtUrl('Forest', 'anime')
    const fallback = cardArtFallbackUrl('Forest', 'anime')!
    const h = setup(view)
    h.ui.setHover(hit())
    const hoverContent = h.host.children[2]
    const image = hoverContent.querySelector('img')
    expect(image?.getAttribute('src')).toBe(primary)
    noteRasterCardArtLoadFailure(primary)
    noteRasterCardArtLoadFailure(fallback)
    image?.setAttribute('src', 'data:image/svg+xml,fallback')
    const builds = hoverContent.builds

    window.dispatchEvent(new Event('online'))
    expect(hoverContent.querySelector('img')?.getAttribute('src')).toBe(primary)
    expect(hoverContent.builds).toBe(builds + 1)
    h.ui.dispose()
  })

  it.each(['button', 'Escape'])('closes previews with %s, restoring focus without playing a card', (method) => {
    const h = setup()
    h.openCards()
    const selector = '[data-action="preview"][data-zone="hand"][data-card-id="source"]'
    h.click(selector)
    const close = h.content.querySelector('[data-action="close"]')!
    expect(h.document.activeElement).toBe(close)
    for (const shiftKey of [false, true]) {
      const preventDefault = vi.fn()
      h.document.emit('keydown', { key: 'Tab', shiftKey, preventDefault })
      expect(preventDefault).toHaveBeenCalled()
      expect(h.document.activeElement).toBe(close)
    }
    if (method === 'button') h.click('[data-action="close"]')
    else h.document.emit('keydown', { key: 'Escape', preventDefault: vi.fn() })
    expect(h.content.querySelector('dialog')?.dataset.modal).toBe('cards')
    expect(h.document.activeElement).toBe(h.content.querySelector(selector))
    expect(h.ui.isBlocked()).toBe(true)
    h.click('[data-action="cards-back"]')
    h.click('[data-action="close"]')
    expect(h.ui.isBlocked()).toBe(false)
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    h.ui.dispose()
  })

  it('preserves a preview on status updates but dismisses it when its card leaves play', () => {
    const view = makeView()
    const h = setup(view)
    h.ui.activate(hit())
    h.update({ ...view, status: 'Updated status' })
    expect(h.content.querySelector('[data-modal="preview"]')).not.toBeNull()
    const next = makeView()
    next.game!.players[1].battlefield = next.game!.players[1].battlefield.slice(1)
    h.update(next)
    expect(h.content.querySelector('dialog')).toBeNull()
    expect(h.ui.isBlocked()).toBe(false)
    h.ui.activate(hit())
    expect(h.content.querySelector('dialog')).toBeNull()
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    h.ui.dispose()
  })

  it('focuses, traps and restores native modal focus and supports Escape', () => {
    const h = setup()
    h.click('[data-action="menu"]')
    const close = h.content.querySelector('[data-action="close"]')!
    expect(h.document.activeElement).toBe(close)
    const preventDefault = vi.fn()
    h.document.emit('keydown', { key: 'Tab', shiftKey: true, preventDefault })
    expect(preventDefault).toHaveBeenCalled()
    expect(h.document.activeElement).not.toBe(close)
    expect(h.document.activeElement?.closest('dialog')).not.toBeNull()
    h.document.emit('keydown', { key: 'Escape', preventDefault })
    expect(h.content.querySelector('dialog')).toBeNull()
    expect(h.document.activeElement?.dataset.action).toBe('menu')
    expect(h.ui.isBlocked()).toBe(false)
    h.ui.dispose()
  })

  it('cancels battlefield targeting on Escape and restores the play button', () => {
    const h = setup()
    h.openCards()
    h.click('[data-action="play"]')
    expect(h.document.activeElement?.dataset.action).toBe('target')
    h.document.emit('keydown', { key: 'Escape', preventDefault: vi.fn() })
    expect(h.ui.targetIds.size).toBe(0)
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    expect(h.document.activeElement?.dataset.action).toBe('play')
    expect(h.content.querySelector('[data-modal="cards"]')?.open).toBe(true)
    h.ui.dispose()
  })

  it('does not rebuild unchanged markup or recursively notify during update/reset', () => {
    const view = makeView()
    const h = setup(view)
    const builds = h.content.builds
    h.update({ ...view })
    expect(h.content.builds).toBe(builds)
    expect(h.onChange).not.toHaveBeenCalled()
    h.ui.reset()
    expect(h.onChange).not.toHaveBeenCalled()
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    h.ui.dispose()
    h.ui.dispose()
    expect(h.host.children).toHaveLength(0)
    expect(h.host.listeners.size).toBe(0)
    expect(h.document.listeners.size).toBe(0)
  })

  it('retains P2P drafts, caret and scroll across connection/status rerenders and submits drafts', () => {
    const view = makeView()
    view.game = null
    view.mode = 'p2p-host'
    const h = setup(view)
    const input = h.content.querySelector('#answer-text')!
    input.value = 'draft <answer>'
    input.setSelectionRange(3, 8)
    input.scrollTop = 27
    input.focus()
    h.host.emit('input', { target: input })
    h.update({ ...view, status: 'Connecting' })
    const restored = h.content.querySelector('#answer-text')!
    expect(restored.value).toBe('draft <answer>')
    expect(restored.selectionStart).toBe(3)
    expect(restored.selectionEnd).toBe(8)
    expect(restored.scrollTop).toBe(27)
    expect(h.document.activeElement).toBe(restored)
    h.click('#accept-answer')
    expect(h.controller.acceptAnswer).toHaveBeenCalledExactlyOnceWith('draft <answer>')
    h.ui.dispose()
  })

  it('dispatches validated modes and all five guarded settings', () => {
    const h = setup({ ...makeView(), game: null })
    h.click('[data-action="lobby-settings"]')
    const expected = [
      ['ai-level-select', 'hard', h.controller.setAiLevel],
      ['card-visual-style-select', 'anime', h.controller.setCardVisualStyle],
      ['animation-speed-select', 'off', h.controller.setAnimationSpeed],
      ['board-theme-select', 'moonlit', h.controller.setBoardTheme],
      ['render-quality-select', 'low', h.controller.setRenderQualityPreference],
    ] as const
    for (const [id, value, spy] of expected) {
      const select = h.content.querySelector(`#${id}`)!
      select.value = 'invalid'
      h.host.emit('change', { target: select })
      expect(spy).not.toHaveBeenCalled()
      select.value = value
      h.host.emit('change', { target: select })
      expect(spy).toHaveBeenCalledExactlyOnceWith(value)
    }
    const monochrome = h.content.querySelector('#monochrome-cards-checkbox')!
    monochrome.checked = true
    h.host.emit('change', { target: monochrome })
    expect(h.controller.setMonochromeCards).toHaveBeenCalledExactlyOnceWith(true)
    h.click('[data-action="lobby-root"]')
    h.click('[data-mode="adventure-hvai"]')
    expect(h.controller.startAdventure).toHaveBeenCalledTimes(1)
    h.click('[data-mode="tutorial"]')
    expect(h.controller.startGame).toHaveBeenCalledExactlyOnceWith('tutorial')
    h.ui.dispose()
  })

  it('uses hand response actions without duplicate board/native/pass submissions', () => {
    const view = responseView()
    const h = setup(view)
    const pass = h.ui.primaryAction!
    h.controller.submitAction.mockImplementation(() => h.latest({
      ...view,
      game: { ...view.game!, canInput: false },
    }))
    h.openCards()
    h.click('[data-action="respond-card"]')
    h.ui.activatePrimaryAction(pass)
    h.ui.activate(responseHit())
    expect(h.controller.submitAction).toHaveBeenCalledExactlyOnceWith(view.game!.legal.counterOptions[0].action)
    h.ui.dispose()
  })

  it('loads a recording file once and ignores its completion after disposal', async () => {
    const h = setup()
    const fileInput = h.host.children[1]
    fileInput.files = [{ text: async () => '{"recording":1}' }]
    await fileInput.emit('change')
    expect(h.controller.importRecordingJson).toHaveBeenCalledExactlyOnceWith('{"recording":1}')
    let resolve: (value: string) => void = () => {}
    fileInput.files = [{ text: () => new Promise<string>((done) => { resolve = done }) }]
    const pending = fileInput.emit('change')
    h.ui.dispose()
    resolve('ignored')
    await pending
    expect(h.controller.importRecordingJson).toHaveBeenCalledTimes(1)
  })

  describe('Three Island hand responses', () => {
    it('keeps the board response non-modal and exposes distinct native choices in the Cards dialog', () => {
      const view = responseView()
      view.game!.players[0].handCards = view.game!.players[0].handCards.map((card) =>
        card.id === 'required-island'
          ? { ...card, serializedKey: 'Island', displayName: 'Localized Signal Siren' }
          : card)
      const h = setup(view)
      expect(h.ui.isBlocked()).toBe(false)
      expect(h.content.querySelector('dialog')).toBeNull()
      expect(h.content.querySelector('[data-action="counter_land"]')).toBeNull()
      expect(h.ui.primaryAction?.prompt).toContain(
        'The blue frame marks Localized Signal Siren, which is included automatically',
      )
      h.openCards()
      expect(h.ui.isBlocked()).toBe(true)
      expect(h.content.querySelector('dialog')?.dataset.modal).toBe('cards')
      expect(h.content.querySelectorAll('[data-action="respond-card"]')).toHaveLength(3)
      expect(h.content.innerHTML).toContain(
        'Localized Signal Siren is included automatically; choose the other card to discard.',
      )
      expect(h.content.innerHTML).not.toContain('aria-live')
      expect(h.host.querySelector(`#${THREE_STATUS_ANNOUNCER_ID}`)?.getAttribute('aria-live')).toBe('polite')
      expect(h.ui.response?.requiredIslandId).toBe('required-island')
      expect(h.ui.targetIds.size).toBe(0)
      expect(h.controller.submitAction).not.toHaveBeenCalled()
      h.ui.dispose()
    })

    it.each([0, 1])('selects the exact same-name card from player %s hand', (owner) => {
      const view = responseView(owner)
      const h = setup(view)
      h.ui.activate(responseHit('discard-forest-2', owner))
      expect(h.controller.submitAction).toHaveBeenCalledExactlyOnceWith(view.game!.legal.counterOptions[1].action)
      expect(h.content.querySelector('dialog')).toBeNull()
      h.ui.dispose()
    })

    it('accepts another Island through its native hand control and keeps unrelated focus stable', () => {
      const view = responseView()
      const h = setup(view)
      h.openCards()
      const selector = '[data-action="respond-card"][data-card-id="discard-island"]'
      h.content.querySelector(selector)!.focus()
      h.update({ ...view, status: 'Saved', animationSpeed: 'off' })
      expect(h.document.activeElement).toBe(h.content.querySelector(selector))
      h.click(selector)
      expect(h.controller.submitAction).toHaveBeenCalledExactlyOnceWith(view.game!.legal.counterOptions[2].action)
      h.ui.dispose()
    })

    it('does not counter or preview required, missing, hidden or ineligible responder cards', () => {
      const view = responseView()
      view.game!.players[0].handCards = [
        ...view.game!.players[0].handCards,
        { id: 'hidden', name: HIDDEN_HAND_CARD_NAME },
        { id: 'ineligible', name: 'Mountain' },
      ]
      view.game!.legal.counterOptions.push({
        action: { type: 'counter_land', actor: 0, discardCardId: 'hidden' }, label: 'Hidden',
      })
      const h = setup(view)
      for (const id of ['required-island', 'missing', 'hidden', 'ineligible']) h.ui.activate(responseHit(id))
      expect(h.controller.submitAction).not.toHaveBeenCalled()
      expect(h.content.querySelector('dialog')).toBeNull()
      expect(h.ui.response?.choices.some((choice) => choice.cardId === 'hidden')).toBe(false)
      h.ui.dispose()
    })

    it('never turns an explicit preview into a counter or target action', () => {
      const view = responseView()
      const h = setup(view)
      h.openCards()
      const button = h.content.querySelector('[data-action="respond-card"]')!
      button.dataset.action = 'preview'
      button.dataset.zone = 'hand'
      h.host.emit('click', { target: button })
      expect(h.controller.submitAction).not.toHaveBeenCalled()
      expect(h.content.querySelector('dialog')?.dataset.modal).toBe('cards')
      h.ui.activate(responseHit('discard-forest-1', 1))
      expect(h.controller.submitAction).not.toHaveBeenCalled()
      h.ui.dispose()
    })

    it('passes explicitly and permits retry when a response is rejected', () => {
      const view = responseView()
      const h = setup(view)
      h.controller.submitAction.mockImplementation(() => h.latest({ ...view, status: 'Send failed. Try again.' }))
      h.ui.activate(responseHit())
      h.openCards()
      h.click('[data-action="respond-card"]')
      expect(h.controller.submitAction).toHaveBeenCalledTimes(2)
      h.click('[data-action="cards-back"]')
      h.click('[data-action="close"]')
      h.ui.activatePrimaryAction(h.ui.primaryAction!)
      expect(h.controller.submitAction).toHaveBeenLastCalledWith({ type: 'pass_response', actor: 0 })
      h.ui.dispose()
    })

    it('clears and restores highlights around menus and previews without blocking the response itself', () => {
      const h = setup(responseView())
      h.click('[data-action="menu"]')
      expect(h.ui.response).toBeNull()
      h.ui.activate(responseHit())
      expect(h.controller.submitAction).not.toHaveBeenCalled()
      h.click('[data-action="close"]')
      expect(h.ui.response?.choices).toHaveLength(3)
      h.openCards()
      h.click('[data-action="preview"][data-zone="battlefield"]')
      expect(h.ui.response).toBeNull()
      h.ui.activate(responseHit())
      expect(h.controller.submitAction).not.toHaveBeenCalled()
      h.click('[data-action="close"]')
      expect(h.content.querySelector('[data-modal="cards"]')?.open).toBe(true)
      expect(h.ui.response?.choices).toHaveLength(3)
      h.click('[data-action="cards-back"]')
      h.click('[data-action="close"]')
      expect(h.ui.isBlocked()).toBe(false)
      h.ui.dispose()
    })

    it.each([
      ['replay', (view: AppViewModel) => { view.replay.active = true }],
      ['game replay', (view: AppViewModel) => { view.game!.isReplay = true }],
      ['no input', (view: AppViewModel) => { view.game!.canInput = false }],
      ['AI', (view: AppViewModel) => { view.game!.actorControl = 'ai'; view.controllers[0] = 'ai' }],
      ['remote', (view: AppViewModel) => { view.game!.actorControl = 'remote'; view.controllers[0] = 'remote' }],
      ['P2P lobby', (view: AppViewModel) => { view.mode = 'p2p-host' }],
    ] as const)('does not offer or submit responses for %s', (_label, prepare) => {
      const view = responseView()
      prepare(view)
      const h = setup(view)
      expect(h.ui.response).toBeNull()
      expect(h.content.querySelector('[data-action="respond-card"]')).toBeNull()
      h.ui.activate(responseHit())
      expect(h.controller.submitAction).not.toHaveBeenCalled()
      h.ui.dispose()
    })

    it.each(['p2p-host', 'p2p-join'] as const)('accepts a local human response after the %s handshake', (mode) => {
      const view = responseView(1)
      view.mode = mode
      view.p2pStarted = true
      view.controllers = ['remote', 'human']
      const h = setup(view)
      h.ui.activate(responseHit('discard-island', 1))
      expect(h.controller.submitAction).toHaveBeenCalledExactlyOnceWith(view.game!.legal.counterOptions[2].action)
      h.ui.dispose()
    })

    it('waits for the presented actor and offers only Pass when no choices remain', () => {
      const view = responseView()
      const h = setup(view)
      h.update(view, 1)
      expect(h.ui.response).toBeNull()
      h.ui.activate(responseHit())
      expect(h.controller.submitAction).not.toHaveBeenCalled()
      view.game!.legal.counterOptions = []
      h.update(view)
      expect(h.ui.response?.choices).toEqual([])
      expect(h.ui.primaryAction?.prompt).toContain(
        'No legal card combination can intercept the summon of Memory Vampire. Choose Let It Through.',
      )
      expect(h.ui.primaryAction).toMatchObject({ type: 'pass_response', disabled: false })
      view.game!.legal.canPassResponse = false
      h.update(view)
      expect(h.ui.primaryAction?.disabled).toBe(true)
      h.ui.dispose()
    })

    it('rejects board and native choices when controller legality advances before the frame', () => {
      const view = responseView()
      const h = setup(view)
      h.openCards()
      const next = responseView()
      next.game!.legal.counterOptions = []
      h.latest(next)
      h.click('[data-action="respond-card"]')
      h.ui.activate(responseHit())
      expect(h.controller.submitAction).not.toHaveBeenCalled()
      expect(h.ui.response?.choices).toEqual([])
      h.ui.dispose()
    })

    it('requires an Island and ignores options for a different actor', () => {
      const view = responseView()
      view.game!.legal.counterOptions[0].action.actor = 1
      expect(threeResponse(view, defaultUi)?.choices).toHaveLength(2)
      view.game!.players[0].handCards = [{ id: 'discard-forest-1', name: 'Forest' }]
      expect(threeResponse(view, defaultUi)?.choices).toEqual([])
    })

    it.each(['replay', 'read-only', 'actor-transition'])('preserves hand previews during a %s response', (mode) => {
      const view = responseView()
      if (mode === 'replay') view.replay.active = true
      if (mode === 'read-only') view.game!.canInput = false
      const h = setup(view)
      if (mode === 'actor-transition') h.update(view, 1)
      h.ui.activate(responseHit())
      expect(h.content.innerHTML).toContain('Gravebloom Dryad card preview')
      h.click('[data-action="close"]')
      h.openCards()
      h.click('[data-action="preview"][data-zone="hand"][data-card-id="required-island"]')
      expect(h.content.innerHTML).toContain('Signal Siren card preview')
      expect(h.controller.submitAction).not.toHaveBeenCalled()
      h.ui.dispose()
    })
  })

  it('ignores stale recording read failures after a session reset', async () => {
    const h = setup()
    const input = h.host.children[1]
    let reject: (reason: Error) => void = () => {}
    input.files = [{ text: () => new Promise<string>((_, fail) => { reject = fail }) }]
    const pending = input.emit('change')
    h.ui.reset()
    input.value = 'new-selection'
    reject(new Error('stale failure'))
    await pending
    expect(h.controller.reportStatus).not.toHaveBeenCalled()
    expect(input.value).toBe('new-selection')
    h.ui.dispose()
  })

  it('reports file failures and revokes download URLs on disposal', async () => {
    const h = setup()
    const input = h.host.children[1]
    input.files = [{ text: async () => { throw new Error('bad file') } }]
    await input.emit('change')
    expect(h.controller.reportStatus).toHaveBeenCalledWith('Failed to read or import recording file.')
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:three-test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    h.click('[data-action="menu"]')
    h.click('[data-action="save-recording-download"]')
    expect(create).toHaveBeenCalledTimes(1)
    h.ui.dispose()
    h.ui.dispose()
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:three-test')
  })
})

describe('Three narrow profile', () => {
  type Harness = ReturnType<typeof setup>
  const mountainHand: BoardHit = { key: 'source', cardId: 'source', owner: 0, zone: 'hand', name: 'Mountain', playable: true }
  const escape = (h: Harness): void => { h.document.emit('keydown', { key: 'Escape', preventDefault: vi.fn() }) }
  const promptText = (h: Harness): string => (h.dockPrompt as unknown as { textContent?: string }).textContent ?? ''
  const dockActionNames = (h: Harness): string[] =>
    h.dockActions!.querySelectorAll('button').map((element) => element.dataset.action ?? '')
  const selectedCardActions = ['select-summon', 'select-details', 'select-clear']

  it('replaces the stacked HUD with a fixed top bar and an idle dock prompt', () => {
    const h = setup(makeView(), true, { enabled: true })
    const hud = h.hud!.innerHTML
    expect(hud).toContain('data-layout="narrow"')
    expect(hud).toContain('Turn 1 · Action phase')
    expect(hud).not.toContain('three-required-prompt')
    expect(h.hud!.querySelector('[data-action="menu"]')?.getAttribute('aria-label')).toBe('Menu')
    expect(h.dockPrompt!.id).toBe(THREE_DOCK_PROMPT_ID)
    expect(h.dockPrompt!.getAttribute('role')).toBe('status')
    expect(h.dockPrompt!.getAttribute('aria-live')).toBe('polite')
    expect(promptText(h)).toBe('Drag a highlighted creature onto your board, or select a card for options.')
    expect(dockActionNames(h)).toEqual([])
    expect(h.ui.selection).toBe(NO_BOARD_SELECTION)
    h.ui.dispose()
    expect(h.dock!.children).toHaveLength(0)
    expect(h.ui.selection).toBe(NO_BOARD_SELECTION)
  })

  it('selects a narrow hand card with any pointer and offers Summon, Details and Clear', () => {
    const h = setup(makeView(), true, { enabled: true })
    const name = displayCardName('Mountain')
    const ability = cardCatalogEntry('Mountain').primaryAbility
    h.ui.activate(mountainHand, 'mouse')
    expect(h.ui.selection).toEqual({ cardId: 'source', targetId: null, discardId: null })
    expect(promptText(h)).toBe(`${name} · ${ability.name}: ${ability.rulesText}`)
    expect(dockActionNames(h)).toEqual(selectedCardActions)
    expect(h.dockActions!.querySelector('[data-action="select-summon"]')?.getAttribute('aria-label')).toBe(`Summon ${name}`)
    expect(h.dockActions!.innerHTML).not.toContain('source')
    h.click('[data-action="select-details"]')
    expect(h.content.querySelector('dialog')?.dataset.modal).toBe('preview')
    escape(h)
    expect(h.content.querySelector('dialog')).toBeNull()
    expect(h.document.activeElement).toBe(h.dockActions!.querySelector('[data-action="select-details"]'))
    h.click('[data-action="select-summon"]')
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    expect(dockActionNames(h)).toEqual(['target-list', 'close'])
    expect(h.dockActions!.querySelector('[data-action="close"]')?.getAttribute('aria-label')).toBe('Cancel Target Selection')
    expect(h.content.querySelector('.three-target-panel')).toBeNull()
    expect(h.ui.selection.cardId).toBe('source')
    h.click('[data-action="close"]')
    expect(dockActionNames(h)).toEqual(selectedCardActions)
    expect(h.document.activeElement).toBe(h.dockActions!.querySelector('[data-action="select-summon"]'))
    h.click('[data-action="select-clear"]')
    expect(h.ui.selection).toBe(NO_BOARD_SELECTION)
    expect(dockActionNames(h)).toEqual([])
    h.ui.dispose()
  })

  it('confirms touch-selected battlefield targets from the dock while mouse taps submit at once', () => {
    const h = setup(makeView(), true, { enabled: true })
    const forest = displayCardName('Forest')
    h.ui.activate(mountainHand, 'touch')
    h.click('[data-action="select-summon"]')
    h.ui.activate(hit(), 'touch')
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    expect(h.ui.selection).toEqual({ cardId: 'source', targetId: 'target-1', discardId: null })
    expect(promptText(h)).toContain(`Selected: ${forest}.`)
    expect(h.dockActions!.querySelector('[data-action="confirm-target"]')?.getAttribute('aria-label')).toBe(`Confirm target: ${forest}`)
    h.ui.activate(hit(), 'pen')
    expect(h.ui.selection.targetId).toBeNull()
    expect(dockActionNames(h)).toEqual(['target-list', 'close'])
    h.ui.activate(hit({ key: 'target-2', cardId: 'card-2', instanceId: 'target-2', name: 'Island' }), 'touch')
    h.click('[data-action="confirm-target"]')
    expect(h.controller.submitAction).toHaveBeenCalledExactlyOnceWith({ type: 'play_land', actor: 0, cardId: 'source', effectTargetId: 'target-2' })
    h.ui.dispose()

    const mouse = setup(makeView(), true, { enabled: true })
    mouse.ui.activate(mountainHand, 'mouse')
    mouse.click('[data-action="select-summon"]')
    mouse.ui.activate(hit(), 'mouse')
    expect(mouse.controller.submitAction).toHaveBeenCalledExactlyOnceWith({ type: 'play_land', actor: 0, cardId: 'source', effectTargetId: 'target-1' })
    mouse.ui.dispose()
  })

  it('selects an Intercept discard on touch and confirms it from the dock', () => {
    const h = setup(responseView(), true, { enabled: true })
    const verb = cardCatalogEntry('Island').responseAbility!.name
    const required = displayCardName('Island')
    const forest = displayCardName('Forest')
    expect(promptText(h)).toBe(`${verb} the summon of Memory Vampire? Select a pink-framed card to discard with ${required}, or choose Let It Through.`)
    expect(dockActionNames(h)).toEqual([])
    h.ui.activate(responseHit('required-island'), 'touch')
    expect(h.ui.selection).toBe(NO_BOARD_SELECTION)
    h.ui.activate(responseHit('discard-forest-1'), 'touch')
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    expect(h.ui.selection).toEqual({ cardId: null, targetId: null, discardId: 'discard-forest-1' })
    expect(promptText(h)).toBe(`${verb} Memory Vampire by discarding ${required} and ${forest}?`)
    expect(dockActionNames(h)).toEqual(['confirm-response', 'select-clear'])
    expect(h.dockActions!.querySelector('[data-action="confirm-response"]')?.getAttribute('aria-label'))
      .toBe(`${verb}: discard ${required} and ${forest}`)
    escape(h)
    expect(h.ui.selection).toBe(NO_BOARD_SELECTION)
    h.ui.activate(responseHit('discard-forest-2'), 'touch')
    h.click('[data-action="confirm-response"]')
    expect(h.controller.submitAction).toHaveBeenCalledExactlyOnceWith({ type: 'counter_land', actor: 0, discardCardId: 'discard-forest-2' })
    h.controller.submitAction.mockClear()
    h.ui.activate(responseHit('discard-island'), 'mouse')
    expect(h.controller.submitAction).toHaveBeenCalledExactlyOnceWith({ type: 'counter_land', actor: 0, discardCardId: 'discard-island' })
    h.ui.dispose()
  })

  it('keeps immediate touch decisions and the stacked HUD outside the narrow profile', () => {
    const h = setup(responseView(), true, { enabled: false })
    expect(promptText(h)).toBe('')
    expect(dockActionNames(h)).toEqual([])
    expect(h.hud!.innerHTML).not.toContain('data-layout="narrow"')
    h.ui.activate(responseHit(), 'touch')
    expect(h.controller.submitAction).toHaveBeenCalledExactlyOnceWith({ type: 'counter_land', actor: 0, discardCardId: 'discard-forest-1' })
    expect(h.ui.selection).toBe(NO_BOARD_SELECTION)
    h.ui.dispose()
  })

  it.each(['target', 'response'] as const)('clears a narrow %s confirmation on a synchronous accepted update without submitting twice', (kind) => {
    const view = kind === 'target' ? makeView() : responseView()
    const h = setup(view, true, { enabled: true })
    if (kind === 'target') {
      h.ui.activate(mountainHand, 'touch')
      h.click('[data-action="select-summon"]')
      h.ui.activate(hit(), 'touch')
    } else h.ui.activate(responseHit(), 'touch')
    const action = kind === 'target'
      ? { type: 'play_land', actor: 0, cardId: 'source', effectTargetId: 'target-1' }
      : { type: 'counter_land', actor: 0, discardCardId: 'discard-forest-1' }
    const confirm = h.dockActions!.querySelector(`[data-action="confirm-${kind}"]`)!
    h.controller.submitAction.mockImplementation(() => {
      const next = structuredClone(view)
      next.game!.phase = kind === 'target' ? 'respond' : 'main'
      next.game!.canInput = false
      h.update(next)
      expect(h.ui.selection).toBe(NO_BOARD_SELECTION)
    })
    h.click(`[data-action="confirm-${kind}"]`)
    h.dockActions!.emit('click', { target: confirm })
    expect(h.controller.submitAction).toHaveBeenCalledExactlyOnceWith(action)
    expect(h.ui.selection).toBe(NO_BOARD_SELECTION)
    expect(dockActionNames(h)).toEqual([])
    expect(h.content.querySelector('.three-target-panel')).toBeNull()
    h.ui.dispose()
  })

  it.each(['target', 'response'] as const)('preserves a narrow %s selection on a synchronous status-only rejection and allows retry', (kind) => {
    const view = kind === 'target' ? makeView() : responseView()
    const h = setup(view, true, { enabled: true })
    if (kind === 'target') {
      h.ui.activate(mountainHand, 'touch')
      h.click('[data-action="select-summon"]')
      h.ui.activate(hit(), 'touch')
    } else h.ui.activate(responseHit(), 'touch')
    const selected = h.ui.selection
    const prompt = promptText(h)
    const actions = dockActionNames(h)
    h.controller.submitAction.mockImplementationOnce(() => h.update({ ...view, status: 'Send failed. Try again.' }))
    h.click(`[data-action="confirm-${kind}"]`)
    expect(h.ui.selection).toEqual(selected)
    expect(promptText(h)).toBe(prompt)
    expect(dockActionNames(h)).toEqual(actions)
    h.controller.submitAction.mockImplementationOnce(() => {
      const next = structuredClone(view)
      next.game!.canInput = false
      h.update(next)
    })
    h.click(`[data-action="confirm-${kind}"]`)
    expect(h.controller.submitAction).toHaveBeenCalledTimes(2)
    expect(h.controller.submitAction.mock.calls[1]).toEqual(h.controller.submitAction.mock.calls[0])
    expect(h.ui.selection).toBe(NO_BOARD_SELECTION)
    expect(dockActionNames(h)).toEqual([])
    h.ui.dispose()
  })

  it.each(['target', 'response', 'drag'] as const)('preserves the attempted %s, not an earlier selection, when a mixed-input submission is rejected', (kind) => {
    const view = kind === 'response' ? responseView() : makeView()
    if (kind === 'drag') {
      view.game!.players[0].handCards = [...view.game!.players[0].handCards, { id: 'other', name: 'Forest' }]
      view.game!.players[0].handCount = 2
      view.game!.legal.playLandByCard.other = [{ action: { type: 'play_land', actor: 0, cardId: 'other' }, label: 'Summon' }]
    }
    const h = setup(view, true, { enabled: true })
    if (kind === 'target') {
      h.ui.activate(mountainHand, 'touch')
      h.click('[data-action="select-summon"]')
      h.ui.activate(hit(), 'touch')
    } else if (kind === 'response') h.ui.activate(responseHit('discard-forest-1'), 'touch')
    else h.ui.activate(mountainHand, 'touch')
    h.controller.submitAction.mockImplementation(() => h.update({ ...view, status: 'Send failed. Try again.' }))
    if (kind === 'target') {
      h.ui.activate(hit({ key: 'target-2', cardId: 'card-2', instanceId: 'target-2', name: 'Island' }), 'mouse')
      expect(h.ui.selection).toEqual({ cardId: 'source', targetId: 'target-2', discardId: null })
      expect(promptText(h)).toContain(`Selected: ${displayCardName('Island')}.`)
    } else if (kind === 'response') {
      h.ui.activate(responseHit('discard-forest-2'), 'mouse')
      expect(h.ui.selection).toEqual({ cardId: null, targetId: null, discardId: 'discard-forest-2' })
    } else {
      h.ui.playCard('other')
      expect(h.ui.selection).toEqual({ cardId: 'other', targetId: null, discardId: null })
    }
    const attempted = h.controller.submitAction.mock.calls[0][0]
    h.click(`[data-action="${kind === 'target' ? 'confirm-target' : kind === 'response' ? 'confirm-response' : 'select-summon'}"]`)
    expect(h.controller.submitAction).toHaveBeenCalledTimes(2)
    expect(h.controller.submitAction.mock.calls[1][0]).toEqual(attempted)
    h.ui.dispose()
  })

  it('clears hidden hand and discard selections when the narrow hand pages, keeping battlefield targets', () => {
    const h = setup(makeView(), true, { enabled: true })
    const changes = h.onChange.mock.calls.length
    h.ui.clearHandSelection()
    expect(h.onChange).toHaveBeenCalledTimes(changes)
    h.ui.activate(mountainHand, 'touch')
    h.click('[data-action="select-summon"]')
    h.ui.activate(hit(), 'touch')
    expect(h.ui.selection).toEqual({ cardId: 'source', targetId: 'target-1', discardId: null })
    h.ui.clearHandSelection()
    expect(h.ui.selection).toEqual({ cardId: null, targetId: 'target-1', discardId: null })
    h.ui.dispose()

    const response = setup(responseView(), true, { enabled: true })
    response.ui.activate(responseHit(), 'touch')
    expect(dockActionNames(response)).toEqual(['confirm-response', 'select-clear'])
    const confirm = response.dockActions!.querySelector('[data-action="confirm-response"]')!
    response.ui.clearHandSelection()
    expect(response.ui.selection).toBe(NO_BOARD_SELECTION)
    expect(dockActionNames(response)).toEqual([])
    response.dockActions!.emit('click', { target: confirm })
    expect(response.controller.submitAction).not.toHaveBeenCalled()
    response.ui.dispose()
    response.ui.clearHandSelection()
  })

  it('clears narrow selections when the decision changes or the profile turns off', () => {
    const narrow = { enabled: true }
    const view = makeView()
    const h = setup(view, true, narrow)
    h.ui.activate(mountainHand, 'touch')
    h.update({ ...view, status: 'Saved' })
    expect(h.ui.selection.cardId).toBe('source')
    const next = structuredClone(view)
    next.game!.turn = 2
    h.update(next)
    expect(h.ui.selection).toBe(NO_BOARD_SELECTION)
    h.ui.activate(mountainHand, 'touch')
    expect(h.ui.selection.cardId).toBe('source')
    narrow.enabled = false
    h.update({ ...next, status: 'Unfolded' })
    expect(h.ui.selection).toBe(NO_BOARD_SELECTION)
    expect(dockActionNames(h)).toEqual([])
    expect(promptText(h)).toBe('')
    expect(h.hud!.innerHTML).not.toContain('data-layout="narrow"')
    narrow.enabled = true
    h.update({ ...next, status: 'Folded' })
    expect(h.ui.selection).toBe(NO_BOARD_SELECTION)
    expect(h.hud!.innerHTML).toContain('data-layout="narrow"')
    h.ui.dispose()
  })

  it('steps back through the target list, the selected target and target mode with Escape', () => {
    const h = setup(makeView(), true, { enabled: true })
    h.ui.activate(mountainHand, 'touch')
    h.click('[data-action="select-summon"]')
    h.ui.activate(hit(), 'touch')
    h.click('[data-action="target-list"]')
    expect(h.content.querySelector('.three-target-panel')).not.toBeNull()
    expect(h.content.querySelector('[data-action="target-list-hide"]')).not.toBeNull()
    expect(h.document.activeElement).toBe(h.content.querySelector('[data-action="target"]'))
    expect(h.dockActions!.querySelector('[data-action="target-list"]')?.getAttribute('aria-expanded')).toBe('true')
    escape(h)
    expect(h.content.querySelector('.three-target-panel')).toBeNull()
    expect(h.document.activeElement).toBe(h.dockActions!.querySelector('[data-action="target-list"]'))
    expect(h.dockActions!.querySelector('[data-action="target-list"]')?.getAttribute('aria-expanded')).toBe('false')
    expect(h.ui.selection.targetId).toBe('target-1')
    escape(h)
    expect(h.ui.selection).toEqual({ cardId: 'source', targetId: null, discardId: null })
    expect(dockActionNames(h)).toEqual(['target-list', 'close'])
    escape(h)
    expect(dockActionNames(h)).toEqual(selectedCardActions)
    escape(h)
    expect(h.ui.selection).toBe(NO_BOARD_SELECTION)
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    h.ui.dispose()
  })

  it('opens and hides the optional target list from the dock with focus handoff', () => {
    const h = setup(makeView(), true, { enabled: true })
    h.ui.activate(mountainHand, 'touch')
    h.click('[data-action="select-summon"]')
    h.click('[data-action="target-list"]')
    expect(h.document.activeElement).toBe(h.content.querySelector('[data-action="target"]'))
    h.click('[data-action="target-list-hide"]')
    expect(h.content.querySelector('.three-target-panel')).toBeNull()
    expect(h.document.activeElement).toBe(h.dockActions!.querySelector('[data-action="target-list"]'))
    h.click('[data-action="target-list"]')
    h.click('[data-action="target"][data-target-id="target-2"]')
    expect(h.controller.submitAction).toHaveBeenCalledExactlyOnceWith({ type: 'play_land', actor: 0, cardId: 'source', effectTargetId: 'target-2' })
    h.ui.dispose()
  })

  it('targets phase choices on the board and resumes a dismissed picker from the dock', () => {
    const view = makeView()
    view.game!.phase = 'plains_target'
    view.game!.pendingPlainsReuseName = 'Mountain'
    view.game!.legal.plainsReuseOptions = [{ action: { type: 'resolve_plains_reuse', actor: 0, effectTargetId: 'target-1' }, label: 'Destroy Forest' }]
    const h = setup(view, true, { enabled: true })
    const title = "Choose an opposing creature to send to its owner's discard pile."
    expect(h.content.querySelector('.three-target-panel')).toBeNull()
    expect(promptText(h)).toBe(`${title} Select a highlighted creature, or open Targets.`)
    expect(h.dockActions!.querySelector('[data-action="close"]')?.getAttribute('aria-label')).toBe('Close Target Selection')
    h.click('[data-action="close"]')
    expect(promptText(h)).toBe(title)
    expect(dockActionNames(h)).toEqual(['resume-target'])
    expect(h.content.innerHTML).not.toContain('resume-target')
    h.ui.activate(hit(), 'touch')
    expect(h.ui.selection.targetId).toBe('target-1')
    expect(dockActionNames(h)).toEqual(['confirm-target', 'target-list', 'close'])
    h.click('[data-action="confirm-target"]')
    expect(h.controller.submitAction).toHaveBeenCalledExactlyOnceWith({ type: 'resolve_plains_reuse', actor: 0, effectTargetId: 'target-1' })
    h.ui.dispose()
  })

  it('moves winner, replay transport and waiting prompts into the dock', () => {
    const over = makeView()
    over.game!.phase = 'gameOver'
    over.game!.winnerText = 'Player 1 wins!'
    over.game!.legal.canEndTurn = false
    const h = setup(over, true, { enabled: true })
    expect(promptText(h)).toBe('Player 1 wins!')
    expect(dockActionNames(h)).toEqual(['replay-start', 'rematch', 'back-to-lobby'])
    expect(h.dockActions!.querySelector('[data-action="back-to-lobby"]')?.getAttribute('aria-label')).toBe('Back to Lobby')
    expect(h.hud!.innerHTML).not.toContain('Player 1 wins!')
    h.click('[data-action="rematch"]')
    expect(h.controller.rematch).toHaveBeenCalledOnce()
    h.ui.dispose()

    const replay = makeView()
    replay.replay = { active: true, step: 0, totalSteps: 10, isPlaying: false }
    const r = setup(replay, true, { enabled: true })
    expect(promptText(r)).toBe('Replay · Step 0/10 · Paused')
    expect(dockActionNames(r)).toEqual(['replay-playpause', 'replay-prev', 'replay-next', 'replay-end', 'replay-exit'])
    expect(r.dockActions!.querySelector('[data-action="replay-playpause"]')?.getAttribute('aria-label')).toBe('Play Replay')
    expect(r.dockActions!.querySelector('[data-action="replay-prev"]')?.hasAttribute('disabled')).toBe(true)
    expect(r.hud!.innerHTML).not.toContain('replay-')
    r.click('[data-action="replay-next"]')
    expect(r.controller.stepReplay).toHaveBeenCalledExactlyOnceWith(1)
    r.ui.dispose()

    const waiting = makeView()
    waiting.game!.canInput = false
    const w = setup(waiting, true, { enabled: true })
    expect(promptText(w)).toBe('Waiting for the other player.')
    expect(w.hud!.innerHTML).not.toContain('Waiting for the other player.')
    w.ui.activate(mountainHand, 'touch')
    expect(w.ui.selection).toBe(NO_BOARD_SELECTION)
    w.ui.dispose()
  })

  it('shows the tutorial as a dismissible banner with a Hint button to restore it', () => {
    const view = makeView()
    view.mode = 'tutorial'
    view.tutorial = { active: true, stepId: 'first', hint: '<Summon a creature>' }
    const h = setup(view, true, { enabled: true })
    expect(h.content.querySelector('.three-tutorial-banner')?.getAttribute('aria-label')).toBe('Tutorial hint')
    expect(h.content.innerHTML).toContain('&lt;Summon a creature&gt;')
    expect(h.hud!.innerHTML).not.toContain('Summon a creature')
    h.click('[data-action="tutorial-dismiss"]')
    expect(h.content.querySelector('.three-tutorial-banner')).toBeNull()
    expect(h.document.activeElement).toBe(h.hud!.querySelector('[data-action="tutorial-show"]'))
    expect(h.hud!.querySelector('[data-action="tutorial-show"]')?.getAttribute('aria-label')).toBe('Show tutorial hint')
    h.update({ ...view, status: 'Saved' })
    expect(h.content.querySelector('.three-tutorial-banner')).toBeNull()
    h.click('[data-action="tutorial-show"]')
    expect(h.document.activeElement).toBe(h.content.querySelector('[data-action="tutorial-dismiss"]'))
    h.click('[data-action="tutorial-dismiss"]')
    h.update({ ...view, tutorial: { active: true, stepId: 'second', hint: 'Next step' } })
    expect(h.content.innerHTML).toContain('Next step')
    expect(h.hud!.querySelector('[data-action="tutorial-show"]')).toBeNull()
    h.ui.dispose()
  })

  it('moves adventure progress into the menu and keeps ids unique across hosts', () => {
    const view = makeView()
    view.mode = 'adventure-hvai'
    view.adventure = { ...view.adventure, status: 'active', stage: 'encounter', currentTier: 3, remainingChances: 2, winStreak: 1, highScore: 4 }
    const summary = 'Adventure Tier 3/7 · Chances 2 · Win streak 1 · High score 4'
    expect(renderThreeHud(view, defaultUi)).toContain(summary)
    const h = setup(view, true, { enabled: true })
    expect(h.hud!.innerHTML).not.toContain(summary)
    h.click('[data-action="menu"]')
    expect(h.content.innerHTML).toContain(summary)
    const ids = [h.hud!, h.host, h.dock!].flatMap((root) => root.querySelectorAll('[id]').map((element) => element.id))
    expect(ids).toContain(THREE_DOCK_PROMPT_ID)
    expect(ids).toContain(THREE_STATUS_ANNOUNCER_ID)
    expect(new Set(ids).size).toBe(ids.length)
    h.ui.dispose()
  })
})

function hubNode(tierIndex: number, lane: AdventureNodeLane, status: AdventureNodeStatus, label = `Tier ${tierIndex + 1} ${lane} foe`): AdventureNodeSummary {
  return {
    id: `tier-${tierIndex + 1}-${lane}`, tierIndex, lane, status, boss: tierIndex === 6,
    opponent: { id: `adventure-opponent-${tierIndex + 1}-${lane}`, label, kind: 'dual', lands: ['Forest', 'Swamp'] },
  }
}

// Seven tiers: tier 1 cleared, a fork at tier 2, then single nodes.
function hubTiers(fork: [AdventureNodeStatus, AdventureNodeStatus] = ['available', 'available'], leftLabel?: string,
  rest: AdventureNodeStatus = 'locked', first: AdventureNodeStatus = 'completed'): AdventureTierSummary[] {
  return Array.from({ length: 7 }, (_, tierIndex): AdventureTierSummary => tierIndex === 1
    ? { tierIndex, nodes: [hubNode(1, 'left', fork[0], leftLabel), hubNode(1, 'right', fork[1])] }
    : { tierIndex, nodes: [hubNode(tierIndex, 'center', tierIndex === 0 ? first : rest)] })
}

function hubView(adventure: Partial<AdventureUiState> = {}): AppViewModel {
  const view = makeView()
  return {
    ...view, mode: 'adventure-hvai', game: null, controllers: ['human', 'ai'], status: 'Choose your Tier 2 encounter.',
    recording: { canSave: true, canLoadLocal: true, hasLocalSave: false, metadata: null },
    adventure: {
      ...view.adventure, runId: 'run-1', baseSeed: 7, status: 'active', stage: 'map', currentTier: 2,
      winStreak: 1, totalRoundsPlayed: 1, tiers: hubTiers(), hasSavedRun: true, decisionKey: 'run-1|fork|0|',
      ...adventure,
    },
  }
}

function hubResult(result: Omit<AdventureResultSummary, 'chanceLossPrevented' | 'streakResetPrevented' | 'relicsUsed'>
  & Partial<AdventureResultSummary>): AdventureResultSummary {
  return { chanceLossPrevented: false, streakResetPrevented: false, relicsUsed: [], ...result }
}

// A tracked store that can refuse chosen keys; stubbed, so each test restores it.
function installHubStorage(): TrackedStorage {
  const { tracked, storage } = createTrackedStorage()
  vi.stubGlobal('localStorage', storage)
  return tracked
}

describe('Three Adventure hub', () => {
  it('renders the route as an ordered list where only playable nodes are buttons', () => {
    const html = renderThreeInterface(hubView(), defaultUi)
    expect(html).toContain('aria-label="Adventure map"')
    expect(html).toContain('<ol class="three-adventure-route">')
    expect(html.match(/<li class="three-adventure-tier"/g)).toHaveLength(7)
    expect(html.match(/aria-current="step"/g)).toHaveLength(1)
    expect(html).toContain('data-tier="2" data-tier-state="current" aria-current="step"')
    expect(html).toContain('data-tier="1" data-tier-state="cleared"')
    expect(html.match(/data-action="adventure-node"/g)).toHaveLength(2)
    expect(html).toContain('data-node-id="tier-2-left"')
    expect(html).toContain('data-node-id="tier-2-right"')
    expect(html).not.toContain('data-node-id="tier-1-center"')
    expect(html).not.toContain('data-node-id="tier-3-center"')
    expect(html).toContain('aria-label="Choose this path: Tier 2 of 7, left path, Tier 2 left foe. Status: Available."')
    // Status is spelled out next to its icon, never carried by color alone.
    for (const text of ['Left path · Available', 'Center path · Completed', 'Center path · Locked']) expect(html).toContain(text)
    expect(html).toContain('Tier 7 of 7 · Boss')
    expect(html).toContain('Next opponent: Choose Tier 2 left foe or Tier 2 right foe')
    for (const action of ['pause-adventure', 'abandon-adventure', 'lobby-settings', 'lobby-recording']) expect(html).toContain(`data-action="${action}"`)
    for (const action of ['rematch', 'replay-start', 'resume-adventure', 'start-new-adventure', 'adventure-retry-completion']) {
      expect(html).not.toContain(`data-action="${action}"`)
    }
    const recording = renderThreeInterface(hubView(), { ...defaultUi, lobbyPage: 'recording' })
    expect(recording).toContain('data-action="save-recording-download"')
    expect(recording).not.toContain('data-action="replay-start"')
    expect(recording).not.toContain('data-action="adventure-node"')
    for (const markup of [html, recording, renderThreeInterface(hubView(), { ...defaultUi, lobbyPage: 'settings' })]) {
      const ids = Array.from(markup.matchAll(/ id="([^"]*)"/g), (match) => match[1])
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('escapes opponent labels and status text', () => {
    const view = hubView({ tiers: hubTiers(['available', 'available'], '<img src=x onerror="alert(1)">') })
    view.status = '<b>status</b>'
    const html = renderThreeInterface(view, defaultUi)
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<b>status</b>')
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    expect(html).toContain('&lt;b&gt;status&lt;/b&gt;')
  })

  it('offers only the committed node after a fork choice and labels a retry', () => {
    const html = renderThreeInterface(hubView({
      attemptOrdinal: 1, remainingChances: 2, activeGameSeed: 99, tiers: hubTiers(['bypassed', 'current']),
      lastResult: hubResult({ outcome: 'loss', tierIndex: 1, opponentLabel: 'Tier 2 right foe', score: null }),
    }), defaultUi)
    expect(html.match(/data-action="adventure-node"/g)).toHaveLength(1)
    expect(html).toContain('aria-label="Retry encounter: Tier 2 of 7, right path, Tier 2 right foe. Status: Current."')
    expect(html).toContain('Left path · Bypassed')
    expect(html).toContain('Defeat at Tier 2')
    expect(html).toContain('2 chances left. Retry the same encounter.')
    expect(html).toContain('Next opponent: Tier 2 right foe')
  })

  it('describes each committed result on the map', () => {
    const result = (outcome: 'win' | 'loss' | 'draw', extra: Partial<AdventureUiState> = {}): string =>
      renderThreeInterface(hubView({ lastResult: hubResult({ outcome, tierIndex: 0, opponentLabel: 'First <foe>', score: null }), ...extra }), defaultUi)
    const win = result('win')
    expect(win).toContain('Victory at Tier 1')
    expect(win).toContain('Choose your Tier 2 encounter.')
    expect(win).toContain('Opponent: First &lt;foe&gt;')
    expect(result('draw', { currentTier: 1, tiers: hubTiers(['locked', 'locked'], undefined, 'locked', 'current') }))
      .toContain('No chance was used. Retry the same encounter.')
    expect(result('loss', { remainingChances: 1 })).toContain('1 chance left.')
    const kept = renderThreeInterface(hubView({
      remainingChances: 3,
      lastResult: hubResult({
        outcome: 'loss', tierIndex: 0, opponentLabel: 'First foe', score: null, chanceLossPrevented: true, streakResetPrevented: true,
        relicsUsed: [{ id: 'guardian-sigil', chargesLeft: 1 }, { id: 'streak-anchor', chargesLeft: 0 }],
      }),
    }), defaultUi)
    // Focus lands on the heading, which reads the detail as its description.
    expect(kept).toContain('<h2 tabindex="-1" data-adventure-result-heading aria-describedby="three-adventure-result-detail">Defeat at Tier 1</h2>')
    expect(kept).toContain('<p id="three-adventure-result-detail">Guardian Sigil used a charge to keep your chance (1 left). '
      + 'Streak Anchor used its last charge to keep your win streak. 3 chances left. Retry the same encounter.</p>')
  })

  it('ends a completed or failed run with a final score and new-run actions only', () => {
    const ended = (status: 'completed' | 'failed', outcome: 'win' | 'loss', tierIndex: number): string =>
      renderThreeInterface(hubView({
        status, stage: null, currentTier: tierIndex + 1, remainingChances: status === 'failed' ? 0 : 2, highScore: 9,
        tiers: hubTiers(['completed', 'bypassed'], undefined, status === 'completed' ? 'completed' : 'locked'),
        lastResult: hubResult({ outcome, tierIndex, opponentLabel: 'Boss', score: 9 }), decisionKey: `run-1|${status}|0|`,
      }), defaultUi)
    const completed = ended('completed', 'win', 6)
    expect(completed).toContain('Adventure complete: Tier 7 boss defeated')
    expect(completed).toContain('Final score 9 · High score 9')
    const failed = ended('failed', 'loss', 3)
    expect(failed).toContain('Adventure over: defeated at Tier 4')
    expect(failed).toContain('data-tier-state="failed"')
    for (const html of [completed, failed]) {
      expect(html).not.toContain('data-action="adventure-node"')
      expect(html).not.toContain('aria-current')
      expect(html).not.toContain('data-action="pause-adventure"')
      expect(html).not.toContain('data-action="abandon-adventure"')
      expect(html).toContain('data-action="start-new-adventure"')
      expect(html).toContain('data-action="back-to-lobby"')
    }
  })

  it('moves focus to the current tier on entry and to the result after a committed result', () => {
    const h = setup({ ...makeView(), mode: null, game: null })
    expect(h.content.querySelector('[data-adventure-current-tier]')).toBeNull()
    h.update(hubView())
    const tier = h.content.querySelector('[data-adventure-current-tier]')
    expect(tier?.tagName).toBe('H3')
    expect(h.document.activeElement).toBe(tier)
    // The same decision (for example a refused write) keeps the user's focus.
    h.content.querySelector('[data-node-id="tier-2-right"]')!.focus()
    h.update({ ...hubView(), status: 'Adventure progress could not be saved (storage unavailable).' })
    expect(h.document.activeElement?.dataset.nodeId).toBe('tier-2-right')
    h.update(hubView({
      attemptOrdinal: 1, remainingChances: 2, tiers: hubTiers(['bypassed', 'current']), decisionKey: 'run-1|right|1|',
      lastResult: hubResult({ outcome: 'loss', tierIndex: 1, opponentLabel: 'Tier 2 right foe', score: null }),
    }))
    const heading = h.content.querySelector('[data-adventure-result-heading]')!
    expect(h.document.activeElement).toBe(heading)
    // The focused heading is described by exactly one detail paragraph.
    expect(h.content.querySelectorAll(`#${heading.getAttribute('aria-describedby')}`).map((element) => element.tagName)).toEqual(['P'])
    h.ui.dispose()
  })

  it('starts only an offered node, once per decision', () => {
    const view = hubView()
    const h = setup(view)
    const left = h.content.querySelector('[data-node-id="tier-2-left"]')!
    // A node id the map does not offer is ignored before the controller.
    left.setAttribute('data-node-id', 'tier-3-center')
    h.host.emit('click', { target: left })
    expect(h.controller.startAdventureNode).not.toHaveBeenCalled()
    // Sub-pages never start encounters.
    h.click('[data-action="lobby-settings"]')
    expect(h.content.querySelector('[data-action="adventure-node"]')).toBeNull()
    h.click('[data-action="lobby-root"]')
    // A refused write keeps the same decision, so the choice can be retried.
    h.click('[data-node-id="tier-2-left"]')
    expect(h.controller.startAdventureNode).toHaveBeenCalledExactlyOnceWith('tier-2-left')
    const encounter = makeView()
    h.controller.startAdventureNode.mockImplementation(() => h.latest({
      ...encounter, mode: 'adventure-hvai', controllers: ['human', 'ai'],
      adventure: { ...view.adventure, stage: 'encounter', tiers: hubTiers(['bypassed', 'current']), decisionKey: 'run-1|right|0|' },
    }))
    const right = h.click('[data-node-id="tier-2-right"]')
    expect(h.controller.startAdventureNode).toHaveBeenCalledTimes(2)
    expect(h.controller.startAdventureNode).toHaveBeenLastCalledWith('tier-2-right')
    // A repeated activation before the next frame meets the newer decision,
    // which only refreshes the view.
    h.host.emit('click', { target: right })
    expect(h.controller.startAdventureNode).toHaveBeenCalledTimes(2)
    expect(h.content.querySelector('[data-action="adventure-node"]')).toBeNull()
    h.ui.dispose()
  })

  it('offers Retry Saving Result instead of Pause while a result waits to be saved', () => {
    const view = makeView()
    view.mode = 'adventure-hvai'
    view.controllers = ['human', 'ai']
    view.game = { ...view.game!, phase: 'gameOver', canInput: false, winnerText: 'Player 1 wins!' }
    view.adventure = { ...view.adventure, runId: 'run-1', status: 'active', stage: 'encounter', currentTier: 2, pendingCompletion: 'win', decisionKey: 'run-1|left|0|win' }
    const menu = renderThreeInterface(view, { ...defaultUi, menuOpen: true })
    expect(menu).toContain('data-action="adventure-retry-completion"')
    expect(menu).toContain('data-action="abandon-adventure"')
    expect(menu).not.toContain('data-action="pause-adventure"')
    expect(menu).not.toContain('data-action="rematch"')
    const hud = renderThreeHud(view, defaultUi)
    expect(hud).toContain('Retry Saving Result')
    // The wide panel is a fixed-height row that scrolls: the only decision
    // left shares the header row with Menu instead of falling below the fold.
    const header = hud.slice(hud.indexOf('<header'), hud.indexOf('</header>'))
    expect(header).toMatch(/data-action="menu"[\s\S]*data-action="adventure-retry-completion"[\s\S]*data-action="abandon-adventure"[\s\S]*<h2>/)
    expect(hud.match(/data-action="adventure-retry-completion"/g)).toHaveLength(1)
    expect(hud.match(/data-action="abandon-adventure"/g)).toHaveLength(1)
    expect(renderThreeHud({ ...view, adventure: { ...view.adventure, pendingCompletion: null } }, defaultUi))
      .not.toMatch(/adventure-retry-completion|abandon-adventure|pause-adventure/)
    expect(renderThreeHud(view, { ...defaultUi, menuOpen: true })).not.toContain('Retry Saving Result')
    const dock = renderThreeDock(view, { ...defaultUi, narrow: true })
    expect(dock.prompt).toBe('Player 1 wins! The result is not saved yet.')
    // The view model's own winner text has no closing punctuation.
    const winnerView = (winnerText: string): AppViewModel => ({ ...view, game: { ...view.game!, winnerText } })
    expect(renderThreeDock(winnerView('Winner: Player 1'), { ...defaultUi, narrow: true }).prompt)
      .toBe('Winner: Player 1. The result is not saved yet.')
    expect(renderThreeDock(winnerView('Draw game.'), { ...defaultUi, narrow: true }).prompt)
      .toBe('Draw game. The result is not saved yet.')
    expect(renderThreeDock(winnerView(''), { ...defaultUi, narrow: true }).prompt)
      .toBe('Game over. The result is not saved yet.')
    expect(renderThreeDock({ ...winnerView('Winner: Player 1'), adventure: { ...view.adventure, pendingCompletion: null } }, { ...defaultUi, narrow: true }).prompt)
      .toBe('Winner: Player 1')
    expect(dock.actions).toContain('aria-label="Retry Saving Result"')
    expect(dock.actions).not.toContain('rematch')
    // Both have no room for the full labels, which stay as accessible names.
    expect(dock.actions).toMatch(/>Retry<\/button>[\s\S]*>Reset<\/button>/)
    expect(header).toContain(dock.actions)
    expect(renderThreeDock({ ...view, adventure: { ...view.adventure, pendingCompletion: null } }, { ...defaultUi, narrow: true }).actions).toBe('')
    const h = setup(view)
    h.click('[data-action="adventure-retry-completion"]')
    expect(h.controller.retryAdventureCompletion).toHaveBeenCalledTimes(1)
    h.ui.dispose()
  })

  it('keeps the Game Menu and focus when a retry write is refused, and closes it once the result is saved', () => {
    const view = makeView()
    view.mode = 'adventure-hvai'
    view.controllers = ['human', 'ai']
    view.game = { ...view.game!, phase: 'gameOver', canInput: false, winnerText: 'Player 1 wins!' }
    view.adventure = { ...view.adventure, runId: 'run-1', status: 'active', stage: 'encounter', currentTier: 2, pendingCompletion: 'win', decisionKey: 'run-1|left|0|win' }
    const h = setup(view)
    const refused = { ...view, status: 'The encounter result could not be saved (storage unavailable). Retry saving the result.' }
    h.controller.retryAdventureCompletion.mockImplementation(() => h.update(refused))
    const menu = (): ElementStub | null => h.content.querySelector('[data-modal="menu"]')
    const retryFromMenu = (): void => {
      const retry = menu()?.querySelector('[data-action="adventure-retry-completion"]')
      if (!retry) throw new Error('Missing menu Retry Saving Result')
      retry.focus()
      h.host.emit('click', { target: retry })
    }
    h.click('[data-action="menu"]')
    retryFromMenu()
    expect(h.controller.retryAdventureCompletion).toHaveBeenCalledTimes(1)
    expect(menu()).not.toBeNull()
    expect(h.document.activeElement?.dataset.action).toBe('adventure-retry-completion')
    expect(menu()!.contains(h.document.activeElement!)).toBe(true)

    h.controller.retryAdventureCompletion.mockImplementation(() => h.update(hubView({
      attemptOrdinal: 0, tiers: hubTiers(['completed', 'bypassed']), decisionKey: 'run-1|tier-3|0|',
      lastResult: hubResult({ outcome: 'win', tierIndex: 1, opponentLabel: 'Tier 2 left foe', score: null }),
    })))
    retryFromMenu()
    expect(h.controller.retryAdventureCompletion).toHaveBeenCalledTimes(2)
    expect(menu()).toBeNull()
    expect(h.document.activeElement).toBe(h.content.querySelector('[data-adventure-result-heading]'))
    h.ui.dispose()
  })

  it.each([
    ['game snapshot', ADVENTURE_GAME_STORAGE_KEY],
    ['paused run', ADVENTURE_RUN_STORAGE_KEY],
  ] as const)('keeps the Game Menu and Pause focus when the %s write is refused', (_write, failedKey) => {
    withFakeTimers(() => {
      const entries = new Map<string, string>()
      let refusedKey: string | null = null
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (key === refusedKey) throw new Error('storage unavailable')
          entries.set(key, String(value))
        },
        removeItem: (key: string) => { entries.delete(key) },
        clear: () => { entries.clear() },
      })
      const real = new AppController()
      real.startAdventure()
      const node = actionableAdventureNodes(real.getViewModel().adventure)[0]
      if (!node) throw new Error('Missing Adventure node')
      real.startAdventureNode(node.id)
      const h = setup(real.getViewModel())
      h.controller.getViewModel.mockImplementation(() => real.getViewModel())
      h.controller.pauseAdventure.mockImplementation(() => real.pauseAdventure())
      const unsubscribe = real.subscribe((view) => h.update(view))

      h.click('[data-action="menu"]')
      refusedKey = failedKey
      h.click('[data-action="pause-adventure"]')

      const menu = h.content.querySelector('[data-modal="menu"]')
      expect(real.getViewModel().mode).toBe('adventure-hvai')
      expect(real.getViewModel().game).not.toBeNull()
      expect(menu).not.toBeNull()
      expect(h.document.activeElement?.dataset.action).toBe('pause-adventure')
      expect(menu!.contains(h.document.activeElement!)).toBe(true)

      unsubscribe()
      h.ui.dispose()
    })
  })

  it('runs a real Adventure from the lobby through a node, Pause and Resume', () => {
    withFakeTimers(() => {
      const storage = installHubStorage()
      const real = new AppController()
      const h = setup(real.getViewModel())
      h.controller.getViewModel.mockImplementation(() => real.getViewModel())
      h.controller.startAdventure.mockImplementation(() => real.startAdventure())
      h.controller.startAdventureNode.mockImplementation((nodeId) => real.startAdventureNode(nodeId))
      h.controller.pauseAdventure.mockImplementation(() => real.pauseAdventure())
      h.controller.resumeAdventure.mockImplementation(() => real.resumeAdventure())
      const unsubscribe = real.subscribe((next) => h.update(next))
      h.click('[data-mode="adventure-hvai"]')
      const hub = real.getViewModel()
      expect(hub.mode).toBe('adventure-hvai')
      expect(hub.game).toBeNull()
      expect(storage.data.has(ADVENTURE_RUN_STORAGE_KEY)).toBe(true)
      expect(h.content.querySelector('[aria-label="Adventure map"]')).not.toBeNull()
      expect(h.document.activeElement).toBe(h.content.querySelector('[data-adventure-current-tier]'))
      const offered = actionableAdventureNodes(hub.adventure)
      expect(offered.length).toBeGreaterThan(0)
      expect(h.content.querySelectorAll('[data-action="adventure-node"]').map((element) => element.dataset.nodeId))
        .toEqual(offered.map((node) => node.id))
      const chosen = h.click(`[data-node-id="${offered[0].id}"]`)
      expect(h.controller.startAdventureNode).toHaveBeenCalledExactlyOnceWith(offered[0].id)
      const encounter = real.getViewModel()
      expect(encounter.game).not.toBeNull()
      expect(encounter.adventure.stage).toBe('encounter')
      // The detached button of the previous frame cannot start a second game.
      h.host.emit('click', { target: chosen })
      expect(h.controller.startAdventureNode).toHaveBeenCalledTimes(1)
      h.click('[data-action="menu"]')
      h.click('[data-action="pause-adventure"]')
      expect(real.getViewModel().mode).toBeNull()
      h.click('[data-action="resume-adventure"]')
      const resumed = real.getViewModel()
      expect(resumed.game?.players).toEqual(encounter.game?.players)
      expect(resumed.adventure.activeGameSeed).toBe(encounter.adventure.activeGameSeed)
      unsubscribe()
      h.ui.dispose()
    })
  })
})

// A pending offer after Tier 1 with one reward of each kind.
function hubOffer(offerId = 'offer-1'): AdventureRewardOfferSummary {
  return {
    offerId, sourceTier: 1,
    choices: [
      { id: 'second-wind', name: 'Second Wind', rulesText: 'Gain one chance.', context: { kind: 'boon', picks: 1, maxPicks: 2 } },
      { id: 'guardian-sigil', name: 'Guardian Sigil', rulesText: 'Keep a chance.', context: { kind: 'charged-relic', charges: 1, maxCharges: 2 } },
      { id: 'prepared-pack', name: 'Prepared Pack', rulesText: 'Draw one extra opening card.', context: { kind: 'unique-relic' } },
    ],
  }
}

const HUB_RELICS: readonly AdventureRelicSummary[] = [
  { id: 'guardian-sigil', name: 'Guardian Sigil', rulesText: 'Keep a chance.', charges: 1, maxCharges: 2 },
  { id: 'rooftop-charm', name: 'Rooftop Charm', rulesText: 'Opening hands include a Rooftop creature.', charges: null, maxCharges: null },
]

// Tier 1 won, with its reward waiting before the Tier 2 fork.
function rewardView(adventure: Partial<AdventureUiState> = {}): AppViewModel {
  return hubView({
    stage: 'reward', pendingReward: hubOffer(), decisionKey: 'run-1|reward|0|-|offer-1',
    lastResult: hubResult({ outcome: 'win', tierIndex: 0, opponentLabel: 'Tier 1 center foe', score: null }),
    ...adventure,
  })
}

describe('Three Adventure rewards', () => {
  it('replaces the route with the reward panel until the reward is resolved', () => {
    const html = renderThreeInterface(rewardView(), defaultUi)
    expect(html).toContain('<section class="three-adventure-reward" aria-label="Reward">')
    expect(html).toContain('<h2 tabindex="-1" data-adventure-reward-heading>Choose a reward</h2>')
    expect(html).toContain('Tier 1 cleared. Choose one reward or skip it, then pick your next encounter.')
    expect(html).toContain('Victory at Tier 1')
    expect(html).toContain('Choose a reward or skip it to continue to Tier 2.')
    // The next tier is previewed, but nothing starts until the reward is resolved.
    expect(html).toContain('Next opponent: Choose Tier 2 left foe or Tier 2 right foe')
    expect(html).not.toContain('aria-label="Adventure route"')
    expect(html).not.toContain('data-action="adventure-node"')
    expect(html.match(/data-action="adventure-reward-choose"/g)).toHaveLength(3)
    expect(html.match(/data-offer-id="offer-1"/g)).toHaveLength(4)
    for (const label of [
      'Choose Second Wind. Gain one chance. Boon · Taken 1 of 2 times this run.',
      'Choose Guardian Sigil. Keep a chance. Charged relic · Holding 1 of 2 charges.',
      'Choose Prepared Pack. Draw one extra opening card. Relic · Lasts for the rest of the run.',
    ]) expect(html).toContain(`aria-label="${label}"`)
    expect(html).toContain('data-action="adventure-reward-skip" data-offer-id="offer-1">Skip reward</button>')
    for (const action of ['pause-adventure', 'abandon-adventure', 'lobby-settings', 'lobby-recording']) expect(html).toContain(`data-action="${action}"`)
    const ids = Array.from(html.matchAll(/ id="([^"]*)"/g), (match) => match[1])
    expect(new Set(ids).size).toBe(ids.length)
    // Sub-pages never offer the reward.
    for (const lobbyPage of ['settings', 'recording'] as const) {
      expect(renderThreeInterface(rewardView(), { ...defaultUi, lobbyPage })).not.toContain('adventure-reward')
    }
    // Once resolved, the route returns with the next tier's choices.
    const resolved = renderThreeInterface(hubView({ decisionKey: 'run-1|map|0|-|-' }), defaultUi)
    expect(resolved).not.toContain('data-adventure-reward-heading')
    expect(resolved.match(/data-action="adventure-node"/g)).toHaveLength(2)
  })

  it('lists relics with their charges and escapes catalog copy and offer IDs', () => {
    const hostile = '<img src=x onerror="alert(1)">'
    const offer = hubOffer('offer-"1"&<x>')
    const view = rewardView({
      pendingReward: { ...offer, choices: [{ ...offer.choices[0], name: hostile, rulesText: `${hostile} & more` }, ...offer.choices.slice(1)] },
      relics: [{ ...HUB_RELICS[0], name: hostile }, HUB_RELICS[1]],
    })
    const html = renderThreeInterface(view, defaultUi)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('<h3>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</h3>')
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; more')
    expect(html).toContain('data-offer-id="offer-&quot;1&quot;&amp;&lt;x&gt;"')
    expect(html).toContain('<li data-relic-id="guardian-sigil"><span><strong>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</strong> · 1 of 2 charges</span>')
    expect(html).toContain('<li data-relic-id="rooftop-charm"><span><strong>Rooftop Charm</strong></span>')
    expect(html).toContain('Opening hands include a Rooftop creature.')
    expect(html).not.toContain('Relics: none yet')
    // The empty inventory points to rewards only while a non-boss win can earn one.
    const empty = (adventure: Partial<AdventureUiState>) =>
      renderThreeInterface(hubView(adventure), defaultUi).match(/<p class="three-adventure-relics-empty">([^<]*)<\/p>/)?.[1]
    expect(empty({})).toBe('Relics: none yet. Win an encounter to earn a reward.')
    expect(empty({ stage: 'reward', pendingReward: hubOffer(), decisionKey: 'run-1|reward|0|-|offer-1' })).toBe('Relics: none yet.')
    expect(empty({ currentTier: 7 })).toBe('Relics: none yet.')
    expect(empty({ status: 'failed', stage: null })).toBe('Relics: none.')
    // The escaped offer ID still resolves exactly the offer on screen.
    const h = setup(view)
    h.click('[data-action="adventure-reward-skip"]')
    expect(h.controller.skipAdventureReward).toHaveBeenCalledExactlyOnceWith('offer-"1"&<x>')
    h.ui.dispose()
    // The lobby summarizes relics and a waiting reward without offering it.
    const lobby = renderThreeInterface({ ...makeView(), mode: null, game: null, adventure: { ...view.adventure, status: 'paused' } }, defaultUi)
    expect(lobby).toContain('Relics: &lt;img src=x onerror=&quot;alert(1)&quot;&gt; (1 of 2 charges), Rooftop Charm')
    expect(lobby).toContain('Reward waiting: resume the Adventure to choose or skip it.')
    expect(lobby).toContain('data-action="resume-adventure"')
    expect(lobby).not.toContain('data-action="adventure-reward-choose"')
    const quiet = renderThreeInterface({ ...makeView(), mode: null, game: null, adventure: hubView({ status: 'paused' }).adventure }, defaultUi)
    expect(quiet).not.toContain('Relics:')
    expect(quiet).not.toContain('Reward waiting')
  })

  it('resolves only the offer on screen, once per decision', () => {
    const h = setup(rewardView())
    const offered = (rewardId: string) => h.content.querySelector(`[data-reward-id="${rewardId}"]`)!
    // Tampered offer or reward IDs are ignored before the controller.
    const second = offered('second-wind')
    second.setAttribute('data-offer-id', 'offer-0')
    h.host.emit('click', { target: second })
    const sigil = offered('guardian-sigil')
    sigil.setAttribute('data-reward-id', 'scout-cache')
    h.host.emit('click', { target: sigil })
    const skip = h.content.querySelector('[data-action="adventure-reward-skip"]')!
    skip.setAttribute('data-offer-id', 'offer-2')
    h.host.emit('click', { target: skip })
    expect(h.controller.chooseAdventureReward).not.toHaveBeenCalled()
    expect(h.controller.skipAdventureReward).not.toHaveBeenCalled()
    // Sub-pages never resolve a reward.
    h.click('[data-action="lobby-settings"]')
    expect(h.content.querySelector('[data-action="adventure-reward-choose"]')).toBeNull()
    h.click('[data-action="lobby-root"]')
    // A refused write keeps the same decision, so the choice can be retried,
    // and a refresh for the warning keeps focus on the reward that was chosen.
    h.click('[data-reward-id="guardian-sigil"]')
    expect(h.controller.chooseAdventureReward).toHaveBeenCalledExactlyOnceWith('offer-1', 'guardian-sigil')
    h.update({ ...rewardView(), status: 'Adventure progress could not be saved (storage unavailable). The reward was not claimed.' })
    expect(h.document.activeElement?.dataset.rewardId).toBe('guardian-sigil')
    h.controller.chooseAdventureReward.mockImplementation(() => h.latest(hubView({ relics: HUB_RELICS.slice(0, 1), decisionKey: 'run-1|map|0|-|-' })))
    const chosen = h.click('[data-reward-id="guardian-sigil"]')
    expect(h.controller.chooseAdventureReward).toHaveBeenCalledTimes(2)
    // A repeated activation before the next frame meets the newer decision,
    // which only refreshes the view to the route.
    h.host.emit('click', { target: chosen })
    expect(h.controller.chooseAdventureReward).toHaveBeenCalledTimes(2)
    expect(h.content.querySelector('[data-action="adventure-reward-choose"]')).toBeNull()
    expect(h.content.querySelectorAll('[data-action="adventure-node"]')).toHaveLength(2)
    expect(h.content.querySelector('[data-relic-id="guardian-sigil"]')).not.toBeNull()
    h.ui.dispose()

    // Skip resolves the offer on screen; a newer offer makes older buttons inert.
    const s = setup(rewardView())
    const staleSkip = s.content.querySelector('[data-action="adventure-reward-skip"]')!
    s.latest(rewardView({ pendingReward: hubOffer('offer-2'), decisionKey: 'run-1|reward|0|-|offer-2' }))
    s.host.emit('click', { target: staleSkip })
    expect(s.controller.skipAdventureReward).not.toHaveBeenCalled()
    s.click('[data-action="adventure-reward-skip"]')
    expect(s.controller.skipAdventureReward).toHaveBeenCalledExactlyOnceWith('offer-2')
    expect(s.controller.chooseAdventureReward).not.toHaveBeenCalled()
    s.ui.dispose()
  })

  it('moves focus to the result, then the reward, then the current tier', () => {
    // A won encounter leads with its result; the reward follows it.
    const h = setup({
      ...makeView(), mode: 'adventure-hvai', controllers: ['human', 'ai'],
      adventure: { ...rewardView().adventure, stage: 'encounter', pendingReward: null, lastResult: null, decisionKey: 'run-1|encounter|0|-|-' },
    })
    h.update(rewardView())
    expect(h.document.activeElement).toBe(h.content.querySelector('[data-adventure-result-heading]'))
    h.ui.dispose()
    // Resuming at the reward stage shows no result, so the reward leads.
    const lobby = setup({ ...makeView(), mode: null, game: null })
    lobby.update(rewardView({ lastResult: null }))
    const heading = lobby.content.querySelector('[data-adventure-reward-heading]')
    expect(heading?.tagName).toBe('H2')
    expect(lobby.document.activeElement).toBe(heading)
    // The same decision keeps the user's focus.
    lobby.content.querySelector('[data-reward-id="prepared-pack"]')!.focus()
    lobby.update({ ...rewardView({ lastResult: null }), status: 'That reward is not available. Choose an offered reward or skip it.' })
    expect(lobby.document.activeElement?.dataset.rewardId).toBe('prepared-pack')
    // A resolved reward is a new decision: focus moves to the current tier.
    lobby.update(hubView({ decisionKey: 'run-1|map|0|-|-' }))
    expect(lobby.document.activeElement).toBe(lobby.content.querySelector('[data-adventure-current-tier]'))
    lobby.ui.dispose()
  })

  it('claims a real reward from the hub and opens the next tier', () => {
    withFakeTimers(() => {
      installHubStorage()
      const real = new AppController()
      const h = setup(real.getViewModel())
      h.controller.getViewModel.mockImplementation(() => real.getViewModel())
      h.controller.startAdventure.mockImplementation(() => real.startAdventure())
      h.controller.startAdventureNode.mockImplementation((nodeId) => real.startAdventureNode(nodeId))
      h.controller.chooseAdventureReward.mockImplementation((offerId, rewardId) => real.chooseAdventureReward(offerId, rewardId))
      h.controller.skipAdventureReward.mockImplementation((offerId) => real.skipAdventureReward(offerId))
      const unsubscribe = real.subscribe((next) => h.update(next))
      h.click('[data-mode="adventure-hvai"]')
      h.click(`[data-node-id="${actionableAdventureNodes(real.getViewModel().adventure)[0].id}"]`)
      // End the encounter the way the engine does, with a human win.
      const internals = real as unknown as {
        state: { game: GameState }
        onAdventureGameFinished(previous: GameState): void
        notify(): void
      }
      const previous = structuredClone(internals.state.game)
      internals.state.game.winner = 0
      internals.state.game.phase = 'gameOver'
      internals.onAdventureGameFinished(previous)
      internals.notify()
      const won = real.getViewModel()
      const offer = won.adventure.pendingReward!
      expect(won.adventure.stage).toBe('reward')
      expect(h.document.activeElement).toBe(h.content.querySelector('[data-adventure-result-heading]'))
      expect(h.content.querySelector('[data-action="adventure-node"]')).toBeNull()
      expect(h.content.querySelectorAll('[data-action="adventure-reward-choose"]')
        .map((element) => [element.dataset.offerId, element.dataset.rewardId]))
        .toEqual(offer.choices.map((choice) => [offer.offerId, choice.id]))
      const choice = offer.choices[0]
      const chosen = h.click(`[data-reward-id="${choice.id}"]`)
      expect(h.controller.chooseAdventureReward).toHaveBeenCalledExactlyOnceWith(offer.offerId, choice.id)
      const claimed = real.getViewModel()
      expect(claimed.status).toBe(`${choice.name} claimed. Choose your Tier 2 encounter.`)
      expect(claimed.adventure).toMatchObject({ stage: 'map', pendingReward: null, lastResult: null })
      expect(h.content.querySelector('[data-adventure-reward-heading]')).toBeNull()
      expect(h.document.activeElement).toBe(h.content.querySelector('[data-adventure-current-tier]'))
      expect(h.content.querySelectorAll('[data-relic-id]').map((element) => element.dataset.relicId))
        .toEqual(claimed.adventure.relics.map((relic) => relic.id))
      expect(h.content.querySelectorAll('[data-action="adventure-node"]').map((element) => element.dataset.nodeId))
        .toEqual(actionableAdventureNodes(claimed.adventure).map((node) => node.id))
      // The detached Choose button of the previous frame claims nothing more.
      h.host.emit('click', { target: chosen })
      expect(h.controller.chooseAdventureReward).toHaveBeenCalledTimes(1)
      expect(real.getViewModel().adventure.decisionKey).toBe(claimed.adventure.decisionKey)
      unsubscribe()
      h.ui.dispose()
    })
  })
})

function announcement(host: ElementStub): string | undefined {
  return (host.querySelector(`#${THREE_STATUS_ANNOUNCER_ID}`) as unknown as { textContent?: string } | null)?.textContent
}

// Keyboard tab stops, as the interface defines them.
const TAB_STOPS = 'button:not([disabled]), a[href], input:not([hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]'

// The stub harness driven by a real controller over tracked storage, so focus
// and announcements follow real transitions and refused writes.
function setupRealAdventure() {
  const storage = installHubStorage()
  const real = new AppController()
  const h = setup(real.getViewModel())
  const api = h.controller
  api.getViewModel.mockImplementation(() => real.getViewModel())
  api.startAdventure.mockImplementation(() => real.startAdventure())
  api.startAdventureNode.mockImplementation((nodeId) => real.startAdventureNode(nodeId))
  api.chooseAdventureReward.mockImplementation((offerId, rewardId) => real.chooseAdventureReward(offerId, rewardId))
  api.skipAdventureReward.mockImplementation((offerId) => real.skipAdventureReward(offerId))
  api.retryAdventureCompletion.mockImplementation(() => real.retryAdventureCompletion())
  api.pauseAdventure.mockImplementation(() => real.pauseAdventure())
  api.resumeAdventure.mockImplementation(() => real.resumeAdventure())
  api.abandonAdventure.mockImplementation(() => real.abandonAdventure())
  api.backToLobby.mockImplementation(() => real.backToLobby())
  // A held frame models a renderer that presents snapshots after the
  // controller has moved on.
  let holding = false
  let held: AppViewModel | null = null
  const present = (next: AppViewModel): void => {
    if (holding) held = next
    else h.update(next)
  }
  const subscriptions = [real.subscribe(present)]
  const internals = real as unknown as {
    state: { game: GameState | null }
    onAdventureGameFinished(previous: GameState): void
    notify(): void
  }
  return {
    ...h, real, storage,
    adventure: (): AdventureUiState => real.getViewModel().adventure,
    lobbyHeading: (): ElementStub | null => h.content.querySelector('[data-lobby-heading]'),
    // Ends the live encounter the way the engine does, then presents it.
    finish: (winner: 0 | 1 | 'draw'): void => {
      const game = internals.state.game
      if (!game) throw new Error('Expected a live Adventure game')
      const previous = structuredClone(game)
      game.winner = winner
      game.phase = 'gameOver'
      internals.onAdventureGameFinished(previous)
      internals.notify()
    },
    startFirstNode: (): string => {
      const node = actionableAdventureNodes(real.getViewModel().adventure)[0]
      if (!node) throw new Error('Expected an offered Adventure node')
      h.click(`[data-node-id="${node.id}"]`)
      return node.id
    },
    hold: (): void => { holding = true },
    release: (): void => {
      holding = false
      const next = held
      held = null
      if (next) h.update(next)
    },
    // Adds a controller subscriber that runs before (or after) the interface's.
    subscribe: (listener: (view: AppViewModel) => void, first = false): void => {
      if (!first) {
        subscriptions.push(real.subscribe(listener))
        return
      }
      for (const unsubscribe of subscriptions.splice(0)) unsubscribe()
      subscriptions.push(real.subscribe(listener), real.subscribe(present))
    },
    dispose: (): void => {
      for (const unsubscribe of subscriptions.splice(0)) unsubscribe()
      h.ui.dispose()
    },
  }
}

type RealAdventure = ReturnType<typeof setupRealAdventure>

const runWritesSince = (r: RealAdventure, from: number): number =>
  r.storage.calls.slice(from).filter((call) => call === `set:${ADVENTURE_RUN_STORAGE_KEY}`).length

const savedRewardHistory = (r: RealAdventure): unknown[] =>
  (JSON.parse(r.storage.data.get(ADVENTURE_RUN_STORAGE_KEY) ?? '{}') as { rewardHistory?: { rewardId: unknown }[] })
    .rewardHistory?.map((entry) => entry.rewardId) ?? []

// One decision control of the stateful UI matrix: how to reach it, where it
// lands, and how the controller can move past it behind the interface.
interface AdventureDecision {
  selector: string
  command: ReturnType<typeof vi.fn>
  applied(): void
  focused(): void
  advanceBehind(): void
}

function reachAdventureDecision(r: RealAdventure, kind: 'node' | 'choose' | 'skip'): AdventureDecision {
  r.click('[data-mode="adventure-hvai"]')
  if (kind === 'node') {
    const node = actionableAdventureNodes(r.adventure())[0]
    return {
      selector: `[data-node-id="${node.id}"]`,
      command: r.controller.startAdventureNode,
      applied: () => expect(r.real.getViewModel()).toMatchObject({ game: { isReplay: false }, adventure: { stage: 'encounter' } }),
      focused: () => expect(r.document.activeElement).toBe(r.content.querySelector('[data-action="menu"]')),
      advanceBehind: () => r.real.startAdventureNode(node.id),
    }
  }
  r.startFirstNode()
  r.finish(0)
  const offer = r.adventure().pendingReward!
  const choice = offer.choices[0]
  const resolved = (): void => expect(r.adventure()).toMatchObject({ stage: 'map', pendingReward: null })
  const focused = (): void => expect(r.document.activeElement).toBe(r.content.querySelector('[data-adventure-current-tier]'))
  return kind === 'choose'
    ? {
      selector: `[data-reward-id="${choice.id}"]`,
      command: r.controller.chooseAdventureReward,
      applied: () => {
        resolved()
        expect(savedRewardHistory(r)).toEqual([choice.id])
        expect(r.real.getViewModel().status).toBe(`${choice.name} claimed. Choose your Tier 2 encounter.`)
      },
      focused,
      advanceBehind: () => r.real.skipAdventureReward(offer.offerId),
    }
    : {
      selector: '[data-action="adventure-reward-skip"]',
      command: r.controller.skipAdventureReward,
      applied: () => {
        resolved()
        expect(savedRewardHistory(r)).toEqual([null])
        expect(r.real.getViewModel().status).toBe('Reward skipped. Choose your Tier 2 encounter.')
      },
      focused,
      advanceBehind: () => r.real.chooseAdventureReward(offer.offerId, choice.id),
    }
}

const decisionIdentity = (element: ElementStub | null | undefined): unknown[] =>
  [element?.dataset.action, element?.dataset.nodeId, element?.dataset.offerId, element?.dataset.rewardId]

describe('Three status announcer', () => {
  it('announces status through one persistent region outside the rebuilt markup', () => {
    const view = makeView()
    const h = setup(view, true, { enabled: true })
    const regions = h.host.querySelectorAll(`#${THREE_STATUS_ANNOUNCER_ID}`)
    expect(regions).toHaveLength(1)
    const region = regions[0]
    expect(region.tagName).toBe('P')
    expect(region.parent).toBe(h.host)
    expect(h.content.contains(region)).toBe(false)
    expect(region.matches('.three-sr-only')).toBe(true)
    expect([region.getAttribute('role'), region.getAttribute('aria-live'), region.getAttribute('aria-atomic')]).toEqual(['status', 'polite', 'true'])
    expect(announcement(h.host)).toBe('Ready')
    // The visible status is plain text, so it is not read twice.
    expect(h.hud!.innerHTML).toContain('<p>Ready</p>')
    h.update({ ...view, status: 'Recording saved.' })
    expect(h.host.querySelector(`#${THREE_STATUS_ANNOUNCER_ID}`)).toBe(region)
    expect(announcement(h.host)).toBe('Recording saved.')
    // Refreshes that keep the status stay quiet; an empty status clears the region.
    h.update({ ...view, status: 'Recording saved.', game: { ...view.game!, turn: 2 } })
    expect(announcement(h.host)).toBe('Recording saved.')
    h.update({ ...view, status: '' })
    expect(announcement(h.host)).toBe('')
    h.ui.dispose()
    expect(region.parent).toBeNull()
    expect(h.host.querySelector(`#${THREE_STATUS_ANNOUNCER_ID}`)).toBeNull()
  })

  it('re-announces an unchanged status only after a retried Adventure command', () => {
    const h = setup(rewardView())
    const refused = { ...rewardView(), status: 'Adventure progress could not be saved (storage unavailable). The reward was not claimed.' }
    h.controller.chooseAdventureReward.mockImplementation(() => h.update(refused))
    h.click('[data-reward-id="guardian-sigil"]')
    expect(announcement(h.host)).toBe(refused.status)
    // A trailing no-break space changes the region's text, not what is read.
    h.click('[data-reward-id="guardian-sigil"]')
    expect(announcement(h.host)).toBe(`${refused.status}\u00a0`)
    h.click('[data-reward-id="guardian-sigil"]')
    expect(announcement(h.host)).toBe(refused.status)
    expect(h.controller.chooseAdventureReward).toHaveBeenCalledTimes(3)
    expect(h.document.activeElement?.dataset.rewardId).toBe('guardian-sigil')
    // Other refreshes, and a command that changes nothing, stay quiet.
    h.update({ ...refused })
    expect(announcement(h.host)).toBe(refused.status)
    h.controller.chooseAdventureReward.mockImplementation(() => {})
    h.click('[data-reward-id="guardian-sigil"]')
    h.update({ ...refused })
    expect(announcement(h.host)).toBe(refused.status)
    // An empty status is never padded.
    h.controller.skipAdventureReward.mockImplementation(() => h.update({ ...rewardView(), status: '' }))
    h.click('[data-action="adventure-reward-skip"]')
    h.click('[data-action="adventure-reward-skip"]')
    expect(announcement(h.host)).toBe('')
    h.ui.dispose()
  })

  it('announces starting, stopping and stepping a replay, not its playback ticks', () => {
    const base = makeView()
    const replay = (step: number, isPlaying: boolean, status: string): AppViewModel => ({
      ...base, status, replay: { active: true, step, totalSteps: 10, isPlaying },
      game: { ...base.game!, isReplay: true, canInput: false },
    })
    const h = setup(replay(0, false, 'Recording loaded.'))
    expect(announcement(h.host)).toBe('Recording loaded.')
    h.update(replay(0, true, 'Replay playing from step 0/10.'))
    expect(announcement(h.host)).toBe('Replay playing from step 0/10.')
    h.update(replay(1, true, 'Replay step 1/10.'))
    h.update(replay(2, true, 'Replay step 2/10.'))
    expect(announcement(h.host)).toBe('Replay playing from step 0/10.')
    h.update(replay(2, false, 'Replay paused at step 2/10.'))
    expect(announcement(h.host)).toBe('Replay paused at step 2/10.')
    h.update(replay(3, false, 'Replay step 3/10.'))
    expect(announcement(h.host)).toBe('Replay step 3/10.')
    h.update(replay(3, true, 'Replay playing from step 3/10.'))
    h.update(replay(9, true, 'Replay step 9/10.'))
    expect(announcement(h.host)).toBe('Replay playing from step 3/10.')
    h.update(replay(10, false, 'Replay reached final state.'))
    expect(announcement(h.host)).toBe('Replay reached final state.')
    h.ui.dispose()
  })
})

describe('Three Adventure transition focus', () => {
  it('moves focus to the lobby heading, the Game Menu or the map as an Adventure moves', () => {
    withFakeTimers(() => {
      const r = setupRealAdventure()
      // Hub Pause, then Resume to the map.
      r.click('[data-mode="adventure-hvai"]')
      r.click('[data-action="pause-adventure"]')
      expect(r.real.getViewModel()).toMatchObject({ mode: null, adventure: { status: 'paused' } })
      expect(r.document.activeElement).toBe(r.lobbyHeading())
      expect(announcement(r.host)).toBe(r.real.getViewModel().status)
      r.click('[data-action="resume-adventure"]')
      expect(r.document.activeElement).toBe(r.content.querySelector('[data-adventure-current-tier]'))
      // Hub Reset.
      r.click('[data-action="abandon-adventure"]')
      expect(r.real.getViewModel()).toMatchObject({ mode: null, adventure: { hasSavedRun: false } })
      expect(r.document.activeElement).toBe(r.lobbyHeading())
      expect(announcement(r.host)).toBe('Adventure run reset.')
      // A node starts its encounter at the Game Menu button.
      r.click('[data-mode="adventure-hvai"]')
      r.startFirstNode()
      expect(r.real.getViewModel().game).not.toBeNull()
      expect(r.document.activeElement).toBe(r.content.querySelector('[data-action="menu"]'))
      // In-game Pause wins over the closing Game Menu's fallback focus.
      r.click('[data-action="menu"]')
      r.click('[data-action="pause-adventure"]')
      expect(r.real.getViewModel().mode).toBeNull()
      expect(r.document.activeElement).toBe(r.lobbyHeading())
      // Resume restores the encounter at the Game Menu button.
      r.click('[data-action="resume-adventure"]')
      expect(r.real.getViewModel().game).not.toBeNull()
      expect(r.document.activeElement).toBe(r.content.querySelector('[data-action="menu"]'))
      // In-game Reset.
      r.click('[data-action="menu"]')
      r.click('[data-action="abandon-adventure"]')
      expect(r.real.getViewModel()).toMatchObject({ mode: null, game: null, adventure: { hasSavedRun: false } })
      expect(r.document.activeElement).toBe(r.lobbyHeading())
      // A lobby Reset stays in the lobby but removes the control that had focus.
      r.click('[data-mode="adventure-hvai"]')
      r.click('[data-action="pause-adventure"]')
      r.click('[data-action="abandon-adventure"]')
      expect(r.adventure().hasSavedRun).toBe(false)
      expect(r.content.querySelector('[data-action="abandon-adventure"]')).toBeNull()
      expect(r.document.activeElement).toBe(r.lobbyHeading())
      r.dispose()
    })
  })

  it('keeps focus on the activated control when an Adventure write is refused', () => {
    withFakeTimers(() => {
      const r = setupRealAdventure()
      r.click('[data-mode="adventure-hvai"]')
      r.storage.failingSets.add(ADVENTURE_RUN_STORAGE_KEY)
      const nodeId = r.startFirstNode()
      expect(r.real.getViewModel().game).toBeNull()
      expect(r.document.activeElement?.dataset.nodeId).toBe(nodeId)
      expect(r.real.getViewModel().status).toContain('could not be saved')
      expect(announcement(r.host)).toBe(r.real.getViewModel().status)
      r.click('[data-action="pause-adventure"]')
      expect(r.real.getViewModel().mode).toBe('adventure-hvai')
      expect(r.document.activeElement?.dataset.action).toBe('pause-adventure')
      expect(announcement(r.host)).toBe(r.real.getViewModel().status)
      // A click that did not focus its button (as in Safari) leaves focus alone.
      r.document.activeElement = r.document.body
      r.host.emit('click', { target: r.content.querySelector('[data-action="pause-adventure"]') })
      expect(r.document.activeElement).toBe(r.document.body)
      // Once storage accepts the write, the same controls complete the transition.
      r.storage.failingSets.delete(ADVENTURE_RUN_STORAGE_KEY)
      r.host.emit('click', { target: r.content.querySelector('[data-action="pause-adventure"]') })
      expect(r.real.getViewModel().mode).toBeNull()
      expect(r.document.activeElement).toBe(r.lobbyHeading())
      // A refused lobby Reset keeps the run, its controls and the focus.
      r.storage.failingRemoves.add(ADVENTURE_RUN_STORAGE_KEY)
      r.click('[data-action="abandon-adventure"]')
      expect(r.adventure().hasSavedRun).toBe(true)
      expect(r.document.activeElement?.dataset.action).toBe('abandon-adventure')
      expect(announcement(r.host)).toBe(r.real.getViewModel().status)
      r.dispose()
    })
  })

  it('keeps opponent decks and seeds out of the lobby, map, reward, result and completion', () => {
    withFakeTimers(() => {
      const r = setupRealAdventure()
      r.click('[data-mode="adventure-hvai"]')
      const run = JSON.parse(r.storage.data.get(ADVENTURE_RUN_STORAGE_KEY)!) as {
        baseSeed: number
        map: { tiers: Array<{ nodes: Array<{ opponent: { deck: Array<{ id: string, name: string }> } }> }> }
      }
      const decks = run.map.tiers.flatMap((tier) => tier.nodes.map((node) => node.opponent.deck))
      expect(decks.length).toBeGreaterThanOrEqual(7)
      const forbidden = new Set([String(run.baseSeed), ...decks.flatMap((deck) => {
        const order = JSON.stringify(deck.map((card) => card.name))
        return [...deck.map((card) => card.id), order, escapeHtml(order)]
      })])
      const leaks = (stage: string) => {
        const html = r.content.innerHTML
        return { stage, leaked: [...forbidden].filter((token) => html.includes(token)) }
      }
      const startEncounter = (): void => {
        r.startFirstNode()
        forbidden.add(String(r.adventure().activeGameSeed))
      }
      expect(leaks('map')).toEqual({ stage: 'map', leaked: [] })
      startEncounter()
      r.finish(0)
      expect(r.adventure().stage).toBe('reward')
      expect(leaks('reward')).toEqual({ stage: 'reward', leaked: [] })
      r.click('[data-action="adventure-reward-skip"]')
      r.click('[data-action="pause-adventure"]')
      expect(r.adventure().status).toBe('paused')
      expect(leaks('paused lobby')).toEqual({ stage: 'paused lobby', leaked: [] })
      r.click('[data-action="resume-adventure"]')
      startEncounter()
      r.finish(1)
      expect(r.adventure().lastResult?.outcome).toBe('loss')
      expect(leaks('result')).toEqual({ stage: 'result', leaked: [] })
      for (let guard = 0; guard < 12 && r.adventure().status !== 'completed'; guard += 1) {
        startEncounter()
        r.finish(0)
        if (r.adventure().pendingReward) r.click('[data-action="adventure-reward-skip"]')
      }
      expect(r.adventure().status).toBe('completed')
      expect(leaks('completion')).toEqual({ stage: 'completion', leaked: [] })
      // Leaving the finished run focuses the lobby.
      r.click('[data-action="back-to-lobby"]')
      expect(r.real.getViewModel().mode).toBeNull()
      expect(r.document.activeElement).toBe(r.lobbyHeading())
      r.dispose()
    })
  })

  it('orders hub tab stops: route or reward, then Pause and Reset, then options', () => {
    const stops = (view: AppViewModel): string[] => {
      const h = setup(view)
      const order = h.content.querySelectorAll(TAB_STOPS)
        .map((element) => element.dataset.nodeId ?? element.dataset.rewardId ?? element.dataset.action ?? element.tagName)
      h.ui.dispose()
      return order
    }
    const options = ['lobby-settings', 'lobby-recording']
    expect(stops(hubView())).toEqual(['tier-2-left', 'tier-2-right', 'pause-adventure', 'abandon-adventure', ...options])
    // Relics are listed before the reward but are text, not stops.
    expect(stops(rewardView({ relics: [...HUB_RELICS] }))).toEqual([
      'second-wind', 'guardian-sigil', 'prepared-pack', 'adventure-reward-skip', 'pause-adventure', 'abandon-adventure', ...options,
    ])
    expect(stops(hubView({
      status: 'completed', stage: null, currentTier: 7, tiers: hubTiers(['completed', 'bypassed'], undefined, 'completed'),
      lastResult: hubResult({ outcome: 'win', tierIndex: 6, opponentLabel: 'Boss', score: 9 }), decisionKey: 'run-1|completed|0|',
    }))).toEqual(['start-new-adventure', 'back-to-lobby', ...options])
  })

  it('adds no motion to the announcer or the Adventure hub, reward and result', () => {
    const css = readFileSync(join(__dirname, '..', 'renderers', 'three', 'interface.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const rules = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g), (match) => [match[1].trim(), match[2]] as const)
    const adventure = rules.filter(([selector]) => /\.three-(adventure|sr-only)/.test(selector))
    expect(adventure.length).toBeGreaterThan(20)
    expect(adventure.filter(([, body]) => /\b(transition|animation)\b/.test(body)).map(([selector]) => selector)).toEqual([])
    expect(css).not.toContain('@keyframes')
  })
})

// The stateful UI regression matrix (docs/agent/testing.md) for the hub's
// decision controls. Each control has a single target, so target
// cardinality does not apply.
describe.each(['node', 'choose', 'skip'] as const)('Three Adventure %s control', (kind) => {
  it('applies one synchronous transition with one run write and focuses the next decision', () => {
    withFakeTimers(() => {
      const r = setupRealAdventure()
      const decision = reachAdventureDecision(r, kind)
      const before = r.adventure().decisionKey
      const from = r.storage.calls.length
      r.click(decision.selector)
      expect(decision.command).toHaveBeenCalledTimes(1)
      expect(r.adventure().decisionKey).not.toBe(before)
      expect(runWritesSince(r, from)).toBe(1)
      decision.applied()
      decision.focused()
      expect(announcement(r.host)).toBe(r.real.getViewModel().status)
      r.dispose()
    })
  })

  it('keeps the decision and focus when storage refuses the write, then applies one retry', () => {
    withFakeTimers(() => {
      const r = setupRealAdventure()
      const decision = reachAdventureDecision(r, kind)
      const before = r.adventure().decisionKey
      r.storage.failingSets.add(ADVENTURE_RUN_STORAGE_KEY)
      const control = r.click(decision.selector)
      expect(decision.command).toHaveBeenCalledTimes(1)
      expect(r.adventure().decisionKey).toBe(before)
      expect(r.real.getViewModel().status).toContain('could not be saved')
      expect(announcement(r.host)).toBe(r.real.getViewModel().status)
      expect(decisionIdentity(r.document.activeElement)).toEqual(decisionIdentity(control))
      // Repeated refusals are announced again, on the same control, even
      // once the status text stops changing.
      r.click(decision.selector)
      const still = r.real.getViewModel().status
      expect(still).toContain('still could not be saved')
      expect(announcement(r.host)).toBe(still)
      r.click(decision.selector)
      expect(r.real.getViewModel().status).toBe(still)
      expect(announcement(r.host)).not.toBe(still)
      expect(announcement(r.host)?.trim()).toBe(still)
      expect(r.adventure().decisionKey).toBe(before)
      expect(decisionIdentity(r.document.activeElement)).toEqual(decisionIdentity(control))
      r.storage.failingSets.delete(ADVENTURE_RUN_STORAGE_KEY)
      const from = r.storage.calls.length
      r.click(decision.selector)
      expect(decision.command).toHaveBeenCalledTimes(4)
      expect(runWritesSince(r, from)).toBe(1)
      decision.applied()
      decision.focused()
      r.dispose()
    })
  })

  it('ignores the control once the decision has moved on behind the interface', () => {
    withFakeTimers(() => {
      const r = setupRealAdventure()
      const decision = reachAdventureDecision(r, kind)
      const control = r.content.querySelector(decision.selector)!
      r.hold()
      decision.advanceBehind()
      const advanced = r.adventure().decisionKey
      expect(control.isConnected).toBe(true)
      control.focus()
      r.host.emit('click', { target: control })
      expect(decision.command).not.toHaveBeenCalled()
      expect(r.adventure().decisionKey).toBe(advanced)
      // The click refreshed the interface to the newer decision instead.
      expect(control.isConnected).toBe(false)
      expect(r.onChange).toHaveBeenCalled()
      r.release()
      r.dispose()
    })
  })

  it('dispatches once for a repeated activation before and after the re-render', () => {
    withFakeTimers(() => {
      const r = setupRealAdventure()
      const decision = reachAdventureDecision(r, kind)
      // Keyboard activation of a native button arrives as the same single click.
      r.document.emit('keydown', { key: 'Enter', shiftKey: false, preventDefault: () => {} })
      expect(decision.command).not.toHaveBeenCalled()
      r.hold()
      const control = r.click(decision.selector)
      // Before the next frame, the second activation meets the newer decision.
      r.host.emit('click', { target: control })
      expect(decision.command).toHaveBeenCalledTimes(1)
      r.release()
      // After it, the old control is gone and does nothing.
      r.host.emit('click', { target: control })
      expect(decision.command).toHaveBeenCalledTimes(1)
      decision.applied()
      r.dispose()
    })
  })

  it.each([true, false])('applies once and writes nothing more when a subscriber disposes the interface (first: %s)', (first) => {
    withFakeTimers(() => {
      const r = setupRealAdventure()
      const decision = reachAdventureDecision(r, kind)
      const region = r.host.querySelector(`#${THREE_STATUS_ANNOUNCER_ID}`) as unknown as ElementStub & { textContent?: string }
      let disposedWith: { active: ElementStub | null, builds: number, announced: string | undefined } | null = null
      // Subscribing delivers the current view at once; dispose on the next one.
      let armed = false
      r.subscribe(() => {
        if (!armed || disposedWith) return
        r.ui.dispose()
        disposedWith = { active: r.document.activeElement, builds: r.content.builds, announced: region.textContent }
      }, first)
      armed = true
      const from = r.storage.calls.length
      expect(() => r.click(decision.selector)).not.toThrow()
      expect(decision.command).toHaveBeenCalledTimes(1)
      expect(runWritesSince(r, from)).toBe(1)
      decision.applied()
      expect(disposedWith).not.toBeNull()
      expect(r.document.activeElement).toBe(disposedWith!.active)
      expect(r.content.builds).toBe(disposedWith!.builds)
      expect(region.textContent).toBe(disposedWith!.announced)
      expect(region.parent).toBeNull()
      r.dispose()
    })
  })
})

describe('Three Adventure reward across Pause and Reset', () => {
  it('keeps a waiting reward through Pause and Resume, and Reset drops it', () => {
    withFakeTimers(() => {
      const r = setupRealAdventure()
      const decision = reachAdventureDecision(r, 'choose')
      const offer = r.adventure().pendingReward!
      const choose = r.content.querySelector(decision.selector)!
      r.click('[data-action="pause-adventure"]')
      expect(r.real.getViewModel()).toMatchObject({ mode: null, adventure: { status: 'paused', stage: 'reward' } })
      expect(r.document.activeElement).toBe(r.lobbyHeading())
      // The hub's Choose control is gone from the lobby and claims nothing.
      r.host.emit('click', { target: choose })
      expect(r.controller.chooseAdventureReward).not.toHaveBeenCalled()
      expect(r.content.querySelector('[data-action="adventure-reward-choose"]')).toBeNull()
      r.click('[data-action="resume-adventure"]')
      expect(r.adventure().pendingReward).toEqual(offer)
      expect(r.content.querySelectorAll('[data-action="adventure-reward-choose"]')
        .map((element) => [element.dataset.offerId, element.dataset.rewardId]))
        .toEqual(offer.choices.map((choice) => [offer.offerId, choice.id]))
      expect(r.document.activeElement).toBe(r.content.querySelector('[data-adventure-reward-heading]'))
      r.click('[data-action="abandon-adventure"]')
      expect(r.adventure()).toMatchObject({ hasSavedRun: false, pendingReward: null })
      expect(r.storage.data.has(ADVENTURE_RUN_STORAGE_KEY)).toBe(false)
      expect(r.document.activeElement).toBe(r.lobbyHeading())
      expect(r.controller.chooseAdventureReward).not.toHaveBeenCalled()
      expect(r.controller.skipAdventureReward).not.toHaveBeenCalled()
      r.dispose()
    })
  })
})
