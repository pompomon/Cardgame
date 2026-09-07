import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CanvasTexture, type Group, type Scene } from 'three'
import type { AppState } from '../app/types'
import { buildViewModel } from '../app/view-model'
import { applyAction, createInitialGame, getLegalActions } from '../game/engine'
import type { Card, GameAction } from '../game/types'
import { ThreeBoard } from '../renderers/three/board'
import { boardCardKey } from '../renderers/three/card-registry'
import { threePrimaryAction, threeResponse, type InterfaceUi, type ThreePrimaryAction } from '../renderers/three/interface-model'

const gpu = vi.hoisted(() => ({
  render: vi.fn(), setSize: vi.fn(), setPixelRatio: vi.fn(), dispose: vi.fn(),
  acquireCard: vi.fn(), release: vi.fn(),
}))

vi.mock('three', async (importOriginal) => ({
  ...await importOriginal<typeof import('three')>(),
  WebGLRenderer: class {
    render = gpu.render
    setSize = gpu.setSize
    setPixelRatio = gpu.setPixelRatio
    dispose = gpu.dispose
    setClearColor(): void {}
    forceContextLoss(): void {}
  },
}))

vi.mock('../renderers/three/assets', () => ({
  ThreeAssets: class {
    acquireCard = gpu.acquireCard
    acquireBoard() { return { texture: new CanvasTexture({} as HTMLCanvasElement), release: gpu.release } }
    dispose(): void {}
  },
}))

// Exercise the constructed HTML and its real listeners, with only browser/GPU
// surfaces stubbed (the card registry, layout, presentation and engine are real).
class ElementStub extends EventTarget {
  readonly children: ElementStub[] = []
  readonly dataset: Record<string, string> = {}
  readonly attributes = new Map<string, string>()
  readonly style = { setProperty: vi.fn(), removeProperty: vi.fn(), top: '' }
  parent: ElementStub | null = null
  className = ''
  textContent = ''
  hidden = false
  disabled = false
  tabIndex = 0
  type = ''
  id = ''
  clientWidth = 390
  clientHeight = 760
  readonly tagName: string
  readonly ownerDocument: DocumentStub
  constructor(tagName: string, ownerDocument: DocumentStub) {
    super()
    this.tagName = tagName
    this.ownerDocument = ownerDocument
  }
  get offsetHeight(): number {
    return this.className === 'three-board-label' ? (this.dataset.row === 'near' ? 160 : 52) : 44
  }
  append(...children: ElementStub[]): void {
    children.forEach((child) => { child.parent = this; this.children.push(child) })
  }
  remove(): void {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1)
    this.parent = null
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  getContext(): { isContextLost(): boolean } { return { isContextLost: () => false } }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight } }
  focus(): void {
    const previous = this.ownerDocument.activeElement
    this.ownerDocument.activeElement = this
    if (previous !== this) previous?.dispatchEvent(new Event('blur'))
  }
  all(className: string): ElementStub[] {
    return this.children.flatMap((child) => [
      ...(child.className === className ? [child] : []), ...child.all(className),
    ])
  }
}

class DocumentStub extends EventTarget {
  hidden = false
  activeElement: ElementStub | null = null
  createElement(tag: string): ElementStub { return new ElementStub(tag, this) }
}

class ObserverStub {
  static latest: ObserverStub
  readonly observe = vi.fn()
  readonly disconnect = vi.fn()
  readonly callback: () => void
  constructor(callback: () => void) {
    this.callback = callback
    ObserverStub.latest = this
  }
}

function state(): AppState {
  const deck = (owner: number): Card[] => Array.from({ length: 50 }, (_, i) => ({
    id: `${owner}-${i}`, name: 'Island', type: 'land',
  }))
  return {
    mode: 'local-hvh', renderer: 'three', seed: 53, game: createInitialGame(53, [deck(0), deck(1)]),
    controllers: ['human', 'human'], offer: '', answer: '', status: '', recording: null,
    replay: null, hasSavedRecording: false, aiLevel: 'basic', cardVisualStyle: 'classic',
    animationSpeed: 'normal', boardTheme: 'classic', renderQualityPreference: 'auto',
    p2pStarted: false, pendingP2PStartSeed: null, pendingRematchSeed: null,
    adventure: {
      baseSeed: 0, currentRound: 0, remainingChances: 0, winStreak: 0, totalRoundsPlayed: 0,
      totalCardsPlayed: 0, opponentLineup: [], currentOpponentIndex: 0, activeGameSeed: null,
      status: 'inactive', highScore: 0, hasSavedRun: false,
    },
  }
}

function emit(element: EventTarget, type: string, fields: Record<string, unknown> = {}): Event {
  const event = Object.assign(new Event(type, { cancelable: true }), { button: 0, isPrimary: true }, fields)
  element.dispatchEvent(event)
  return event
}

