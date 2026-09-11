import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppController, type ControllerApi } from '../app/controller'
import { createGameRecord } from '../app/game-recording'
import { cardArtFallbackUrl, cardArtUrl } from '../app/card-art'
import { CARD_VISUAL_STYLES, isRasterCardVisualStyle } from '../app/card-visual-styles'
import { HIDDEN_HAND_CARD_NAME, type AppViewModel } from '../app/types'
import { createInitialGame } from '../game/engine'
import { BASIC_LANDS, type BasicLand } from '../game/types'
import { noteRasterCardArtLoadFailure, resetRasterCardArtLoadFailuresForTests } from '../renderers/dom-utils'
import { ThreeInterface } from '../renderers/three/interface'
import {
  canThreeInput,
  isThreeMode,
  renderThreeInterface,
  renderThreeHud,
  threeDecisionKey,
  threePrimaryAction,
  threeResponse,
  threeTargets,
  type InterfaceUi,
} from '../renderers/three/interface-model'
import type { BoardHit } from '../renderers/three/contracts'

function makeView(): AppViewModel {
  return {
    renderer: 'three', mode: 'local-hvh', seed: 42, status: 'Ready', offer: '', answer: '',
    controllers: ['human', 'human'], aiLevel: 'basic', cardVisualStyle: 'classic',
    animationSpeed: 'normal', boardTheme: 'classic', renderQualityPreference: 'auto',
    p2pConnected: false, p2pStarted: false,
    tutorial: { active: false, stepId: null, hint: null },
    adventure: {
      baseSeed: 0, currentRound: 1, remainingChances: 3, winStreak: 0,
      totalRoundsPlayed: 0, totalCardsPlayed: 0, opponentLineup: [], currentOpponentIndex: 0,
      activeGameSeed: null, status: 'inactive', highScore: 0, hasSavedRun: false,
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

function setup(view = makeView(), separateHud = false) {
  let current = view
  const document = new DocumentStub()
  const host = document.createElement('section')
  const hud = separateHud ? document.createElement('section') : null
  const board = document.createElement('canvas')
  if (hud) document.body.append(hud)
  document.body.append(board, host)
  const controller = {
    subscribe: vi.fn(() => () => {}), getViewModel: vi.fn(() => current),
    setAiLevel: vi.fn(), setCardVisualStyle: vi.fn(), setAnimationSpeed: vi.fn(), setBoardTheme: vi.fn(), setRenderQualityPreference: vi.fn(),
    startGame: vi.fn(), startAdventure: vi.fn(), resumeAdventure: vi.fn(), pauseAdventure: vi.fn(), abandonAdventure: vi.fn(), backToLobby: vi.fn(),
    createOffer: vi.fn(async () => {}), acceptAnswer: vi.fn(async () => {}), createAnswer: vi.fn(async () => {}), startP2PGame: vi.fn(),
    submitAction: vi.fn(), rematch: vi.fn(), exportRecordingJson: vi.fn((): string | null => '{}'),
    importRecordingJson: vi.fn(), saveRecordingToLocalStorage: vi.fn(), loadRecordingFromLocalStorage: vi.fn(), reportStatus: vi.fn(),
    startReplay: vi.fn(), pauseReplay: vi.fn(), stepReplay: vi.fn(), jumpReplayToEnd: vi.fn(), exitReplay: vi.fn(),
  } satisfies ControllerApi
  const onChange = vi.fn()
  const onBlock = vi.fn()
  const ui = new ThreeInterface(host as unknown as HTMLElement, controller, onChange, onBlock, hud as unknown as HTMLElement | null)
  ui.update(view, view.game?.actor ?? 0)
  const content = host.children[0]
  const click = (selector: string): ElementStub => {
    const element = content.querySelector(selector) ?? hud?.querySelector(selector)
    if (!element) throw new Error(`Missing button ${selector}`)
    element.focus()
    ;(hud?.contains(element) ? hud : host).emit('click', { target: element })
    return element
  }
  const openCards = (): void => {
    click('[data-action="menu"]')
    click('[data-action="cards"]')
  }
  const update = (next: AppViewModel, actor = next.game?.actor ?? 0): void => { current = next; ui.update(next, actor) }
  return { ui, host, content, hud, board, document, controller, onChange, onBlock, click, openCards, update, latest: (next: AppViewModel) => { current = next } }
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
  const controller = new AppController('three')
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
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), navigator: { standalone: false } })
  vi.stubGlobal('Element', ElementStub)
  vi.stubGlobal('HTMLElement', ElementStub)
  vi.stubGlobal('Node', ElementStub)
  vi.stubGlobal('HTMLTextAreaElement', ElementStub)
  vi.stubGlobal('HTMLSelectElement', ElementStub)
})

