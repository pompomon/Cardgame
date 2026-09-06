import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ControllerApi } from '../app/controller'
import { HIDDEN_HAND_CARD_NAME, type AppViewModel } from '../app/types'
import { ThreeInterface } from '../renderers/three/interface'
import {
  canThreeInput,
  isThreeMode,
  renderThreeInterface,
  threeDecisionKey,
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
      pendingLandName: null, pendingPlainsReuseName: null, log: [], events: [], isReplay: false,
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

const defaultUi: InterfaceUi = {
  presentedActor: 0, menuOpen: false, pendingCardId: null, preview: null,
  phaseDismissed: false, hostAnswerDraft: '', joinOfferDraft: '',
}

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
  createElement(tag: string): ElementStub { return new ElementStub(tag, this) }
  addEventListener(name: string, fn: (event: never) => unknown): void { this.listeners.set(name, fn) }
  removeEventListener(name: string): void { this.listeners.delete(name) }
  emit(name: string, event: unknown): unknown { return this.listeners.get(name)?.(event as never) }
}

function setup(view = makeView()) {
  let current = view
  const document = new DocumentStub()
  const host = document.createElement('section')
  document.body.append(host)
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
  const ui = new ThreeInterface(host as unknown as HTMLElement, controller, onChange, onBlock)
  ui.update(view, view.game?.actor ?? 0)
  const content = host.children[0]
  const click = (selector: string): ElementStub => {
    const element = content.querySelector(selector)
    if (!element) throw new Error(`Missing button ${selector}`)
    element.focus()
    host.emit('click', { target: element })
    return element
  }
  const update = (next: AppViewModel, actor = next.game?.actor ?? 0): void => { current = next; ui.update(next, actor) }
  return { ui, host, content, document, controller, onChange, onBlock, click, update, latest: (next: AppViewModel) => { current = next } }
}

beforeEach(() => {
  vi.stubGlobal('navigator', { userAgent: 'node-test', standalone: false })
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), navigator: { standalone: false } })
  vi.stubGlobal('Element', ElementStub)
  vi.stubGlobal('Node', ElementStub)
  vi.stubGlobal('HTMLTextAreaElement', ElementStub)
  vi.stubGlobal('HTMLSelectElement', ElementStub)
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Three native markup and decisions', () => {
  it('exposes every mode and all lobby settings, install and recording controls', () => {
    const view = { ...makeView(), game: null }
    const html = renderThreeInterface(view, defaultUi)
    for (const mode of ['tutorial', 'local-hvh', 'local-hvai', 'local-aivai', 'adventure-hvai', 'p2p-host', 'p2p-join']) {
      expect(html).toContain(`data-mode="${mode}"`)
      expect(isThreeMode(mode)).toBe(true)
    }
    for (const name of ['ai-level-select', 'card-visual-style-select', 'animation-speed-select', 'board-theme-select', 'render-quality-select', 'Install', 'load-recording-file', 'load-recording-local']) expect(html).toContain(name)
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

  it('bounds logs to the latest fourteen and escapes all text', () => {
    const view = makeView()
    view.status = '<script>alert("status")</script>'
    view.game!.log = Array.from({ length: 20 }, (_, index) => `<entry-${index}>`)
    const html = renderThreeInterface(view, defaultUi)
    expect(html).toContain('6 older entries omitted')
    expect(html).not.toContain('&lt;entry-5&gt;')
    expect(html).toContain('&lt;entry-6&gt;')
    expect(html).toContain('&lt;entry-19&gt;')
    expect(html).not.toContain('<script>')
  })

  it('groups Forest targets but keeps battlefield copies individually selectable', () => {
    const view = makeView()
    const battlefield = threeTargets(view, { ...defaultUi, pendingCardId: 'source' })!
    expect(battlefield.battlefield).toBe(true)
    expect(battlefield.options).toHaveLength(2)
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
    expect(renderThreeInterface(view, defaultUi)).toContain('Hidden card')
    expect(renderThreeInterface(view, defaultUi)).not.toContain('Private Swamp name')
    view.game!.phase = 'swamp_target'
    view.game!.legal.swampDiscardOptions = [{ action: { type: 'resolve_swamp_discard', actor: 0, effectTargetId: 'secret' }, label: 'Choose hidden card' }]
    const html = renderThreeInterface(view, defaultUi)
    expect(html).toContain('Private Swamp name')
    expect(html).toContain('data-modal="target"')
    expect(html).toContain('Hidden card')
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

describe('Three native interface behavior', () => {
  it('submits a sole legal action exactly once across duplicate native/board calls', () => {
    const view = makeView()
    view.game!.legal.playLandByCard.source = [view.game!.legal.playLandByCard.source[0]]
    const h = setup(view)
    h.ui.playCard('source')
    h.ui.playCard('source')
    h.click('[data-action="play"]')
    expect(h.controller.submitAction).toHaveBeenCalledExactlyOnceWith(view.game!.legal.playLandByCard.source[0].action)
    h.ui.dispose()
  })

  it('blocks drags, exposes Mountain rings, selects the exact legal target and submits once', () => {
    const h = setup()
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
    h.click('[data-action="play"]')
    expect(h.document.activeElement?.dataset.action).toBe('target')
    h.document.emit('keydown', { key: 'Escape', preventDefault: vi.fn() })
    expect(h.ui.targetIds.size).toBe(0)
    expect(h.controller.submitAction).not.toHaveBeenCalled()
    expect(h.document.activeElement?.dataset.action).toBe('play')
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
    h.click('[data-mode="adventure-hvai"]')
    expect(h.controller.startAdventure).toHaveBeenCalledTimes(1)
    h.click('[data-mode="tutorial"]')
    expect(h.controller.startGame).toHaveBeenCalledExactlyOnceWith('tutorial')
    h.ui.dispose()
  })

  it('uses explicit legal response counter/pass actions without duplicate submissions', () => {
    const view = makeView()
    view.game!.phase = 'respond'
    view.game!.legal.canPassResponse = true
    view.game!.legal.counterOptions = [{ action: { type: 'counter_land', actor: 0, discardCardId: 'source' }, label: 'Counter with Island' }]
    const h = setup(view)
    h.click('[data-action="counter_land"]')
    h.click('[data-action="pass_response"]')
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