const boards: ThreeBoard[] = []
function setup() {
  const document = new DocumentStub()
  const window = Object.assign(new EventTarget(), { innerWidth: 390, devicePixelRatio: 1 })
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', window)
  const host = document.createElement('section')
  const cancel = vi.fn()
  const activate = vi.fn<(action: ThreePrimaryAction) => void>()
  const board = new ThreeBoard(host as unknown as HTMLElement, vi.fn(), cancel, activate)
  boards.push(board)
  const app = state()
  const ui: InterfaceUi = {
    presentedActor: 0, menuOpen: false, preview: null, pendingCardId: null,
    phaseDismissed: false, hostAnswerDraft: '', joinOfferDraft: '',
  }
  const present = (changes: Partial<InterfaceUi> = {}, replay = false) => {
    const view = buildViewModel(app, false)
    if (replay) { view.replay.active = true; view.game!.isReplay = true }
    const nextUi = { ...ui, presentedActor: view.game!.actor, ...changes }
    const primary = threePrimaryAction(view, nextUi)
    board.render(view, nextUi.presentedActor, new Set(), threeResponse(view, nextUi), primary)
    return primary
  }
  const act = (type: GameAction['type']) => {
    const view = buildViewModel(app, false)
    const action = getLegalActions(app.game!, view.game!.actor).find((entry) => entry.type === type)!
    expect(action).toBeDefined()
    app.game = applyAction(app.game!, action)
    return present()
  }
  present()
  const headers = host.all('three-board-label')
  const near = headers.find((entry) => entry.dataset.row === 'near')!
  const far = headers.find((entry) => entry.dataset.row === 'far')!
  const button = host.all('three-board-primary')[0]
  const scene = gpu.render.mock.calls[0][0] as Scene
  const cards = scene.children.find((entry) => entry.type === 'Group') as Group
  return { app, board, host, document, window, button, near, far, cards, activate, cancel, present, act }
}

beforeEach(() => {
  vi.clearAllMocks()
  gpu.acquireCard.mockImplementation(() => ({ texture: new CanvasTexture({} as HTMLCanvasElement), release: gpu.release }))
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('ResizeObserver', ObserverStub)
})
afterEach(() => {
  boards.splice(0).forEach((board) => board.dispose())
  vi.unstubAllGlobals()
})