afterEach(() => { resetRasterCardArtLoadFailuresForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Three native markup and decisions', () => {
  it('uses native lobby root, Settings and Recording subviews without duplicating controls', () => {
    const view = { ...makeView(), game: null }
    const html = renderThreeInterface(view, defaultUi)
    for (const mode of ['tutorial', 'local-hvh', 'local-hvai', 'local-aivai', 'adventure-hvai', 'p2p-host', 'p2p-join']) {
      expect(html).toContain(`data-mode="${mode}"`)
      expect(isThreeMode(mode)).toBe(true)
    }
    expect(html).toContain('Install')
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
    expect(html.match(/role="status"/g)).toHaveLength(1)
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
    expect(renderThreeInterface({ ...view, game: null }, defaultUi)).toContain('Resume Adventure')
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
    expect(html).not.toContain('Turn 2 • main phase')
    expect(html).toContain('Turn 3 • main phase')
    expect(html).not.toContain('Legacy line must not duplicate events')
    expect(html.match(/class="three-log-entry"/g)).toHaveLength(200)
    expect(html.match(/class="three-log-visual" aria-hidden="true"/g)).toHaveLength(200)
    expect(html.match(/class="three-sr-only"/g)).toHaveLength(200)
    expect(html).toContain('class="three-log-actor" data-active="false">P2')
    expect(html).toContain('class="three-log-art"')
    expect(html.match(/P2 plays Island/g)).toHaveLength(1)
    expect(html).not.toContain('role="log"')
    expect(html.match(/aria-live="polite"/g)).toHaveLength(1)
    const empty = renderThreeInterface(makeView(), { ...defaultUi, menuOpen: true })
    expect(empty).toContain('No log entries yet.')
  })

  it('places menu/status/winner in the HUD and keeps native controls out of document flow', () => {
    const view = responseView()
    view.game!.winnerText = 'Winner announcement'
    const hud = renderThreeHud(view, defaultUi)
    for (const text of ['☰ Menu', 'Turn 1', 'Player 1', 'Ready', 'Winner announcement']) expect(hud).toContain(text)
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
        expect(html).not.toContain('Respond to Mountain')
        expect(html).not.toContain('class="three-required-prompt"')
        expect(html).toContain(`<p role="status" aria-live="polite">${status}</p>`)
        for (const text of ['☰ Menu', 'Turn 1 · respond', 'Player 1']) expect(html).toContain(text)
      }
    }
  })

  it('groups Forest targets but keeps battlefield copies individually selectable', () => {
    const view = makeView()
    const battlefield = threeTargets(view, { ...defaultUi, pendingCardId: 'source' })!
    expect(battlefield.battlefield).toBe(true)
    expect(battlefield.options).toHaveLength(2)
    expect(renderThreeHud(view, { ...defaultUi, pendingCardId: 'source' }))
      .toContain('<p class="three-required-prompt">Choose Mountain target</p>')
    view.game!.players[0].handCards[0].name = 'Forest'
    view.game!.players[0].graveyardCards = [{ id: 'target-1', name: 'Island' }, { id: 'target-2', name: 'Island' }]
    const targets = threeTargets(view, { ...defaultUi, pendingCardId: 'source' })!
    expect(targets.battlefield).toBe(false)
    expect(targets.options).toEqual([{ cardName: 'Island', label: 'Island X2', effectTargetId: 'target-1', count: 2 }])
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
    expect(renderThreeHud(view, defaultUi)).toContain('<p class="three-required-prompt">Choose Swamp discard target</p>')
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
    expect(renderThreeHud(view, defaultUi)).toContain('<p class="three-required-prompt">Choose Plains reuse target for Mountain</p>')
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
      [responseView(), 'pass_response', 'Pass Response'],
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
    expect(action.prompt).toContain('Respond to Swamp. No legal counter cards available.')
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

  it('preserves Cards dialog scroll on settings updates and closes only after an accepted action', () => {
    const view = makeView()
    view.game!.legal.playLandByCard.source = [view.game!.legal.playLandByCard.source[0]]
    const h = setup(view)
    h.openCards()
    const hand = h.content.querySelector('[data-scroll-key="hand-0"]')!
    hand.scrollLeft = 37
    hand.scrollTop = 19
    h.update({ ...view, cardVisualStyle: 'hd' })
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
    expect(h.host.children[2].innerHTML).toContain('Forest')
    h.update({ ...view, status: 'Saved' })
    expect(h.host.children[2].innerHTML).toContain('Forest')
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
      .toBe('Plains reuses Forest: return a graveyard card to your hand')
    expect(h.content.innerHTML).toContain('Swamp X2')
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
    expect(game.players[actor].handCards).toEqual([{ id: 'grave-1', name: 'Swamp' }])
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
    expect(h.realController.getViewModel().game!.players[0].handCards).toEqual([{ id: 'grave-0', name: 'Island' }])
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
    expect(h.content.innerHTML).toContain('Forest card preview')
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
      expect(dialog.getAttribute('aria-label')).toBe(`${name} card preview`)
      expect(dialog.querySelector('.dom-card__name')).not.toBeNull()
      const image = dialog.querySelector('.dom-card__art-frame')!.querySelector('img')!
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

  it.each(['hd', 'monochrome'] as const)('retains %s fallbacks through preview rerenders and reopening', (style) => {
    const view = makeView()
    view.cardVisualStyle = style
    const h = setup(view)
    h.ui.activate(hit())
    const primary = cardArtUrl('Forest', style)
    const fallback = cardArtFallbackUrl('Forest', style)
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
    next.game!.players[1].battlefield.shift()
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
      ['card-visual-style-select', 'hd', h.controller.setCardVisualStyle],
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
      const h = setup(responseView())
      expect(h.ui.isBlocked()).toBe(false)
      expect(h.content.querySelector('dialog')).toBeNull()
      expect(h.content.querySelector('[data-action="counter_land"]')).toBeNull()
      h.openCards()
      expect(h.ui.isBlocked()).toBe(true)
      expect(h.content.querySelector('dialog')?.dataset.modal).toBe('cards')
      expect(h.content.querySelectorAll('[data-action="respond-card"]')).toHaveLength(3)
      expect(h.content.innerHTML).toContain('Island included automatically')
      expect(h.content.innerHTML).toContain('aria-live="polite"')
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
      view.game!.players[0].handCards.push({ id: 'hidden', name: HIDDEN_HAND_CARD_NAME }, { id: 'ineligible', name: 'Mountain' })
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
      expect(h.ui.primaryAction?.prompt).toContain('No legal counter cards available.')
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
      expect(h.content.innerHTML).toContain('Forest card preview')
      h.click('[data-action="close"]')
      h.openCards()
      h.click('[data-action="preview"][data-zone="hand"][data-card-id="required-island"]')
      expect(h.content.innerHTML).toContain('Island card preview')
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