describe('constructed Three battlefield controls', () => {
  it('renders both summaries outside the lower controls and updates after plays, counters and draws', () => {
    const h = setup()
    const stats = (header: ElementStub) => header.all('three-board-stats')[0]
    expect(stats(h.near).textContent).toBe('Hand 5 · Deck 45 · Graveyard 0')
    expect(stats(h.far).getAttribute('aria-label')).toBe('Player 2: Hand 5 · Deck 45 · Graveyard 0')
    expect(h.host.all('three-board-primary')).toHaveLength(1)
    expect(h.button.parent).toBe(h.near)
    expect(h.button.textContent).toBe('End Turn')
    h.act('play_land')
    expect(h.button.textContent).toBe('Pass Response')
    expect(stats(h.far).textContent).toBe('Hand 4 · Deck 45 · Graveyard 0')
    expect(stats(h.near).getAttribute('aria-label')).toBe('Player 2: Hand 5 · Deck 45 · Graveyard 0')
    expect(h.near.dataset.active).toBe('true')
    h.act('counter_land')
    expect(stats(h.near).textContent).toBe('Hand 4 · Deck 45 · Graveyard 1')
    expect(stats(h.far).textContent).toBe('Hand 3 · Deck 45 · Graveyard 2')
    h.act('end_turn')
    expect(stats(h.near).textContent).toBe('Hand 4 · Deck 44 · Graveyard 2')
    expect(stats(h.far).getAttribute('aria-label')).toBe('Player 1: Hand 4 · Deck 45 · Graveyard 1')
  })

  it('retains the canvas, button, meshes and textures across count and phase updates', () => {
    const h = setup()
    const canvas = h.board.canvas
    const groups = [...h.cards.children]
    const acquisitions = gpu.acquireCard.mock.calls.length
    h.app.status = 'Saved'
    h.present()
    expect(h.cards.children).toEqual(groups)
    h.app.game!.players[0].graveyard.push({ id: 'discard', name: 'Mountain', type: 'land' })
    h.present()
    expect(h.cards.children).toEqual(groups)
    expect(gpu.acquireCard).toHaveBeenCalledTimes(acquisitions)
    h.act('play_land')
    h.act('pass_response')
    expect(h.button).toBe(h.host.all('three-board-primary')[0])
    expect(h.board.canvas).toBe(canvas)
    expect(h.cards.children).toContain(groups[1])
    expect(h.button.textContent).toBe('End Turn')
  })

  it('keeps stack silhouettes accurate without duplicating their accessible count labels', () => {
    const h = setup()
    const stacks = h.near.all('three-board-stack')
    expect(stacks.map((stack) => stack.textContent)).toEqual(['Deck 45', 'GY 0'])
    expect(stacks[0].dataset.empty).toBe('false')
    expect(stacks[1].dataset.empty).toBe('true')
    expect(h.near.all('three-board-stacks')[0].getAttribute('aria-hidden')).toBe('true')
    h.app.game!.players[0].graveyard.push({ id: 'discard', name: 'Forest', type: 'land' })
    h.present()
    expect(h.near.all('three-board-stack')).toEqual(stacks)
    expect(stacks[1].textContent).toBe('GY 1')
    expect(stacks[1].dataset.empty).toBe('false')
  })

  it('suppresses drop input behind overlays but keeps paginated battlefield targets discoverable', () => {
    const h = setup()
    h.app.game!.players[1].battlefield = Array.from({ length: 8 }, (_, index) => ({
      instanceId: `target-${index}`, card: { id: `land-${index}`, name: 'Forest', type: 'land' },
    }))
    const view = buildViewModel(h.app, false)
    const primary = threePrimaryAction(view, {
      presentedActor: 0, menuOpen: false, preview: null, pendingCardId: '0-0',
      phaseDismissed: false, hostAnswerDraft: '', joinOfferDraft: '',
    })
    h.board.render(view, 0, new Set(['target-0', 'target-7']), null, primary, true)
    expect(h.board.containsDrop(195, 380)).toBe(false)
    expect(h.far.parent!.all('three-board-target-label')).toHaveLength(1)
    expect(h.host.all('three-board-target-pages').some((entry) => entry.textContent.includes('Targets: page 1, 2'))).toBe(true)
    h.board.render(view, 0, new Set(), null, primary, true)
    expect(h.host.all('three-board-target-label')).toHaveLength(0)
    expect(h.host.all('three-board-target-pages').every((entry) => entry.hidden)).toBe(true)
  })

  it.each([
    ['play_land', 'Land played'], ['forest_return', 'Forest returned'],
    ['swamp_discard', 'Swamp discard'], ['mountain_destroy', 'Mountain destroyed a land'],
    ['plains_reuse', 'Plains reused a land'], ['counter_resolved', 'Counter resolved'],
  ] as const)('announces %s separately from controller status and releases it once', (kind, label) => {
    const h = setup()
    h.app.status = 'Storage unavailable'
    h.present()
    const done = vi.fn()
    const cancel = h.board.playEffect({
      kind, actor: 0, targetActor: 1, land: 'Forest', visualStyle: 'classic',
      palette: { primary: '#123456', secondary: '#abcdef', glow: '#ffffff' },
    }, 150, done)
    const caption = h.host.all('three-board-effect-caption')[0]
    expect(caption.textContent).toBe(label)
    expect(caption.hidden).toBe(false)
    expect(caption.getAttribute('aria-live')).toBe('polite')
    expect(h.app.status).toBe('Storage unavailable')
    cancel()
    cancel()
    expect(caption.hidden).toBe(true)
    expect(done).toHaveBeenCalledOnce()
  })

  it('stops cosmetic work while hidden and leaves animation-off rendering idle', () => {
    const h = setup()
    const done = vi.fn()
    h.board.playEffect({
      kind: 'play_land', actor: 0, land: 'Forest', visualStyle: 'classic',
      palette: { primary: '#123456', secondary: '#abcdef', glow: '#ffffff' },
    }, 350, done)
    h.document.hidden = true
    h.document.dispatchEvent(new Event('visibilitychange'))
    expect(done).toHaveBeenCalledOnce()
    expect(cancelAnimationFrame).toHaveBeenCalled()
    expect(h.host.all('three-board-effect-caption')[0].hidden).toBe(true)
    h.app.animationSpeed = 'off'
    h.present()
    h.document.hidden = false
    h.document.dispatchEvent(new Event('visibilitychange'))
    const frame = vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0]
    const scheduled = vi.mocked(requestAnimationFrame).mock.calls.length
    frame(1000)
    expect(vi.mocked(requestAnimationFrame).mock.calls).toHaveLength(scheduled)
  })

  it('keeps counts including zero during game over and replay, without gameplay actions', () => {
    const h = setup()
    h.app.game!.players[1].deck = []
    h.app.game!.players[1].hand = []
    h.act('end_turn')
    expect(h.app.game!.phase).toBe('gameOver')
    expect(h.button.hidden).toBe(true)
    expect(h.near.all('three-board-stats')[0].textContent).toBe('Hand 0 · Deck 0 · Graveyard 0')
    h.app.game = createInitialGame(53)
    h.present({}, true)
    expect(h.button.hidden).toBe(true)
    expect(h.near.all('three-board-stats')[0].hidden).toBe(false)
    h.present()
    expect(h.button.hidden).toBe(false)
  })

  it('preserves focus on updates and moves it to the battlefield when the action disappears', () => {
    const h = setup()
    h.button.focus()
    h.present()
    expect(h.document.activeElement).toBe(h.button)
    h.present({ menuOpen: true })
    expect(h.button.disabled).toBe(true)
    expect(h.document.activeElement).toBe(h.near.children[0].children[0])
    h.present()
    h.button.focus()
    h.present({}, true)
    expect(h.document.activeElement).toBe(h.near.children[0].children[0])
  })

  it('reserves drag feedback space without exposing duplicate instructions to assistive technology', () => {
    const h = setup()
    const sizes = h.host.all('three-board-instruction-size')
    const prompt = h.host.all('three-board-instruction')[0]
    expect(sizes.map((entry) => entry.textContent)).toEqual([
      'Drag a highlighted card into your battlefield',
      'Move into your battlefield · release elsewhere to cancel',
    ])
    for (const size of sizes) {
      expect(size.getAttribute('aria-hidden')).toBe('true')
      expect(size.hidden).toBe(false)
    }
    expect(h.button.getAttribute('aria-describedby')).toBe(prompt.id)
    h.board.beginDrag({
      key: boardCardKey('0-0', 0), cardId: '0-0', owner: 0, zone: 'hand', name: 'Island', playable: true,
    })
    h.board.moveDrag(0, 0, false)
    expect(prompt.children[0].textContent).toBe(sizes[1].textContent)
    expect(h.host.all('three-board-instruction-size')).toEqual(sizes)
    h.board.endDrag(false)
    expect(prompt.children[0].textContent).toBe(sizes[0].textContent)
    h.act('play_land')
    expect(prompt.children[0].textContent).toContain('Respond to Island.')
    expect(sizes.every((entry) => entry.hidden)).toBe(true)
  })

  it('keeps invisible prompt sizes in the same grid cell instead of collapsing their layout', () => {
    const css = readFileSync(join(__dirname, '..', 'renderers', 'three', 'graphics.css'), 'utf8')
    expect(css).toMatch(/\.three-board-instruction\s*\{[^}]*display:\s*grid;/)
    expect(css).toMatch(/\.three-board-instruction > span\s*\{\s*grid-area:\s*1 \/ 1;/)
    expect(css).toMatch(/\.three-board-instruction-size\s*\{\s*visibility:\s*hidden;/)
  })

  it.each(['pointerdown', 'keydown'])('passes the captured decision through %s, not the next decision', (type) => {
    const h = setup()
    const original = h.present()!
    emit(h.button, type, { key: ' ', repeat: false })
    h.act('end_turn')
    emit(h.button, 'click')
    expect(h.activate).toHaveBeenCalledExactlyOnceWith(original)
    expect(h.cancel).toHaveBeenCalledOnce()
  })

  it('does not turn an Enter auto-repeat into another decision', () => {
    const h = setup()
    emit(h.button, 'keydown', { key: 'Enter', repeat: false })
    emit(h.button, 'click')
    h.act('end_turn')
    h.activate.mockClear()
    const repeat = emit(h.button, 'keydown', { key: 'Enter', repeat: true })
    expect(repeat.defaultPrevented).toBe(true)
    if (!repeat.defaultPrevented) emit(h.button, 'click')
    expect(h.activate).not.toHaveBeenCalled()
  })

  it.each([{ button: 0, isPrimary: false }, { button: 2, isPrimary: true }])('ignores unrelated pointer presses (%j)', (fields) => {
    const h = setup()
    const original = h.present()!
    emit(h.button, 'pointerdown', { button: 0, isPrimary: true })
    h.act('end_turn')
    emit(h.button, 'pointerdown', fields)
    emit(h.button, 'click')
    expect(h.activate).toHaveBeenCalledExactlyOnceWith(original)
  })

  it('supports a new activation after cancellation and removes listeners and observers on disposal', () => {
    const h = setup()
    emit(h.button, 'pointerdown')
    emit(h.button, 'pointercancel')
    h.act('end_turn')
    const current = h.present()!
    emit(h.button, 'pointerdown')
    emit(h.button, 'click')
    expect(h.activate).toHaveBeenCalledExactlyOnceWith(current)
    h.board.dispose()
    h.board.dispose()
    emit(h.button, 'click')
    emit(h.window, 'resize')
    expect(h.activate).toHaveBeenCalledOnce()
    expect(h.host.children).toHaveLength(0)
    expect(ObserverStub.latest.disconnect).toHaveBeenCalledOnce()
    expect(gpu.dispose).toHaveBeenCalledOnce()
    expect(h.host.style.removeProperty).toHaveBeenCalledWith('--three-board-min-height')
  })
})
