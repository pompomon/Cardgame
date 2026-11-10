import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CanvasTexture, type Group, type Mesh, type MeshBasicMaterial, type Scene } from 'three'
import { createInactiveAdventureState } from '../app/adventure'
import type { AppState } from '../app/types'
import type { VisualEffectDescriptor } from '../app/visual-effects'
import { buildViewModel } from '../app/view-model'
import { applyAction, createInitialGame, getLegalActions } from '../game/engine'
import { BASIC_LANDS, type Card, type GameAction } from '../game/types'
import { ThreeBoard } from '../renderers/three/board'
import { boardCardKey, type ThreeCardRegistry } from '../renderers/three/card-registry'
import {
  NO_BOARD_SELECTION, THREE_DOCK_PROMPT_ID, type ThreeBoardPresentation, type ThreeDragFeedback,
} from '../renderers/three/contracts'
import { ThreeInteraction } from '../renderers/three/interaction'
import { threePrimaryAction, threeResponse, type InterfaceUi, type ThreePrimaryAction } from '../renderers/three/interface-model'
import {
  cardSlotX, narrowHandPageSize, peekPlacement, pendingCardRect, TOUCH_DRAG_SCALE, typeSlotX, type LayerRect, type PeekPlacement,
  type ThreeLayout, type ThreeShellProfile,
} from '../renderers/three/layout'
import { withFakeTimers } from './helpers/timers'

const gpu = vi.hoisted(() => ({
  render: vi.fn(), setSize: vi.fn(), setPixelRatio: vi.fn(), dispose: vi.fn(),
  acquireCard: vi.fn(), release: vi.fn(),
  /** The board's callback for finished artwork, as the real asset cache calls it. */
  assetsChanged: (): void => {},
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

vi.mock('../renderers/three/assets', async (importOriginal) => ({
  ...await importOriginal<typeof import('../renderers/three/assets')>(),
  ThreeAssets: class {
    constructor(invalidate: () => void) {
      gpu.assetsChanged = invalidate
    }
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
  readonly style = {
    setProperty: vi.fn(), removeProperty: vi.fn(), left: '', top: '', right: '', bottom: '', width: '', maxWidth: '', height: '', maxHeight: '',
  }
  parent: ElementStub | null = null
  className = ''
  textContent = ''
  hidden = false
  disabled = false
  tabIndex = 0
  type = ''
  id = ''
  title = ''
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
    // Live headers and their hidden sizers share the same header metrics.
    if (!this.className.split(' ').includes('three-board-label')) return 44
    const base = this.dataset.row === 'near' ? 112 : 52
    const prompt = this.children.find((child) => child.className === 'three-board-instruction')
    if (!prompt || prompt.hidden) return base
    return base + (prompt.children[0]?.textContent.length > 80 ? 112 : 44)
  }
  append(...children: ElementStub[]): void {
    children.forEach((child) => { child.remove(); child.parent = this; this.children.push(child) })
  }
  remove(): void {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1)
    this.parent = null
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  /** Opt-in 2D context for the drag layer; set before `setup()`, which constructs the layer. */
  static context2d: object | null = null
  getContext(type?: string): unknown {
    return type === '2d' && ElementStub.context2d ? ElementStub.context2d : { isContextLost: () => false }
  }
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
    mode: 'local-hvh', seed: 53, game: createInitialGame(53, [deck(0), deck(1)]),
    controllers: ['human', 'human'], offer: '', answer: '', status: '', recording: null,
    replay: null, hasSavedRecording: false, aiLevel: 'basic', cardVisualStyle: 'classic',
    monochromeCards: false, animationSpeed: 'normal', boardTheme: 'classic', renderQualityPreference: 'auto',
    p2pStarted: false, pendingP2PStartSeed: null, pendingRematchSeed: null,
    adventure: createInactiveAdventureState(),
  }
}

function emit(element: EventTarget, type: string, fields: Record<string, unknown> = {}): Event {
  const event = Object.assign(new Event(type, { cancelable: true }), { button: 0, isPrimary: true }, fields)
  element.dispatchEvent(event)
  return event
}

function counterEffect(actor: number, discard: 'Island' | 'Mountain' = 'Mountain'): VisualEffectDescriptor {
  return {
    kind: 'counter_resolved',
    actor,
    land: 'Island',
    counterCards: ['Island', discard],
    visualStyle: 'classic',
    palette: { primary: '#123456', secondary: '#abcdef', glow: '#ffffff' },
  }
}

// Typed as the union, so a test can move one presentation between shells.
const NARROW = 'narrow' as ThreeShellProfile
const DESKTOP = 'desktop' as ThreeShellProfile

const boards: ThreeBoard[] = []
function setup(presentation: ThreeBoardPresentation = { shell: DESKTOP, selection: NO_BOARD_SELECTION }) {
  const document = new DocumentStub()
  const window = Object.assign(new EventTarget(), { innerWidth: 390, devicePixelRatio: 1 })
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', window)
  const host = document.createElement('section')
  const cancel = vi.fn()
  const activate = vi.fn<(action: ThreePrimaryAction) => void>()
  const dock = document.createElement('section')
  const handPage = vi.fn()
  const feedback = vi.fn<(feedback: ThreeDragFeedback | null) => void>()
  const board = new ThreeBoard(host as unknown as HTMLElement, vi.fn(), cancel, activate,
    dock as unknown as HTMLElement, () => presentation, handPage, feedback)
  boards.push(board)
  const app = state()
  const ui: InterfaceUi = {
    presentedActor: 0, menuOpen: false, cardsOpen: false, preview: null, pendingCardId: null,
    previewReturnToCards: false,
    phaseDismissed: false, hostAnswerDraft: '', joinOfferDraft: '',
  }
  const present = (
    changes: Partial<InterfaceUi> = {}, replay = false, replayStep = 0, targets = new Set<string>(), blocked = false,
  ) => {
    const view = buildViewModel(app, false)
    if (replay) {
      view.replay.active = true
      view.replay.step = replayStep
      view.game!.isReplay = true
    }
    const nextUi = { ...ui, presentedActor: view.game!.actor, ...changes }
    const primary = threePrimaryAction(view, nextUi)
    board.render(view, nextUi.presentedActor, targets, threeResponse(view, nextUi), primary, blocked)
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
  const button = host.all('three-board-primary')[0] ?? dock.all('three-board-primary')[0]
  const scene = gpu.render.mock.calls[0][0] as Scene
  const cards = scene.children.find((entry) => entry.type === 'Group') as Group
  const pending = () => cards.children.find((entry) => entry.name === 'pending-land-play')
  const registry = (board as unknown as { cards: ThreeCardRegistry }).cards
  return { app, board, host, dock, scene, registry, document, window, button, near, far, cards, pending, activate, cancel, handPage, feedback, present, act }
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
  ElementStub.context2d = null
  vi.unstubAllGlobals()
})

describe('constructed Three battlefield controls', () => {
  it('docks the narrow primary button, preserves focus when unfolding, and removes its listeners on disposal', () => {
    const presentation = { shell: NARROW, selection: NO_BOARD_SELECTION }
    const h = setup(presentation)
    expect(h.button.parent).toBe(h.dock)
    expect(h.button.getAttribute('aria-describedby')).toBe(THREE_DOCK_PROMPT_ID)
    expect(h.button.textContent).toBe('End Turn')
    emit(h.button, 'click')
    expect(h.activate).toHaveBeenCalledExactlyOnceWith(h.present())
    h.button.focus()
    presentation.shell = 'desktop'
    h.present()
    expect(h.button.parent).toBe(h.near)
    expect(h.document.activeElement).toBe(h.button)
    expect(h.button.getAttribute('aria-describedby')).toBe('three-battlefield-prompt')
    presentation.shell = 'narrow'
    h.present()
    expect(h.button.parent).toBe(h.dock)
    h.board.dispose()
    h.board.dispose()
    emit(h.button, 'click')
    expect(h.activate).toHaveBeenCalledTimes(1)
    expect(h.dock.children).toHaveLength(0)
    expect(h.host.children).toHaveLength(0)
  })

  it('orders narrow type stacks by target then selection, updates badges and ghosts, and clears them on profile and session changes', () => {
    const presentation = { shell: NARROW, selection: { cardId: null, targetId: 'target-0', discardId: null } }
    const h = setup(presentation)
    h.app.game!.players[1].battlefield = Array.from({ length: 3 }, (_, index) => ({
      instanceId: `target-${index}`, card: { id: `card-${index}`, name: 'Forest', type: 'land' },
    }))
    const targets = new Set(['target-0', 'target-1'])
    h.present({}, false, 0, targets)
    const cards = Array.from({ length: 3 }, (_, index) =>
      h.registry.get(boardCardKey(`card-${index}`, 1, `target-${index}`))!)
    expect(cards.map((card) => card.descriptor.stackIndex)).toEqual([2, 1, 0])
    expect(new Set(cards.map((card) => card.descriptor.x)).size).toBe(1)
    expect(cards.map((card) => card.descriptor.target)).toEqual([true, false, false])
    expect(cards[0].descriptor.selected).toBe(true)
    const frame = cards[0].group.children[1] as Group
    expect(frame.visible).toBe(true)
    expect(((frame.children[0] as Mesh).material as MeshBasicMaterial).color.getHexString()).toBe('ffffff')
    expect(frame.children[0].scale.y).toBe(4)
    expect(h.host.all('three-board-count').map((badge) => badge.textContent)).toEqual(['×3'])
    const ghosts = h.scene.children.filter((entry) => entry.name === 'three-type-slot')
    expect(ghosts.filter((ghost) => ghost.visible)).toHaveLength(9)
    h.app.game!.players[1].battlefield = h.app.game!.players[1].battlefield.slice(0, 1)
    h.present({}, false, 0, targets)
    expect(h.host.all('three-board-count')).toHaveLength(0)
    presentation.shell = 'desktop'
    h.present({}, false, 0, targets)
    expect(cards[0].descriptor.selected).toBeUndefined()
    expect(ghosts.every((ghost) => !ghost.visible)).toBe(true)
    presentation.shell = 'narrow'
    h.present()
    h.app.game = null
    h.board.render(buildViewModel(h.app, false), 0, new Set(), null, null)
    expect(ghosts.every((ghost) => !ghost.visible)).toBe(true)
    expect(h.cards.children).toHaveLength(0)
    const dispose = vi.spyOn((ghosts[0] as Mesh).material as MeshBasicMaterial, 'dispose')
    h.board.dispose()
    expect(dispose).toHaveBeenCalledOnce()
    expect(h.scene.children).toHaveLength(0)
  })

  it.each(['cardId', 'discardId'] as const)('lifts and frames the narrow hand %s selection, then clears it when input ends', (field) => {
    const presentation = { shell: NARROW, selection: { cardId: null as string | null, targetId: null, discardId: null as string | null } }
    const h = setup(presentation)
    const id = h.app.game!.players[0].hand[0].id
    const card = h.registry.get(boardCardKey(id, 0))!
    const originalY = card.descriptor.y
    presentation.selection[field] = id
    h.present()
    expect(card.descriptor.y).toBeGreaterThan(originalY)
    expect(card.descriptor.stackIndex).toBe(1000)
    expect(card.descriptor.selected).toBe(true)
    const frame = card.group.children[1] as Group
    expect(((frame.children[0] as Mesh).material as MeshBasicMaterial).color.getHexString()).toBe('ffffff')
    h.present({}, true)
    const replayCard = h.registry.get(boardCardKey(id, 0))!
    expect(replayCard.descriptor.selected).toBeUndefined()
    expect(replayCard.descriptor.y).toBe(originalY)
    expect(replayCard.group.children[1].visible).toBe(false)
  })

  it('pages all fifty narrow hand cards with full hit targets and clamps or resets the page when the hand or actor changes', () => {
    const h = setup({ shell: NARROW, selection: NO_BOARD_SELECTION })
    const stage = h.host.all('three-board-stage')[0]
    stage.clientWidth = 344
    stage.clientHeight = 655
    const player = h.app.game!.players[0]
    player.hand.push(...player.deck.splice(0))
    h.present()
    const pagination = h.host.all('three-board-pagination')[0]
    const [previous, label, next] = pagination.children
    const seen = new Set<string>()
    const visit = () => {
      for (const card of player.hand) {
        const retained = h.registry.get(boardCardKey(card.id, 0))
        if (!retained?.descriptor.visible) continue
        const { x, y, width } = retained.descriptor
        expect(width).toBeGreaterThanOrEqual(44)
        const bounds = h.board.canvas.getBoundingClientRect()
        expect(h.board.hitTest(
          (stage.clientWidth / 2 + x) / stage.clientWidth * bounds.width,
          (stage.clientHeight / 2 - y) / stage.clientHeight * bounds.height,
        )?.cardId).toBe(card.id)
        seen.add(card.id)
      }
    }
    expect(previous.disabled).toBe(true)
    expect(pagination.hidden).toBe(false)
    do {
      visit()
      if (next.disabled) break
      emit(next, 'click')
    } while (true)
    expect(seen.size).toBe(50)
    const pageTurns = h.handPage.mock.calls.length
    expect(pageTurns).toBeGreaterThan(0)
    expect(previous.disabled).toBe(false)
    emit(previous, 'click')
    expect(h.handPage).toHaveBeenCalledTimes(pageTurns + 1)
    expect(next.disabled).toBe(false)
    const oldPage = label.textContent
    h.app.status = 'Status only'
    h.present()
    expect(label.textContent).toBe(oldPage)
    player.hand = player.hand.slice(0, 5)
    h.present()
    expect(pagination.hidden).toBe(true)
    expect(label.textContent).toBe('1/1')
    h.present({ presentedActor: 1 })
    expect(previous.disabled).toBe(true)
    h.board.dispose()
    const text = label.textContent
    emit(next, 'click')
    expect(label.textContent).toBe(text)
    expect(h.handPage).toHaveBeenCalledTimes(pageTurns + 1)
  })

  it('extends the narrow canvas inside its scrolling stage on short viewports and restores its height on unfold', () => {
    const presentation = { shell: NARROW, selection: NO_BOARD_SELECTION }
    const h = setup(presentation)
    const stage = h.host.all('three-board-stage')[0]
    stage.clientWidth = 344
    stage.clientHeight = 200
    h.present()
    // Reserve minimum touch widths as well as the 216px of measured header chrome.
    expect(h.board.canvas.style.height).toBe('466px')
    expect(h.near.style.height).toBe('112px')
    expect(stage.dataset.scrollable).toBe('true')
    expect(h.near.title).toBe('Swipe this player header to scroll the board')
    const css = readFileSync(join(__dirname, '..', 'renderers', 'three', 'graphics.css'), 'utf8')
    expect(css).toMatch(/\[data-scrollable="true"\] \.three-board-label\s*\{[^}]*pointer-events: auto;[^}]*touch-action: pan-y;/)
    const id = h.app.game!.players[0].hand[0].id
    expect(h.registry.get(boardCardKey(id, 0))!.descriptor.width).toBeGreaterThanOrEqual(44)
    presentation.shell = 'desktop'
    h.present()
    expect(h.board.canvas.style.height).toBe('')
    expect(stage.dataset.scrollable).toBe('false')
    expect(h.near.title).toBe('')
  })

  describe.each(['cardId', 'discardId'] as const)('responsive narrow %s selection', (field) => {
    it.each(['width', 'height'] as const)('follows a selection to its page after a %s resize, then resets for a new actor', (dimension) => {
      const presentation = { shell: NARROW, selection: { ...NO_BOARD_SELECTION } }
      const h = setup(presentation)
      const player = h.app.game!.players[0]
      player.hand.push(...player.deck.splice(0))
      if (field === 'discardId') {
        h.app.game!.currentPlayer = 1
        h.act('play_land')
      }
      for (const sizer of h.host.all('three-board-label three-board-sizer')) {
        Object.defineProperty(sizer, 'offsetHeight', { value: sizer.dataset.row === 'hand' ? 50 : 36 })
      }
      const stage = h.host.all('three-board-stage')[0]
      const label = h.host.all('three-board-pagination')[0].children[1]
      const page = () => Number(label.textContent.split('/')[0]) - 1
      // Inner stages for 430/344x770 viewports, after the narrow shell.
      const grow = () => {
        stage.clientWidth = dimension === 'width' ? 418 : 332
        stage.clientHeight = 583.25
      }
      const shrink = () => {
        if (dimension === 'width') stage.clientWidth = 332
        else stage.clientHeight = 468.25 // 344x655 viewport.
        if (dimension === 'width') emit(h.window, 'resize')
        else ObserverStub.latest.callback()
      }
      grow()
      h.present()
      const layout = () => (h.board as unknown as { layout: ThreeLayout }).layout
      const pageSize = narrowHandPageSize(layout())
      const id = player.hand[pageSize - 1].id
      presentation.selection[field] = id
      h.present()
      expect(page()).toBe(0)
      expect(h.registry.get(boardCardKey(id, 0))!.descriptor.selected).toBe(true)
      shrink()
      const smaller = narrowHandPageSize(layout())
      expect(smaller).toBeLessThan(pageSize)
      const followed = Math.floor((pageSize - 1) / smaller)
      expect(followed).toBeGreaterThan(0)
      // The page follows the card, so it stays on screen and selected.
      expect(page()).toBe(followed)
      expect(h.registry.get(boardCardKey(id, 0))!.descriptor).toMatchObject({ visible: true, selected: true })
      expect(h.handPage).not.toHaveBeenCalled()
      expect(presentation.selection[field]).toBe(id)
      // Repeated observers and status-only updates keep the page.
      ObserverStub.latest.callback()
      h.app.status = 'Status only'
      h.present()
      expect(page()).toBe(followed)
      // Growing back follows the card to the first page again.
      grow()
      ObserverStub.latest.callback()
      expect(page()).toBe(0)
      // Without a selection, a smaller page keeps the current page's first card in view.
      presentation.selection = { ...NO_BOARD_SELECTION }
      h.present()
      emit(h.host.all('three-board-pagination')[0].children[2], 'click')
      expect(page()).toBe(1)
      h.handPage.mockClear()
      shrink()
      expect(page()).toBe(Math.floor(pageSize / smaller))
      expect(h.handPage).not.toHaveBeenCalled()
      // A new acting player still starts on the first page instead of
      // following; a stale selection left elsewhere is reported for clearing.
      presentation.selection = { ...NO_BOARD_SELECTION, [field]: id }
      h.present({ presentedActor: 1 })
      expect(h.handPage).not.toHaveBeenCalled()
      h.present({ presentedActor: 0 })
      expect(page()).toBe(0)
      expect(h.handPage).toHaveBeenCalledOnce()
    })
  })

  it('follows the selection to its page when the narrow profile returns', () => {
    const presentation = { shell: NARROW, selection: { ...NO_BOARD_SELECTION } }
    const h = setup(presentation)
    const player = h.app.game!.players[0]
    player.hand.push(...player.deck.splice(0))
    const stage = h.host.all('three-board-stage')[0]
    stage.clientWidth = 332
    stage.clientHeight = 583.25
    h.present()
    const pageSize = narrowHandPageSize((h.board as unknown as { layout: ThreeLayout }).layout)
    const id = player.hand[2 * pageSize].id
    presentation.shell = 'desktop'
    h.present()
    // The wide profile shows no selection; the narrow one follows it to its page.
    presentation.selection = { ...NO_BOARD_SELECTION, cardId: id }
    presentation.shell = 'narrow'
    h.present()
    expect(h.host.all('three-board-pagination')[0].children[1].textContent).toMatch(/^3\//)
    expect(h.registry.get(boardCardKey(id, 0))!.descriptor).toMatchObject({ visible: true, selected: true })
    expect(h.handPage).not.toHaveBeenCalled()
  })

  it('keeps the selection on its page and cancels a live drag when folding between touch shells', () => {
    const presentation = { shell: NARROW, selection: { ...NO_BOARD_SELECTION } }
    const h = setup(presentation)
    const player = h.app.game!.players[0]
    player.hand.push(...player.deck.splice(0))
    for (const sizer of h.host.all('three-board-label three-board-sizer')) {
      Object.defineProperty(sizer, 'offsetHeight', { value: sizer.dataset.row === 'hand' ? 22 : 21 })
    }
    const stage = h.host.all('three-board-stage')[0]
    const [, label, next] = h.host.all('three-board-pagination')[0].children
    const layout = () => (h.board as unknown as { layout: ThreeLayout }).layout
    // Inner stages of the Fold4 cover portrait, main portrait and main landscape Chrome tabs.
    const COVER = [332, 583.25] as const
    const MAIN_PORTRAIT = [678, 546.5] as const
    const MAIN_LANDSCAPE = [597.46, 506] as const
    const fold = (shell: ThreeShellProfile, size: readonly [number, number]) => {
      [stage.clientWidth, stage.clientHeight] = size
      presentation.shell = shell
      h.present()
    }
    fold(NARROW, COVER)
    const coverPageSize = narrowHandPageSize(layout())
    // Page to the last card, as a player would, and select it there.
    while (!next.disabled) emit(next, 'click')
    const card = player.hand.at(-1)!
    presentation.selection = { ...NO_BOARD_SELECTION, cardId: card.id }
    h.present()
    expect(h.registry.get(boardCardKey(card.id, 0))!.descriptor).toMatchObject({ visible: true, selected: true })
    h.handPage.mockClear()
    const pageSizes: number[] = []
    // The first fold keeps the cover stage and so the page size: only the
    // shell switch itself can move the page to the selection.
    for (const [shell, size] of [
      ['dock', COVER], ['rail', MAIN_LANDSCAPE], ['narrow', COVER], ['rail', MAIN_LANDSCAPE], ['dock', MAIN_PORTRAIT],
    ] as const) {
      h.board.beginDrag({ key: boardCardKey(card.id, 0), cardId: card.id, owner: 0, zone: 'hand', name: card.name, playable: true })
      expect(h.feedback).toHaveBeenLastCalledWith({ cardId: card.id, accepted: false })
      h.cancel.mockClear()
      fold(shell, size)
      expect(stage.dataset.layout).toBe(shell)
      // Folding cancels the gesture without submitting it.
      expect(h.cancel).toHaveBeenCalled()
      expect(h.feedback).toHaveBeenLastCalledWith(null)
      expect(stage.dataset.dragging).toBeUndefined()
      // The selection stays lifted on the page that now holds it.
      const pageSize = narrowHandPageSize(layout())
      pageSizes.push(pageSize)
      const pages = Math.ceil(player.hand.length / pageSize)
      expect(pages).toBeGreaterThan(1)
      expect(label.textContent).toBe(`${pages}/${pages}`)
      expect(h.registry.get(boardCardKey(card.id, 0))!.descriptor).toMatchObject({ visible: true, selected: true })
      expect(h.button.parent).toBe(h.dock)
    }
    expect(pageSizes[0]).toBe(coverPageSize)
    expect(new Set(pageSizes).size).toBeGreaterThan(1)
    expect(h.handPage).not.toHaveBeenCalled()
    expect(h.activate).not.toHaveBeenCalled()
  })

  it('keeps the browsed page without a selection between touch shells, but not through the desktop', () => {
    const presentation = { shell: NARROW, selection: { ...NO_BOARD_SELECTION } }
    const h = setup(presentation)
    const player = h.app.game!.players[0]
    player.hand.push(...player.deck.splice(0))
    for (const sizer of h.host.all('three-board-label three-board-sizer')) {
      Object.defineProperty(sizer, 'offsetHeight', { value: sizer.dataset.row === 'hand' ? 22 : 21 })
    }
    const stage = h.host.all('three-board-stage')[0]
    const layout = () => (h.board as unknown as { layout: ThreeLayout }).layout
    const page = () => Number(h.host.all('three-board-pagination')[0].children[1].textContent.split('/')[0]) - 1
    const fold = (shell: ThreeShellProfile, [width, height]: readonly [number, number]) => {
      stage.clientWidth = width
      stage.clientHeight = height
      presentation.shell = shell
      h.present()
    }
    fold(NARROW, [332, 583.25])
    const coverPageSize = narrowHandPageSize(layout())
    emit(h.host.all('three-board-pagination')[0].children[2], 'click')
    emit(h.host.all('three-board-pagination')[0].children[2], 'click')
    expect(page()).toBe(2)
    h.handPage.mockClear()
    // The same stage keeps the same page size, so the page itself is kept.
    fold('dock', [332, 583.25])
    expect(page()).toBe(2)
    // A new page size keeps the first card of the browsed page in view.
    fold('rail', [597.46, 506])
    const railPageSize = narrowHandPageSize(layout())
    expect(railPageSize).not.toBe(coverPageSize)
    expect(page()).toBe(Math.floor(2 * coverPageSize / railPageSize))
    expect(page()).toBeGreaterThan(0)
    // The desktop shows the whole hand, so returning to touch starts over.
    fold('desktop', [900, 600])
    fold(NARROW, [332, 583.25])
    expect(page()).toBe(0)
    expect(h.handPage).not.toHaveBeenCalled()
  })

  it.each([
    ['narrow', [332, 583.25], '50px'],
    ['dock', [678, 546.5], '22px'],
    ['rail', [597.46, 506], '22px'],
  ] as const)('reserves the %s hand pager row while the hand has one page: %s', (shell, [width, height], onePage) => {
    const h = setup({ shell: shell as ThreeShellProfile, selection: NO_BOARD_SELECTION })
    for (const sizer of h.host.all('three-board-label three-board-sizer')) {
      Object.defineProperty(sizer, 'offsetHeight', { value: sizer.dataset.row === 'hand' ? 22 : 21 })
    }
    const stage = h.host.all('three-board-stage')[0]
    stage.clientWidth = width
    stage.clientHeight = height
    h.present()
    const hand = h.host.all('three-board-label').find((entry) => entry.dataset.row === 'hand')!
    const pagination = h.host.all('three-board-pagination')[0]
    expect(stage.dataset.layout).toBe(shell)
    expect(h.button.parent).toBe(h.dock)
    expect(hand.style.height).toBe(onePage)
    expect(pagination.hidden).toBe(true)
    // Only a hand with more pages shows the pager, in every touch shell.
    const player = h.app.game!.players[0]
    player.hand.push(...player.deck.splice(0))
    h.present()
    expect(hand.style.height).toBe('50px')
    expect(pagination.hidden).toBe(false)
    // A drag never changes the hand size, so it never moves the pager row.
    const visible = player.hand.find((card) => h.registry.get(boardCardKey(card.id, 0))?.descriptor.visible)!
    h.board.beginDrag({ key: boardCardKey(visible.id, 0), cardId: visible.id, owner: 0, zone: 'hand', name: visible.name, playable: true })
    expect(stage.dataset.dragging).toBe('true')
    ObserverStub.latest.callback()
    expect(hand.style.height).toBe('50px')
    h.board.endDrag(false)
    player.hand = player.hand.slice(0, 5)
    h.present()
    expect(hand.style.height).toBe(onePage)
    expect(pagination.hidden).toBe(true)
  })

  it.each(['cardId', 'discardId'] as const)('follows a %s selection held behind Details through a resize, so closing Details keeps it', (field) => {
    const presentation = { shell: NARROW, selection: { ...NO_BOARD_SELECTION } }
    const h = setup(presentation)
    const player = h.app.game!.players[0]
    player.hand.push(...player.deck.splice(0))
    if (field === 'discardId') {
      h.app.game!.currentPlayer = 1
      h.act('play_land')
    }
    for (const sizer of h.host.all('three-board-label three-board-sizer')) {
      Object.defineProperty(sizer, 'offsetHeight', { value: sizer.dataset.row === 'hand' ? 50 : 36 })
    }
    const stage = h.host.all('three-board-stage')[0]
    stage.clientWidth = 332
    stage.clientHeight = 583.25
    h.present()
    const layout = () => (h.board as unknown as { layout: ThreeLayout }).layout
    const pageSize = narrowHandPageSize(layout())
    const id = player.hand[pageSize - 1].id
    presentation.selection[field] = id
    h.present()
    // Details blocks input and hides the highlight, but keeps the selection.
    h.present({}, false, 0, new Set(), true)
    expect(h.registry.get(boardCardKey(id, 0))!.descriptor.selected).toBeUndefined()
    stage.clientHeight = 468.25
    ObserverStub.latest.callback()
    const smaller = narrowHandPageSize(layout())
    expect(Math.floor((pageSize - 1) / smaller)).toBeGreaterThan(0)
    expect(h.host.all('three-board-pagination')[0].children[1].textContent)
      .toMatch(new RegExp(`^${Math.floor((pageSize - 1) / smaller) + 1}/`))
    // Closing Details finds the card on the shown page, still selected.
    h.present()
    expect(h.registry.get(boardCardKey(id, 0))!.descriptor).toMatchObject({ visible: true, selected: true })
    expect(h.handPage).not.toHaveBeenCalled()
  })

  it.each(['cardId', 'discardId'] as const)('keeps the lifted %s selection inside its lane without overlapping another hand line', (field) => {
    const presentation = { shell: NARROW, selection: { ...NO_BOARD_SELECTION } }
    const h = setup(presentation)
    const player = h.app.game!.players[0]
    player.hand.push(...player.deck.splice(0))
    const stage = h.host.all('three-board-stage')[0]
    stage.clientWidth = 332
    stage.clientHeight = 583.25
    h.present()
    const visible = player.hand.filter((card) => h.registry.get(boardCardKey(card.id, 0))?.descriptor.visible)
    const layout = (h.board as unknown as { layout: ThreeLayout }).layout
    const row = layout.rows.hand
    for (const selected of visible) {
      presentation.selection[field] = selected.id
      h.present()
      const card = h.registry.get(boardCardKey(selected.id, 0))!.descriptor
      expect(card.y + card.height / 2).toBeLessThanOrEqual(row.y + row.height / 2)
      expect(card.y - card.height / 2).toBeGreaterThanOrEqual(row.y - row.height / 2)
      for (const other of visible.filter((entry) => entry.id !== selected.id)) {
        const rect = h.registry.get(boardCardKey(other.id, 0))!.descriptor
        expect(Math.abs(card.x - rect.x) >= (card.width + rect.width) / 2
          || Math.abs(card.y - rect.y) >= (card.height + rect.height) / 2).toBe(true)
      }
    }
  })

  it('keeps short-board battlefield hit targets at least 44px wide for both players', () => {
    const h = setup({ shell: NARROW, selection: NO_BOARD_SELECTION })
    const stage = h.host.all('three-board-stage')[0]
    stage.clientWidth = 344
    stage.clientHeight = 200
    for (const owner of [0, 1]) {
      h.app.game!.players[owner].battlefield = [{
        instanceId: `target-${owner}`, card: { id: `card-${owner}`, name: 'Forest', type: 'land' },
      }]
    }
    h.present()
    const layout = (h.board as unknown as { layout: ThreeLayout }).layout
    const bounds = h.board.canvas.getBoundingClientRect()
    for (const owner of [0, 1]) {
      const { x, y, width, height } = h.registry.get(boardCardKey(`card-${owner}`, owner, `target-${owner}`))!.descriptor
      expect(width).toBeGreaterThanOrEqual(44)
      expect(height).toBeGreaterThanOrEqual(44)
      for (const offset of [-21.9, 21.9]) {
        expect(h.board.hitTest(
          (layout.width / 2 + x + offset) / layout.width * bounds.width,
          (layout.height / 2 - y) / layout.height * bounds.height,
        )?.instanceId).toBe(`target-${owner}`)
      }
    }
  })

  it.each([
    [0, 0], [0, 1], [1, 0], [1, 1],
  ])('shows the public pending card for caster %s with player %s near the camera', (owner, presentedActor) => {
    const h = setup()
    h.app.game!.currentPlayer = owner
    const cardId = h.app.game!.players[owner].hand[0].id
    h.act('play_land')
    h.present({ presentedActor })
    const pending = h.pending()!
    const layout = (h.board as unknown as { layout: ThreeLayout }).layout
    const rect = pendingCardRect(layout, owner, presentedActor)
    expect(pending).toBeDefined()
    expect(pending.visible).toBe(true)
    expect(pending.position.x).toBe(rect.x)
    expect(pending.position.y).toBe(rect.y)
    expect(pending.position.z).toBeGreaterThan(8)
    expect(h.cards.children.filter((entry) => entry.name === 'pending-land-play')).toHaveLength(1)
    expect(h.app.game!.players[owner].battlefield).toHaveLength(0)
    expect(h.app.game!.players[owner].hand.some((card) => card.id === cardId)).toBe(false)
    expect(h.host.all('three-board-pagination')).toHaveLength(0)
    const caption = h.host.all('three-board-pending-caption')[0]
    expect(caption.textContent).toBe('Signal Siren · awaiting interception')
    expect(caption.hidden).toBe(false)
    expect(caption.getAttribute('aria-live')).toBe('polite')
    const bounds = h.board.canvas.getBoundingClientRect()
    expect(h.board.hitTest(
      bounds.left + (layout.width / 2 + rect.x) / layout.width * bounds.width,
      bounds.top + (layout.height / 2 - rect.y) / layout.height * bounds.height,
    )).toBeNull()
  })

  it.each(['counter_land', 'pass_response'] as const)('removes the hover only when %s resolves the pending play', (type) => {
    const h = setup()
    const cardId = h.app.game!.players[0].hand[0].id
    h.act('play_land')
    const pending = h.pending()!
    const dispose = vi.spyOn((pending.children[3] as Mesh).material as MeshBasicMaterial, 'dispose')
    h.app.status = 'Action rejected; try again'
    const acquisitions = gpu.acquireCard.mock.calls.length
    h.present()
    h.present({ menuOpen: true })
    expect(h.pending()).toBe(pending)
    expect(gpu.acquireCard).toHaveBeenCalledTimes(acquisitions)
    h.act(type)
    expect(h.pending()).toBeUndefined()
    expect(dispose).toHaveBeenCalledOnce()
    expect(h.host.all('three-board-pending-caption')[0].hidden).toBe(true)
    expect(h.app.game!.players[0].battlefield.some((entry) => entry.card.id === cardId)).toBe(type === 'pass_response')
    expect(h.app.game!.players[0].graveyard.some((card) => card.id === cardId)).toBe(type === 'counter_land')
  })

  it('keeps an overflowing row visible through resize without restarting an active effect', () => {
    const h = setup()
    h.app.game!.players[0].battlefield = Array.from({ length: 8 }, (_, index) => ({
      instanceId: `caster-${index}`, card: { id: `caster-card-${index}`, name: 'Forest', type: 'land' },
    }))
    h.act('play_land')
    const registry = (h.board as unknown as {
      cards: { get(key: string): { descriptor: { visible: boolean; x: number; width: number } } | null }
    }).cards
    const row = Array.from({ length: 8 }, (_, index) =>
      registry.get(boardCardKey(`caster-card-${index}`, 0, `caster-${index}`))!)
    expect(row.every((card) => card.descriptor.visible)).toBe(true)
    expect(row[1].descriptor.x - row[0].descriptor.x).toBeLessThan(row[0].descriptor.width)
    expect(h.host.all('three-board-pagination')).toHaveLength(0)
    const pending = h.pending()!
    const done = vi.fn()
    const cancel = h.board.playEffect({
      kind: 'play_land', actor: 0, sourceInstanceId: 'caster-0', land: 'Forest', visualStyle: 'classic',
      palette: { primary: '#123456', secondary: '#abcdef', glow: '#ffffff' },
    }, 350, done)
    const oldX = pending.position.x
    const stage = h.host.all('three-board-stage')[0]
    stage.clientWidth = 844
    stage.clientHeight = 390
    Object.assign(h.window, { innerWidth: 844, innerHeight: 390 })
    ObserverStub.latest.callback()
    expect(h.pending()).toBe(pending)
    expect(pending.position.x).not.toBe(oldX)
    expect(h.app.game!.players[0].battlefield).toHaveLength(8)
    expect(done).not.toHaveBeenCalled()
    cancel()
    expect(done).toHaveBeenCalledOnce()
  })

  it('retains response snapshots through replay, AI turns, hidden-page recovery and animation-off without idle frames', () => {
    const h = setup()
    h.act('play_land')
    const pending = h.pending()
    h.app.animationSpeed = 'off'
    h.app.controllers = ['ai', 'ai']
    h.present({ presentedActor: 0 }, true, 3)
    expect(h.pending()).toBe(pending)
    h.present({ presentedActor: 0 }, true, 1)
    expect(h.pending()).toBe(pending)
    h.present({ presentedActor: 0 })
    expect(h.pending()).toBe(pending)
    expect(pending?.visible).toBe(true)
    expect(h.button.hidden).toBe(true)
    h.document.hidden = true
    h.document.dispatchEvent(new Event('visibilitychange'))
    h.document.hidden = false
    h.document.dispatchEvent(new Event('visibilitychange'))
    expect(h.pending()?.visible).toBe(true)
    const frame = vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0]
    const scheduled = vi.mocked(requestAnimationFrame).mock.calls.length
    frame(1000)
    expect(vi.mocked(requestAnimationFrame).mock.calls).toHaveLength(scheduled)
    h.app.game = null
    h.board.render(buildViewModel(h.app, false), 0, new Set(), null, null)
    expect(h.pending()).toBeUndefined()
    expect(h.host.all('three-board-pending-caption')[0].hidden).toBe(true)
  })

  it('updates art in place but releases replaced identities and session/disposal resources once', () => {
    const h = setup()
    h.act('play_land')
    const pending = h.pending()!
    const material = (pending.children[3] as Mesh).material as MeshBasicMaterial
    const dispose = vi.spyOn(material, 'dispose')
    const texture = material.map
    h.app.cardVisualStyle = 'anime'
    h.present()
    expect(h.pending()).toBe(pending)
    expect(material.map).not.toBe(texture)
    expect(dispose).not.toHaveBeenCalled()
    h.app.game!.pendingLandPlay!.card = { id: 'another-island', name: 'Island', type: 'land' }
    h.present()
    expect(h.pending()).not.toBe(pending)
    expect(dispose).toHaveBeenCalledOnce()
    h.app.seed += 1
    const previous = h.pending()
    h.present()
    expect(h.pending()).not.toBe(previous)
    h.board.dispose()
    h.board.dispose()
    expect(h.cards.children).toHaveLength(0)
    expect(gpu.release).toHaveBeenCalledTimes(gpu.acquireCard.mock.calls.length + 1)
  })

  it('renders both summaries outside the lower controls and updates after plays, counters and draws', () => {
    const h = setup()
    const stats = (header: ElementStub) => header.all('three-board-stats')[0]
    expect(stats(h.near).textContent).toBe('Hand 5 · Deck 45 · Discard pile 0')
    expect(stats(h.far).getAttribute('aria-label')).toBe('Player 2: Hand 5 · Deck 45 · Discard pile 0')
    expect(h.near.children[0].children[0].textContent).toContain('Player 1 · Board')
    expect(h.host.all('three-board-primary')).toHaveLength(1)
    expect(h.button.parent).toBe(h.near)
    expect(h.button.textContent).toBe('End Turn')
    h.act('play_land')
    expect(h.button.textContent).toBe('Let It Through')
    expect(stats(h.far).textContent).toBe('Hand 4 · Deck 45 · Discard pile 0')
    expect(stats(h.near).getAttribute('aria-label')).toBe('Player 2: Hand 5 · Deck 45 · Discard pile 0')
    expect(h.near.dataset.active).toBe('true')
    h.act('counter_land')
    expect(stats(h.near).textContent).toBe('Hand 4 · Deck 45 · Discard pile 1')
    expect(stats(h.far).textContent).toBe('Hand 3 · Deck 45 · Discard pile 2')
    h.act('end_turn')
    expect(stats(h.near).textContent).toBe('Hand 4 · Deck 44 · Discard pile 2')
    expect(stats(h.far).getAttribute('aria-label')).toBe('Player 1: Hand 4 · Deck 45 · Discard pile 1')
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
    expect(stacks.map((stack) => stack.textContent)).toEqual(['Deck 45', 'Discard 0'])
    expect(stacks[0].dataset.empty).toBe('false')
    expect(stacks[1].dataset.empty).toBe('true')
    expect(h.near.all('three-board-stacks')[0].getAttribute('aria-hidden')).toBe('true')
    h.app.game!.players[0].graveyard.push({ id: 'discard', name: 'Forest', type: 'land' })
    h.present()
    expect(h.near.all('three-board-stack')).toEqual(stacks)
    expect(stacks[1].textContent).toBe('Discard 1')
    expect(stacks[1].dataset.empty).toBe('false')
  })

  it('suppresses drop input behind overlays while keeping every battlefield target visible', () => {
    const h = setup()
    h.app.game!.players[1].battlefield = Array.from({ length: 8 }, (_, index) => ({
      instanceId: `target-${index}`, card: { id: `land-${index}`, name: 'Forest', type: 'land' },
    }))
    const view = buildViewModel(h.app, false)
    const primary = threePrimaryAction(view, {
      presentedActor: 0, menuOpen: false, cardsOpen: false, preview: null, pendingCardId: '0-0',
      previewReturnToCards: false,
      phaseDismissed: false, hostAnswerDraft: '', joinOfferDraft: '',
    })
    h.board.render(view, 0, new Set(['target-0', 'target-7']), null, primary, true)
    expect(h.board.containsDrop(195, 380)).toBe(false)
    const labels = h.far.parent!.all('three-board-target-label')
    expect(labels).toHaveLength(2)
    expect(h.host.all('three-board-target-pages')).toHaveLength(0)
    const layout = (h.board as unknown as { layout: ThreeLayout }).layout
    const registry = (h.board as unknown as {
      cards: { get(key: string): { descriptor: { x: number; y: number; width: number } } | null }
    }).cards
    for (const index of [0, 7]) {
      const label = labels.find((entry) => entry.dataset.cardId === `land-${index}`)!
      const card = registry.get(boardCardKey(`land-${index}`, 1, `target-${index}`))!
      expect(h.board.hitTest(
        Number.parseFloat(label.style.left),
        layout.height / 2 - card.descriptor.y,
      )?.instanceId).toBe(`target-${index}`)
    }
    const compactLabel = labels.find((entry) => entry.dataset.cardId === 'land-0')!
    expect(compactLabel.dataset.compact).toBe('true')
    const first = registry.get(boardCardKey('land-0', 1, 'target-0'))!.descriptor
    const second = registry.get(boardCardKey('land-1', 1, 'target-1'))!.descriptor
    const exposedWidth = second.x - second.width / 2 - (first.x - first.width / 2)
    expect(Number.parseFloat(compactLabel.style.width)).toBeLessThanOrEqual(Math.min(12, exposedWidth))
    const fullLabel = labels.find((entry) => entry.dataset.cardId === 'land-7')!
    expect(fullLabel.dataset.compact).toBe('false')
    expect(fullLabel.textContent).toBe('Target')
    h.board.render(view, 0, new Set(), null, primary, true)
    expect(h.host.all('three-board-target-label')).toHaveLength(0)
  })

  it.each([
    ['play_land', 'Summoned'], ['forest_return', 'Reclaimed'],
    ['swamp_discard', 'Memory drained'], ['mountain_destroy', 'Banished to discard pile'],
    ['plains_reuse', 'Ability mimicked'], ['counter_resolved', 'Intercepted'],
  ] as const)('announces %s separately from controller status and releases it once', (kind, label) => {
    const h = setup()
    h.app.status = 'Storage unavailable'
    h.present()
    const stage = h.host.all('three-board-stage')[0]
    stage.clientWidth = 844
    stage.clientHeight = 390
    Object.assign(h.window, { innerWidth: 844, innerHeight: 390 })
    ObserverStub.latest.callback()
    const done = vi.fn()
    const cancel = h.board.playEffect({
      kind, actor: 0, targetActor: 1, land: 'Forest', visualStyle: 'classic',
      palette: { primary: '#123456', secondary: '#abcdef', glow: '#ffffff' },
      ...(kind === 'mountain_destroy' ? { targetDisplayName: 'Signal Siren' } : {}),
    }, 150, done)
    const caption = h.host.all('three-board-effect-caption')[0]
    const prompt = h.host.all('three-board-instruction')[0]
    expect(caption.textContent).toBe(label)
    expect(caption.hidden).toBe(false)
    expect(caption.getAttribute('aria-live')).toBe('polite')
    expect(caption.getAttribute('aria-label')).toBe(kind === 'mountain_destroy'
      ? "Banish: Signal Siren goes to its owner's discard pile."
      : label)
    expect(prompt.hidden).toBe(false)
    const promptBottom = Number.parseFloat(prompt.style.top) + prompt.offsetHeight
    expect(Number.parseFloat(caption.style.top)).toBeGreaterThanOrEqual(promptBottom + 4)
    expect(h.app.status).toBe('Storage unavailable')
    cancel()
    cancel()
    expect(caption.hidden).toBe(true)
    expect(done).toHaveBeenCalledOnce()
  })

  it('clears an announcement-only caption after its delivery window', () => withFakeTimers(() => {
    const h = setup()
    const done = vi.fn()
    const cancel = h.board.announceEffect({
      kind: 'mountain_destroy', actor: 0, targetActor: 1, land: 'Forest', visualStyle: 'classic',
      palette: { primary: '#123456', secondary: '#abcdef', glow: '#ffffff' },
      targetDisplayName: 'Signal Siren',
    }, done)
    const caption = h.host.all('three-board-effect-caption')[0]
    expect(caption.hidden).toBe(false)
    expect(caption.getAttribute('aria-label')).toBe("Banish: Signal Siren goes to its owner's discard pile.")
    vi.runAllTimers()
    expect(caption.hidden).toBe(true)
    expect(done).toHaveBeenCalledOnce()
    cancel()
    expect(done).toHaveBeenCalledOnce()
  }))

  it.each([
    { actor: 0, presentedActor: 0, row: 'near' },
    { actor: 0, presentedActor: 1, row: 'far' },
    { actor: 1, presentedActor: 0, row: 'far' },
    { actor: 1, presentedActor: 1, row: 'near' },
  ] as const)('shows the two counter cards over actor $actor with player $presentedActor presented', ({
    actor, presentedActor, row,
  }) => {
    const h = setup()
    h.present({ presentedActor })
    const acquisitionCount = gpu.acquireCard.mock.calls.length
    const done = vi.fn()
    const cancel = h.board.playEffect(counterEffect(actor), 350, done)
    const pair = h.cards.children.filter((entry) => entry.name.startsWith('counter-cost-'))
    expect(pair.map((entry) => entry.name)).toEqual(['counter-cost-island', 'counter-cost-discard'])
    expect(gpu.acquireCard.mock.calls.slice(acquisitionCount).map(([card]) => card)).toEqual([
      expect.objectContaining({
        name: 'Island', serializedKey: 'Island', displayName: 'Signal Siren', assetSlug: 'signal-siren',
      }),
      expect.objectContaining({
        name: 'Mountain', serializedKey: 'Mountain', displayName: 'Rooftop Gargoyle', assetSlug: 'rooftop-gargoyle',
      }),
    ])

    let layout = (h.board as unknown as { layout: ThreeLayout }).layout
    const expectedCenter = cardSlotX(0, 1, layout)
    expect((pair[0].position.x + pair[1].position.x) / 2).toBeCloseTo(expectedCenter)
    expect(pair[0].position.y).toBeCloseTo(layout.rows[row].y)
    expect(pair[1].position.y).toBeCloseTo(layout.rows[row].y)
    expect(pair[0].position.z).toBeGreaterThan(8)
    const bounds = h.board.canvas.getBoundingClientRect()
    for (const card of pair) {
      expect(h.board.hitTest(
        bounds.left + (layout.width / 2 + card.position.x) / layout.width * bounds.width,
        bounds.top + (layout.height / 2 - card.position.y) / layout.height * bounds.height,
      )).toBeNull()
    }

    const oldPositions = pair.map((card) => card.position.clone())
    const stage = h.host.all('three-board-stage')[0]
    stage.clientWidth = 844
    stage.clientHeight = 390
    Object.assign(h.window, { innerWidth: 844, innerHeight: 390 })
    ObserverStub.latest.callback()
    layout = (h.board as unknown as { layout: ThreeLayout }).layout
    expect(h.cards.children.filter((entry) => entry.name.startsWith('counter-cost-'))).toEqual(pair)
    expect((pair[0].position.x + pair[1].position.x) / 2).toBeCloseTo(cardSlotX(0, 1, layout))
    expect(pair.every((card) => card.position.y === layout.rows[row].y)).toBe(true)
    expect(pair.some((card, index) => !card.position.equals(oldPositions[index]))).toBe(true)

    cancel()
    cancel()
    expect(done).toHaveBeenCalledOnce()
    expect(h.cards.children.filter((entry) => entry.name.startsWith('counter-cost-'))).toHaveLength(0)
  })

  it('does not create counter cards when animations are off', () => {
    const h = setup()
    h.app.animationSpeed = 'off'
    h.present()
    const acquisitionCount = gpu.acquireCard.mock.calls.length
    const done = vi.fn()
    const cancel = h.board.playEffect(counterEffect(1), 350, done)
    expect(done).toHaveBeenCalledOnce()
    expect(gpu.acquireCard).toHaveBeenCalledTimes(acquisitionCount)
    expect(h.cards.children.filter((entry) => entry.name.startsWith('counter-cost-'))).toHaveLength(0)
    cancel()
    expect(done).toHaveBeenCalledOnce()
  })

  it('disposes active counter cards exactly once with the board', () => {
    const h = setup()
    const done = vi.fn()
    h.board.playEffect(counterEffect(1, 'Island'), 700, done)
    const pair = h.cards.children.filter((entry) => entry.name.startsWith('counter-cost-'))
    const disposals = pair.map((card) =>
      vi.spyOn((card.children[3] as Mesh).material as MeshBasicMaterial, 'dispose'))
    h.board.dispose()
    h.board.dispose()
    expect(done).toHaveBeenCalledOnce()
    expect(disposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true)
    expect(pair.every((card) => card.parent === null)).toBe(true)
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

  it('reanchors effects when an overlapping row resizes without completing or draining their queue', () => {
    const h = setup()
    h.app.game!.players[1].battlefield = Array.from({ length: 8 }, (_, index) => ({
      instanceId: `far-${index}`, card: { id: `far-card-${index}`, name: 'Forest', type: 'land' },
    }))
    h.present()
    const done = vi.fn()
    const cancel = h.board.playEffect({
      kind: 'play_land', actor: 1, sourceInstanceId: 'far-0', land: 'Forest', visualStyle: 'classic',
      palette: { primary: '#123456', secondary: '#abcdef', glow: '#ffffff' },
    }, 350, done)
    const registry = (h.board as unknown as {
      cards: { get(key: string): { descriptor: { x: number } } | null }
    }).cards
    const key = boardCardKey('far-card-0', 1, 'far-0')
    const oldX = registry.get(key)!.descriptor.x
    const stage = h.host.all('three-board-stage')[0]
    stage.clientWidth = 844
    stage.clientHeight = 390
    Object.assign(h.window, { innerWidth: 844, innerHeight: 390 })
    ObserverStub.latest.callback()
    expect(stage.dataset.layout).toBe('compact')
    expect((h.board as unknown as { layout: ThreeLayout }).layout.height).toBe(390)
    expect(registry.get(key)!.descriptor.x).not.toBe(oldX)
    expect(done).not.toHaveBeenCalled()
    expect(h.host.all('three-board-effect-caption')[0].hidden).toBe(false)
    cancel()
    expect(done).toHaveBeenCalledOnce()
  })

  it('keeps counts including zero during game over and replay, without gameplay actions', () => {
    const h = setup()
    h.app.game!.players[1].deck = []
    h.app.game!.players[1].hand = []
    h.act('end_turn')
    expect(h.app.game!.phase).toBe('gameOver')
    expect(h.button.hidden).toBe(true)
    expect(h.near.all('three-board-stats')[0].textContent).toBe('Hand 0 · Deck 0 · Discard pile 0')
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
    const stage = h.host.all('three-board-stage')[0]
    expect(prompt.parent).toBe(stage)
    expect(prompt.parent).not.toBe(h.near)
    expect(sizes.map((entry) => entry.textContent)).toEqual([
      'Drag a highlighted creature onto your board to summon it',
      'Move onto your board · release elsewhere to cancel',
      'Release to summon · back to hand cancels',
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
    h.board.moveDrag(195, 380, false)
    expect(prompt.children[0].textContent).toBe(sizes[2].textContent)
    expect(h.host.all('three-board-instruction-size')).toEqual(sizes)
    h.board.endDrag(false)
    expect(prompt.children[0].textContent).toBe(sizes[0].textContent)
    h.act('play_land')
    expect(prompt.children[0].textContent).toContain('Intercept the summon of Signal Siren?')
    expect(sizes.every((entry) => entry.hidden)).toBe(true)
  })

  it('keeps battlefield geometry fixed across main, drag, response and resolution prompts', () => {
    const h = setup()
    const prompt = h.host.all('three-board-instruction')[0]
    const geometry = () => {
      const layout = (h.board as unknown as { layout: ThreeLayout }).layout
      return {
        cardWidth: layout.cardWidth,
        cardHeight: layout.cardHeight,
        promptTop: prompt.style.top,
        rows: {
          far: { ...layout.rows.far },
          near: { ...layout.rows.near },
          hand: { ...layout.rows.hand },
        },
      }
    }
    const initial = geometry()
    h.board.beginDrag({
      key: boardCardKey('0-0', 0), cardId: '0-0', owner: 0, zone: 'hand', name: 'Island', playable: true,
    })
    h.board.moveDrag(195, 380, false)
    // Only the instruction moves: a live drag lifts it to a pill at the top
    // of the visible stage, clear of the drop zone.
    expect(geometry()).toEqual({ ...initial, promptTop: '4px' })
    h.board.endDrag(false)
    expect(geometry()).toEqual(initial)
    h.act('play_land')
    expect(h.app.game!.phase).toBe('respond')
    expect(geometry()).toEqual(initial)
    h.act('counter_land')
    expect(h.app.game!.phase).toBe('main')
    expect(geometry()).toEqual(initial)
  })

  it.each([
    { width: 390, height: 760, mode: 'stacked' },
    { width: 844, height: 390, mode: 'compact' },
  ])('anchors the prompt to the top of the presented battlefield in $mode layout', ({ width, height, mode }) => {
    const h = setup()
    const stage = h.host.all('three-board-stage')[0]
    const prompt = h.host.all('three-board-instruction')[0]
    stage.clientWidth = width
    stage.clientHeight = height
    Object.assign(h.window, { innerWidth: width, innerHeight: height })
    ObserverStub.latest.callback()
    expect(stage.dataset.layout).toBe(mode)
    const layout = (h.board as unknown as { layout: ThreeLayout }).layout
    const promptLeft = Number.parseFloat(prompt.style.left)
    const promptTop = Number.parseFloat(prompt.style.top)
    const promptWidth = Number.parseFloat(prompt.style.width)
    const nearRowTop = layout.height / 2 - layout.rows.near.y - layout.rows.near.height / 2
    expect(promptLeft).toBeCloseTo(layout.columns.cardsLeft + layout.columns.cardsWidth / 2)
    expect(promptTop).toBeCloseTo(nearRowTop + 4)
    expect(promptWidth).toBeCloseTo(Math.min(544, Math.max(1, layout.columns.cardsWidth - 24)))
    expect(h.near.children[0].children[0].textContent).toContain('· ACTIVE')
    if (layout.compact) {
      expect(promptLeft - promptWidth / 2).toBeGreaterThan(
        layout.columns.labelLeft + layout.columns.labelWidth,
      )
    } else {
      expect(promptTop).toBeGreaterThan(
        layout.rows.near.labelTop + layout.rows.near.labelHeight,
      )
    }
    const done = vi.fn()
    const cancel = h.board.playEffect({
      kind: 'play_land', actor: 0, land: 'Forest', visualStyle: 'classic',
      palette: { primary: '#123456', secondary: '#abcdef', glow: '#ffffff' },
    }, 150, done)
    const caption = h.host.all('three-board-effect-caption')[0]
    expect(Number.parseFloat(caption.style.top)).toBeGreaterThanOrEqual(
      promptTop + prompt.offsetHeight + 4,
    )
    cancel()
    expect(done).toHaveBeenCalledOnce()
  })

  it.each([
    { actor: 0, canCounter: true },
    { actor: 1, canCounter: true },
    { actor: 0, canCounter: false },
    { actor: 1, canCounter: false },
  ])('keeps a single accessible Mountain response instruction in the battlefield (%j)', ({ actor, canCounter }) => {
    const h = setup()
    const game = h.app.game!
    game.currentPlayer = 1 - actor
    game.players[game.currentPlayer].hand = [{ id: 'pending-mountain', name: 'Mountain', type: 'land' }]
    h.act('play_land')
    // Enter respond first: the engine normally skips it without counter cards.
    if (!canCounter) h.app.game!.players[actor].hand = []
    const primary = h.present()!
    expect(h.app.game!.phase).toBe('respond')
    const prompts = h.host.all('three-board-instruction')
    expect(prompts).toHaveLength(1)
    const prompt = prompts[0]
    expect(prompt.parent).toBe(h.host.all('three-board-stage')[0])
    expect(prompt.hidden).toBe(false)
    expect(prompt.getAttribute('role')).toBe('status')
    expect(prompt.getAttribute('aria-live')).toBe('polite')
    expect(h.button.getAttribute('aria-describedby')).toBe(prompt.id)
    expect(h.button.textContent).toBe('Let It Through')
    expect(h.button.disabled).toBe(false)
    expect(h.near.all('three-board-stats')[0].getAttribute('aria-label')).toContain(`Player ${actor + 1}:`)
    const expected = canCounter
      ? 'Intercept the summon of Rooftop Gargoyle? Discard Signal Siren and one other highlighted card, or choose Let It Through. The blue frame marks Signal Siren, which is included automatically; pink frames mark your choices.'
      : 'No legal card combination can intercept the summon of Rooftop Gargoyle. Choose Let It Through.'
    expect(primary.prompt).toBe(expected)
    expect(prompt.children.filter((child) => !child.hidden).map((child) => child.textContent)).toEqual([expected])
    h.act('pass_response')
    expect(h.app.game!.phase).toBe('main')
    expect(prompt.hidden).toBe(true)
    expect(prompt.children[0].textContent).not.toContain('Rooftop Gargoyle')
    expect(h.button.textContent).toBe('End Turn')
  })

  it('keeps prompt sizing stable in a pointer-transparent 50%-background overlay', () => {
    const css = readFileSync(join(__dirname, '..', 'renderers', 'three', 'graphics.css'), 'utf8')
    expect(css).toMatch(/\.three-board-instruction\s*\{[^}]*position:\s*absolute;/)
    expect(css).toMatch(/\.three-board-instruction\s*\{[^}]*background:\s*rgb\(8 24 36 \/ 50%\);/)
    expect(css).toMatch(/\.three-board-instruction\s*\{[^}]*pointer-events:\s*none;/)
    expect(css).toMatch(/\.three-board-instruction\s*\{[^}]*transform:\s*translateX\(-50%\);/)
    expect(css).toMatch(/\.three-board-instruction\s*\{[^}]*display:\s*grid;/)
    expect(css).toMatch(/\.three-board-instruction > span\s*\{\s*grid-area:\s*1 \/ 1;/)
    expect(css).toMatch(/\.three-board-instruction-size\s*\{\s*visibility:\s*hidden;/)
    expect(css).toMatch(/\.three-board-effect-caption\s*\{[^}]*transform:\s*translateX\(-50%\);/)
  })

  it('scrolls unavoidable stage overflow instead of clipping interactive chrome', () => {
    const css = readFileSync(join(__dirname, '..', 'renderers', 'three', 'graphics.css'), 'utf8')
    expect(css).toMatch(/\.three-board-stage\s*\{[^}]*overflow-y:\s*auto;/)
    expect(css).toMatch(/\.three-board-stage\s*\{[^}]*overscroll-behavior:\s*contain;/)
  })

  it('places compact near-player controls beside its summary and removes redundant stack graphics', () => {
    const css = readFileSync(join(__dirname, '..', 'renderers', 'three', 'graphics.css'), 'utf8')
    expect(css).toMatch(/\[data-layout="compact"\] \.three-board-label\[data-row="near"\]\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
    expect(css).toMatch(/\[data-layout="compact"\] \.three-board-stacks\s*\{[^}]*display:\s*none;/)
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
  })
})

/** Counts live card-face leases, so every acquire is matched by exactly one release. */
const countLeases = () => {
  const leases = { live: 0, repeated: 0 }
  gpu.acquireCard.mockImplementation(() => {
    leases.live++
    let released = false
    return {
      texture: new CanvasTexture({} as HTMLCanvasElement),
      release: () => {
        if (released) leases.repeated++
        else leases.live--
        released = true
      },
    }
  })
  return leases
}
const context2d = () => ({
  drawImage: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), setTransform: vi.fn(), fillStyle: '',
})

describe('Three touch drag feedback', () => {
  const SUMMON = 'Drag a highlighted creature onto your board to summon it'
  const CANCEL = 'Move onto your board · release elsewhere to cancel'
  const RELEASE = 'Release to summon · back to hand cancels'
  type Harness = ReturnType<typeof setup>
  interface DragInternals {
    readonly drag: {
      layered: boolean; accepted: boolean; returning: boolean; proxy: { group: Group }
      readonly width: number; readonly height: number
    } | null
    readonly layout: ThreeLayout
    readonly surfaces: Map<string, { material: MeshBasicMaterial }>
    readonly dropMaterial: MeshBasicMaterial
  }
  const internals = (h: Harness) => h.board as unknown as DragInternals
  /** The lifted card's box in drag-layer pixels (top-left origin), from the scene proxy that mirrors it. */
  const lifted = (h: Harness) => {
    const { drag, layout } = internals(h)
    const { position, scale } = drag!.proxy.group
    const x = position.x + layout.width / 2
    const y = layout.height / 2 - position.y
    const height = drag!.height * scale.y
    return { x, y, top: y - height / 2, bottom: y + height / 2 }
  }
  const island = (cardId = '0-0') => ({
    key: boardCardKey(cardId, 0), cardId, owner: 0, zone: 'hand' as const, name: 'Island', playable: true,
  })
  /** Board units (centred, y up) to client pixels through the stubbed canvas box. */
  const client = (h: Harness, x: number, y: number): [number, number] => {
    const { layout } = internals(h)
    const rect = h.host.all('three-board-canvas')[0].getBoundingClientRect()
    return [
      rect.left + (x + layout.width / 2) * rect.width / layout.width,
      rect.top + (layout.height / 2 - y) * rect.height / layout.height,
    ]
  }
  const dropCentre = (h: Harness) => client(h, internals(h).layout.drop.x, internals(h).layout.drop.y)
  const overHand = (h: Harness) => client(h, internals(h).layout.drop.x, internals(h).layout.rows.hand.y)
  /** Records writes to the visible instruction text, which screen readers would announce. */
  const recordText = (h: Harness, log: string[]) => {
    const text = h.host.all('three-board-instruction')[0].children[0]
    let value = text.textContent
    Object.defineProperty(text, 'textContent', {
      configurable: true,
      get: () => value,
      set: (next: string) => { log.push(`text=${next}`); value = next },
    })
  }

  it.each([['touch', true], ['mouse', false]] as const)(
    'highlights the near header exactly where a %s release would summon',
    (_, touch) => {
      const h = setup()
      const prompt = h.host.all('three-board-instruction')[0]
      const { layout } = internals(h)
      h.board.beginDrag(island())
      let accepted = 0
      let rejected = 0
      for (let y = 0; y <= layout.height; y += 8) {
        for (let x = 0; x <= layout.width; x += 13) {
          h.board.moveDrag(x, y, touch)
          const drops = h.board.containsDrop(x, y, touch)
          expect(h.near.dataset.dropAccepted === 'true').toBe(drops)
          expect(internals(h).drag?.accepted).toBe(drops)
          expect(prompt.children[0].textContent).toBe(drops ? RELEASE : CANCEL)
          expect(h.feedback.mock.lastCall?.[0]).toEqual({ cardId: '0-0', accepted: drops })
          if (drops) accepted++
          else rejected++
        }
      }
      expect(accepted).toBeGreaterThan(0)
      expect(rejected).toBeGreaterThan(0)
    },
  )

  it('gives touch, not the mouse, 12px of slop except toward the hand or beyond the visible stage', () => {
    const h = setup()
    const { layout } = internals(h)
    const { drop } = layout
    const rect = h.host.all('three-board-canvas')[0].getBoundingClientRect()
    // Board units are client pixels here, so the slop is exactly 12 units.
    expect(rect.width).toBe(layout.width)
    const top = drop.y + drop.height / 2
    expect(h.board.containsDrop(...client(h, drop.x, top - 1), false)).toBe(true)
    expect(h.board.containsDrop(...client(h, drop.x, top + 6), true)).toBe(true)
    expect(h.board.containsDrop(...client(h, drop.x, top + 6), false)).toBe(false)
    expect(h.board.containsDrop(...client(h, drop.x, top + 14), true)).toBe(false)
    const side = drop.x - drop.width / 2
    expect(side - 6 + layout.width / 2).toBeGreaterThan(0)
    expect(h.board.containsDrop(...client(h, side - 6, drop.y), true)).toBe(true)
    expect(h.board.containsDrop(...client(h, side - 6, drop.y), false)).toBe(false)
    // The edge facing the hand never grows, and nothing over the hand drops.
    const bottom = drop.y - drop.height / 2
    expect(h.board.containsDrop(...client(h, drop.x, bottom - 6), true)).toBe(false)
    expect(h.board.containsDrop(...overHand(h), true)).toBe(false)
    expect(h.board.containsDrop(...overHand(h), false)).toBe(false)
    // A drop zone scrolled out of the stage's visible box never accepts.
    const centre = dropCentre(h)
    expect(h.board.containsDrop(...centre, true)).toBe(true)
    h.host.all('three-board-stage')[0].clientHeight = centre[1] - 10
    expect(h.board.containsDrop(...centre, true)).toBe(false)
    expect(h.board.containsDrop(...centre, false)).toBe(false)
  })

  it('draws a 2D-capable drag in one layer lease and releases it on every end path', () => {
    const context = context2d()
    ElementStub.context2d = context
    const leases = countLeases()
    const h = setup()
    const layer = h.host.all('three-drag-layer')[0]
    const card = h.host.all('three-drag-card')[0]
    expect(layer.parent).toBe(h.host.all('three-board-stage')[0])
    expect(layer.getAttribute('aria-hidden')).toBe('true')
    const resting = leases.live
    for (const animateReturn of [false, true, false]) {
      h.board.beginDrag(island())
      // The scene proxy and the layer card each hold one lease.
      expect(leases.live).toBe(resting + 2)
      expect(internals(h).drag).toMatchObject({ layered: true })
      expect(internals(h).drag!.proxy.group.visible).toBe(false)
      h.board.moveDrag(...dropCentre(h), true)
      expect(card.hidden).toBe(false)
      expect(layer.hidden).toBe(false)
      expect(layer.dataset.accepted).toBe('true')
      h.board.endDrag(animateReturn)
      expect(card.hidden).toBe(true)
      expect(layer.hidden).toBe(true)
      if (animateReturn) {
        // The returning proxy reappears in the scene and keeps only its own lease.
        expect(internals(h).drag).toMatchObject({ returning: true })
        expect(internals(h).drag!.proxy.group.visible).toBe(true)
        expect(leases.live).toBe(resting + 1)
        h.board.endDrag(false)
      }
      expect(leases.live).toBe(resting)
    }
    expect(context.drawImage).toHaveBeenCalledTimes(3)
    h.board.beginDrag(island())
    h.board.moveDrag(...dropCentre(h), true)
    h.board.dispose()
    expect(leases.live).toBe(0)
    expect(leases.repeated).toBe(0)
  })

  it.each(['no 2D context', 'a failing paint'] as const)(
    'keeps the in-scene proxy with %s while still labelling the landing slot',
    (failure) => {
      if (failure === 'a failing paint') {
        const context = context2d()
        context.drawImage.mockImplementation(() => { throw new Error('tainted') })
        ElementStub.context2d = context
      }
      const leases = countLeases()
      const h = setup()
      const resting = leases.live
      h.board.beginDrag(island())
      expect(internals(h).drag).toMatchObject({ layered: false })
      expect(internals(h).drag!.proxy.group.visible).toBe(true)
      expect(leases.live).toBe(resting + 1)
      h.board.moveDrag(...dropCentre(h), true)
      expect(h.host.all('three-drag-card')[0].hidden).toBe(true)
      const landing = h.host.all('three-drag-landing')[0]
      expect(landing.hidden).toBe(false)
      expect(landing.textContent).toBe('Lands here')
      expect(h.host.all('three-drag-layer')[0].hidden).toBe(false)
      h.board.endDrag(false)
      expect(landing.hidden).toBe(true)
      expect(h.host.all('three-drag-layer')[0].hidden).toBe(true)
      expect(leases.live).toBe(resting)
      expect(leases.repeated).toBe(0)
    },
  )

  it('repaints the lifted card on the next board frame when its artwork loads under a still finger', () => {
    const context = context2d()
    ElementStub.context2d = context
    const leases = countLeases()
    const counted = gpu.acquireCard.getMockImplementation()!
    const art = { ready: false }
    gpu.acquireCard.mockImplementation((...args: unknown[]) =>
      Object.defineProperty(counted(...args), 'ready', { get: () => art.ready }))
    const h = setup()
    const card = h.host.all('three-drag-card')[0]
    const frames = vi.mocked(requestAnimationFrame).mock.calls
    const runFrame = () => frames.at(-1)![0](16)
    const resting = leases.live
    h.board.beginDrag(island())
    h.board.moveDrag(...dropCentre(h), true)
    runFrame()
    // The fallback face is drawn once, and frames before the artwork loads leave it.
    expect(context.drawImage).toHaveBeenCalledOnce()
    const scheduled = frames.length
    art.ready = true
    gpu.assetsChanged()
    expect(frames).toHaveLength(scheduled + 1)
    runFrame()
    expect(context.drawImage).toHaveBeenCalledTimes(2)
    expect(card.hidden).toBe(false)
    expect(internals(h).drag).toMatchObject({ layered: true })
    expect(internals(h).drag!.proxy.group.visible).toBe(false)
    runFrame()
    expect(context.drawImage).toHaveBeenCalledTimes(2)
    h.board.endDrag(false)
    expect(leases.live).toBe(resting)

    // When that repaint fails, the frame shows the in-scene proxy and releases the layer's lease.
    art.ready = false
    h.board.beginDrag(island())
    h.board.moveDrag(...dropCentre(h), true)
    art.ready = true
    context.drawImage.mockImplementationOnce(() => { throw new Error('lost') })
    gpu.assetsChanged()
    runFrame()
    expect(internals(h).drag).toMatchObject({ layered: false })
    expect(internals(h).drag!.proxy.group.visible).toBe(true)
    expect(card.hidden).toBe(true)
    expect(leases.live).toBe(resting + 1)
    h.board.endDrag(false)
    expect(leases.live).toBe(resting)
    expect(leases.repeated).toBe(0)
  })

  it('keeps a live drag through re-presentation with animations off and ends it without a return', () => {
    const h = setup()
    const stage = h.host.all('three-board-stage')[0]
    h.app.animationSpeed = 'off'
    h.present()
    h.board.beginDrag(island())
    h.board.moveDrag(...dropCentre(h), true)
    h.present()
    h.present()
    expect(internals(h).drag).toMatchObject({ accepted: true, returning: false })
    expect(stage.dataset.dragging).toBe('true')
    h.board.endDrag(true)
    expect(internals(h).drag).toBeNull()
    expect(stage.dataset.dragging).toBeUndefined()
    expect(h.feedback).toHaveBeenLastCalledWith(null)
  })

  it('rewrites the instruction and notifies feedback only when acceptance changes', () => {
    const h = setup()
    const writes: string[] = []
    recordText(h, writes)
    const inside = dropCentre(h)
    const hand = overHand(h)
    h.board.beginDrag(island())
    for (let step = 0; step < 4; step++) h.board.moveDrag(hand[0] + step, hand[1], true)
    for (let step = 0; step < 4; step++) h.board.moveDrag(inside[0] + step, inside[1], true)
    h.present()
    h.board.moveDrag(inside[0], inside[1] + 1, true)
    h.board.moveDrag(...hand, true)
    h.board.endDrag(false)
    h.board.endDrag(false)
    expect(writes).toEqual([`text=${CANCEL}`, `text=${RELEASE}`, `text=${CANCEL}`, `text=${SUMMON}`])
    expect(h.feedback.mock.calls.map(([feedback]) => feedback)).toEqual([
      { cardId: '0-0', accepted: false },
      { cardId: '0-0', accepted: true },
      { cardId: '0-0', accepted: false },
      null,
    ])
  })

  it('reports feedback last, with the board already updated, and once when a return starts', () => {
    const h = setup()
    const stage = h.host.all('three-board-stage')[0]
    const prompt = h.host.all('three-board-instruction')[0]
    const seen: unknown[] = []
    h.feedback.mockImplementation((feedback) => {
      seen.push({
        feedback,
        dragging: stage.dataset.dragging ?? null,
        accepted: h.near.dataset.dropAccepted ?? null,
        text: prompt.children[0].textContent,
      })
    })
    h.board.beginDrag(island())
    h.board.moveDrag(...dropCentre(h), true)
    h.board.moveDrag(...overHand(h), true)
    h.board.endDrag(true)
    expect(internals(h).drag).toMatchObject({ returning: true })
    h.board.endDrag(false)
    expect(seen).toEqual([
      { feedback: { cardId: '0-0', accepted: false }, dragging: 'true', accepted: null, text: CANCEL },
      { feedback: { cardId: '0-0', accepted: true }, dragging: 'true', accepted: 'true', text: RELEASE },
      { feedback: { cardId: '0-0', accepted: false }, dragging: 'true', accepted: null, text: CANCEL },
      { feedback: null, dragging: null, accepted: null, text: SUMMON },
    ])
  })

  it.each([
    ['drag start', 'endDrag'], ['drag start', 'dispose'], ['drag acceptance', 'endDrag'], ['drag acceptance', 'dispose'],
  ] as const)('survives a %s listener that calls %s re-entrantly', (moment, method) => {
    ElementStub.context2d = context2d()
    const leases = countLeases()
    const h = setup()
    const stage = h.host.all('three-board-stage')[0]
    const inside = dropCentre(h)
    const resting = leases.live
    const reenter = () => { if (method === 'endDrag') h.board.endDrag(false); else h.board.dispose() }
    if (moment === 'drag start') h.feedback.mockImplementationOnce(reenter)
    h.board.beginDrag(island())
    if (moment === 'drag acceptance') {
      h.feedback.mockImplementationOnce(reenter)
      h.board.moveDrag(...inside, true)
    }
    expect(internals(h).drag).toBeNull()
    expect(stage.dataset.dragging).toBeUndefined()
    h.board.moveDrag(...inside, true)
    h.board.endDrag(false)
    expect(h.feedback.mock.calls.map(([feedback]) => feedback)).toEqual([
      { cardId: '0-0', accepted: false },
      ...moment === 'drag acceptance' ? [{ cardId: '0-0', accepted: true }] : [],
      null,
    ])
    expect(leases.live).toBe(method === 'dispose' ? 0 : resting)
    expect(leases.repeated).toBe(0)
  })

  it('quiets the board instruction before narrow drag text changes and restores it on unfold', () => {
    const presentation = { shell: DESKTOP, selection: NO_BOARD_SELECTION }
    const h = setup(presentation)
    const prompt = h.host.all('three-board-instruction')[0]
    expect(prompt.getAttribute('aria-live')).toBe('polite')
    const log: string[] = []
    recordText(h, log)
    const setAttribute = prompt.setAttribute.bind(prompt)
    prompt.setAttribute = (name: string, value: string) => {
      log.push(`${name}=${value}`)
      setAttribute(name, value)
    }
    h.board.beginDrag(island())
    log.length = 0
    presentation.shell = 'narrow'
    h.present()
    // The profile switch ends the drag only after the region went quiet.
    expect(log[0]).toBe('aria-live=off')
    expect(log).toContain(`text=${SUMMON}`)
    expect(prompt.hidden).toBe(true)
    log.length = 0
    h.present()
    h.board.beginDrag(island())
    expect(prompt.hidden).toBe(false)
    h.board.endDrag(false)
    expect(prompt.hidden).toBe(true)
    expect(log.filter((entry) => entry.startsWith('aria-live'))).toEqual([])
    presentation.shell = 'desktop'
    h.present()
    expect(prompt.getAttribute('aria-live')).toBe('polite')
  })

  it('lifts the narrow drag pill to the top of the scrolled stage without moving the effect caption', () => {
    const h = setup({ shell: NARROW, selection: NO_BOARD_SELECTION })
    const stage = h.host.all('three-board-stage')[0]
    const prompt = h.host.all('three-board-instruction')[0]
    const caption = h.host.all('three-board-effect-caption')[0]
    const idle = { prompt: prompt.style.top, caption: caption.style.top }
    expect(prompt.hidden).toBe(true)
    Object.assign(stage, { scrollTop: 120 })
    h.board.beginDrag(island())
    expect(prompt.hidden).toBe(false)
    expect(prompt.style.top).toBe('124px')
    expect(prompt.dataset.drag).toBe('rejected')
    h.present()
    expect(prompt.style.top).toBe('124px')
    expect(caption.style.top).toBe(idle.caption)
    h.board.moveDrag(...dropCentre(h), true)
    expect(prompt.dataset.drag).toBe('accepted')
    h.board.endDrag(false)
    expect(prompt.hidden).toBe(true)
    expect(prompt.dataset.drag).toBeUndefined()
    expect({ prompt: prompt.style.top, caption: caption.style.top }).toEqual(idle)
  })

  it('keeps a touch card clear of the drag pill near the stage top, while a mouse card stays under the cursor', () => {
    const h = setup({ shell: NARROW, selection: NO_BOARD_SELECTION })
    const canvas = h.host.all('three-board-canvas')[0]
    const prompt = h.host.all('three-board-instruction')[0]
    const { layout } = internals(h)
    // One client pixel per board unit, so layer pixels are client pixels.
    Object.assign(canvas, { clientWidth: layout.width, clientHeight: layout.height })
    h.board.beginDrag(island())
    const pillBottom = Number.parseFloat(prompt.style.top) + prompt.offsetHeight
    expect(pillBottom).toBe(48)
    let checked = 0
    for (const x of [6, layout.width / 2, layout.width - 6]) {
      for (let y = 0; y <= 160; y += 4) {
        h.board.moveDrag(x, y, true)
        expect(lifted(h).top).toBeGreaterThanOrEqual(pillBottom)
        h.board.moveDrag(x, y, false)
        expect(lifted(h)).toMatchObject({ x, y })
        checked++
      }
    }
    expect(checked).toBe(123)
  })

  it.each([['mouse', false], ['touch', true]] as const)(
    'keeps the drag pill pinned and the %s card in place when the stage scrolls mid-drag',
    (_, touch) => {
      const added = vi.spyOn(ElementStub.prototype, 'addEventListener')
      const removed = vi.spyOn(ElementStub.prototype, 'removeEventListener')
      const h = setup({ shell: NARROW, selection: NO_BOARD_SELECTION })
      const stage = h.host.all('three-board-stage')[0]
      const canvas = h.host.all('three-board-canvas')[0]
      const prompt = h.host.all('three-board-instruction')[0]
      const { layout } = internals(h)
      // A real canvas moves up with the stage's content as the stage scrolls.
      Object.assign(stage, { scrollTop: 0 })
      canvas.getBoundingClientRect = () => ({
        left: 0, top: -(stage as unknown as { scrollTop: number }).scrollTop, width: layout.width, height: layout.height,
      })
      const scroll = (top: number) => {
        Object.assign(stage, { scrollTop: top })
        stage.dispatchEvent(new Event('scroll'))
      }
      // Just inside the drop zone's edge that faces the hand, so a scroll moves the hand under the pointer.
      const pointer = client(h, layout.drop.x, layout.drop.y - layout.drop.height / 2 + 10)
      expect(pointer[1]).toBeLessThan(stage.clientHeight - 140)
      h.board.beginDrag(island())
      h.board.moveDrag(...pointer, touch)
      expect(internals(h).drag!.accepted).toBe(true)
      expect(prompt.style.top).toBe('4px')
      const before = lifted(h)
      h.feedback.mockClear()
      scroll(120)
      expect(prompt.style.top).toBe('124px')
      // The content moved up under a resting pointer, so the card moves down the content to stay put.
      expect(lifted(h).x).toBeCloseTo(before.x)
      expect(lifted(h).y).toBeCloseTo(before.y + 120)
      if (touch) expect(lifted(h).top).toBeGreaterThanOrEqual(124 + prompt.offsetHeight)
      expect(h.board.containsDrop(...pointer, touch)).toBe(false)
      expect(internals(h).drag!.accepted).toBe(false)
      expect(h.near.dataset.dropAccepted).toBeUndefined()
      expect(h.feedback).toHaveBeenCalledExactlyOnceWith({ cardId: '0-0', accepted: false })
      scroll(0)
      expect(prompt.style.top).toBe('4px')
      expect(internals(h).drag!.accepted).toBe(true)
      expect(lifted(h)).toMatchObject({ x: before.x, y: before.y })
      h.board.endDrag(false)
      const idle = prompt.style.top
      h.feedback.mockClear()
      scroll(200)
      expect(prompt.style.top).toBe(idle)
      expect(h.feedback).not.toHaveBeenCalled()
      const listeners = added.mock.calls.filter(([type]) => type === 'scroll').map(([, listener]) => listener)
      expect(listeners).toHaveLength(1)
      h.board.dispose()
      expect(removed.mock.calls.filter(([type]) => type === 'scroll').map(([, listener]) => listener)).toEqual(listeners)
      added.mockRestore()
      removed.mockRestore()
    },
  )

  it('marks the narrow type slot as "Lands here", or "+1" when it already holds a card', () => {
    const h = setup({ shell: NARROW, selection: NO_BOARD_SELECTION })
    const landing = h.scene.getObjectByName('three-landing-slot')!
    const label = h.host.all('three-drag-landing')[0]
    const slot = BASIC_LANDS.indexOf('Island')
    expect(landing.visible).toBe(false)
    h.board.beginDrag(island())
    let { layout } = internals(h)
    expect(landing.visible).toBe(true)
    expect(landing.position.x).toBeCloseTo(typeSlotX(slot, layout))
    expect(landing.position.y).toBeCloseTo(layout.rows.near.y)
    expect(landing.scale.x).toBeCloseTo(layout.cardWidth)
    expect(landing.scale.y).toBeCloseTo(layout.cardHeight)
    expect(label.textContent).toBe('Lands here')
    expect(label.hidden).toBe(false)
    expect(Number.parseFloat(label.style.left)).toBeCloseTo(layout.width / 2 + landing.position.x)
    expect(Number.parseFloat(label.style.top)).toBeCloseTo(layout.height / 2 - landing.position.y)
    h.board.endDrag(false)
    expect(landing.visible).toBe(false)
    expect(label.hidden).toBe(true)
    h.app.game!.players[0].battlefield = [{ instanceId: 'resting', card: { id: 'resting-island', name: 'Island', type: 'land' } }]
    h.present()
    h.board.beginDrag(island())
    layout = internals(h).layout
    expect(label.textContent).toBe('+1')
    expect(landing.position.x).toBeCloseTo(typeSlotX(slot, layout))
  })

  it('marks the append slot after the near battlefield outside the narrow profile', () => {
    const h = setup()
    h.app.game!.players[0].battlefield = ['a', 'b'].map((id) => ({
      instanceId: `resting-${id}`, card: { id: `resting-${id}`, name: 'Island', type: 'land' },
    }))
    h.present()
    h.board.beginDrag(island())
    const { layout } = internals(h)
    const landing = h.scene.getObjectByName('three-landing-slot')!
    expect(landing.visible).toBe(true)
    expect(landing.position.x).toBeCloseTo(cardSlotX(2, 3, layout))
    expect(landing.position.y).toBeCloseTo(layout.rows.near.y)
    expect(h.host.all('three-drag-landing')[0].textContent).toBe('Lands here')
  })

  it('restores a newer response prompt, not the summon hint, when a view update ends the drag', () => {
    const h = setup()
    const prompt = h.host.all('three-board-instruction')[0]
    h.board.beginDrag(island())
    h.board.moveDrag(...dropCentre(h), false)
    // The opponent summons while the drag is live, so the card stops being playable.
    const game = h.app.game!
    game.currentPlayer = 1
    game.players[1].hand = [{ id: 'pending-mountain', name: 'Mountain', type: 'land' }]
    h.act('play_land')
    expect(h.app.game!.phase).toBe('respond')
    expect(internals(h).drag).toBeNull()
    expect(prompt.hidden).toBe(false)
    expect(prompt.children[0].textContent).toContain('Intercept the summon of Rooftop Gargoyle?')
    expect(h.feedback).toHaveBeenLastCalledWith(null)
  })

  it('dims rows that cannot accept the card and restores their colours afterwards', () => {
    const h = setup()
    const stage = h.host.all('three-board-stage')[0]
    const colours = () => ({
      far: internals(h).surfaces.get('far')!.material.color.getHexString(),
      near: internals(h).surfaces.get('near')!.material.color.getHexString(),
      hand: internals(h).surfaces.get('hand')!.material.color.getHexString(),
      drop: internals(h).dropMaterial.color.getHexString(),
    })
    const idle = colours()
    expect(idle).toEqual({ far: '152b3b', near: '214c3b', hand: '214c3b', drop: '70e7b1' })
    h.board.beginDrag(island())
    expect(stage.dataset.dragging).toBe('true')
    expect(colours()).toEqual({ far: '08111a', near: '214c3b', hand: '08111a', drop: 'e5667d' })
    h.board.moveDrag(...dropCentre(h), true)
    expect(colours()).toEqual({ far: '08111a', near: '2d6a51', hand: '08111a', drop: '94ffc9' })
    h.board.endDrag(false)
    expect(stage.dataset.dragging).toBeUndefined()
    expect(colours()).toEqual(idle)
  })

  it('styles drag feedback with colour, outline and opacity only, above every header', () => {
    const css = readFileSync(join(__dirname, '..', 'renderers', 'three', 'graphics.css'), 'utf8')
    const properties = (selector: string) => {
      const start = css.indexOf(`${selector} {`)
      expect(start, selector).toBeGreaterThanOrEqual(0)
      const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
      return body.split(';').map((entry) => entry.split(':')[0].trim()).filter(Boolean)
    }
    const visualOnly = new Set(['background', 'box-shadow', 'outline', 'outline-offset', 'opacity', 'z-index'])
    for (const selector of [
      '.three-board-instruction[data-drag]',
      '.three-board-instruction[data-drag="accepted"]',
      '.three-board-label[data-drop-accepted="true"]',
      '.three-board-stage[data-dragging] .three-board-label:not([data-row="near"])',
      '.three-drag-layer[data-accepted="true"] .three-drag-card',
    ]) {
      for (const property of properties(selector)) expect(visualOnly, `${selector} ${property}`).toContain(property)
    }
    expect(css).toMatch(/\.three-drag-layer\s*\{[^}]*z-index:\s*3;[^}]*pointer-events:\s*none;/)
    expect(css).toMatch(/\.three-board-instruction\[data-drag\]\s*\{[^}]*z-index:\s*4;/)
  })
})

describe('Three long-press ring, peek placement and edge auto-scroll', () => {
  type Harness = ReturnType<typeof setup>
  type StageStub = ElementStub & { scrollTop: number }
  interface BoardInternals {
    readonly layout: ThreeLayout
    readonly drag: { returning: boolean; readonly accepted: boolean; readonly proxy: { readonly group: Group } } | null
    readonly autoScroll: (time: number) => void
    readonly pageScrolled: (event: Event) => void
  }
  const internals = (h: Harness) => h.board as unknown as BoardInternals
  const stageOf = (h: Harness) => h.host.all('three-board-stage')[0] as StageStub
  const LAYOUT_METRICS = ['clientWidth', 'clientHeight', 'clientLeft', 'clientTop', 'offsetHeight', 'scrollTop', 'scrollHeight'] as const
  const CANVAS_BOX = 'three-board-canvas box'
  const STAGE_BOX = 'three-board-stage box'
  /** The reads that measure a drag's geometry. */
  const boxes = (reads: readonly string[]) => reads.filter((read) => read.endsWith(' box'))
  /**
   * Logs every layout read from now on: any board or dock element's box,
   * client or offset metrics, and scroll offsets. A read made inside another
   * logged read, such as the stubbed canvas box reading the stage's scroll,
   * belongs to that read. `quiet` reads without logging, for the test's own checks.
   */
  const recordReads = (h: Harness) => {
    const reads: string[] = []
    let depth = 0
    const quiet = <T>(read: () => T): T => {
      depth += 1
      try {
        return read()
      } finally {
        depth -= 1
      }
    }
    const logged = <T>(name: string, read: () => T): T => {
      if (depth === 0) reads.push(name)
      return quiet(read)
    }
    const tree = (element: ElementStub): ElementStub[] => [element, ...element.children.flatMap(tree)]
    for (const element of [...tree(h.host), ...tree(h.dock)]) {
      const name = element.className || element.tagName
      const box = element.getBoundingClientRect
      element.getBoundingClientRect = () => logged(`${name} box`, () => box.call(element))
      for (const metric of LAYOUT_METRICS) {
        const own = Object.getOwnPropertyDescriptor(element, metric)
        const getter = own ? own.get : Object.getOwnPropertyDescriptor(ElementStub.prototype, metric)?.get
        let value: unknown = own?.value
        Object.defineProperty(element, metric, {
          configurable: true,
          get: () => logged(`${name}.${metric}`, () => getter ? getter.call(element) : value),
          set: (next: unknown) => { value = next },
        })
      }
    }
    return { reads, quiet }
  }
  /** A playable hand card that the board currently shows. */
  const handHit = (h: Harness) => {
    const card = h.app.game!.players[0].hand.find((entry) => h.registry.get(boardCardKey(entry.id, 0))?.descriptor.visible)!
    return { ...h.registry.get(boardCardKey(card.id, 0))!.descriptor.hit }
  }
  const dropCentre = (h: Harness): [number, number] => {
    const { layout } = internals(h)
    const rect = h.board.canvas.getBoundingClientRect()
    return [
      rect.left + (layout.width / 2 + layout.drop.x) * rect.width / layout.width,
      rect.top + (layout.height / 2 - layout.drop.y) * rect.height / layout.height,
    ]
  }
  /** The narrow board on a 344x200 stage: 466px of content, so it scrolls up to 266px. */
  const scrollingBoard = () => {
    // Numbered frames tell the auto-scroll's own frames apart from drawing.
    let id = 0
    const frames = vi.fn((_callback: FrameRequestCallback) => ++id)
    vi.stubGlobal('requestAnimationFrame', frames)
    const h = setup({ shell: NARROW, selection: NO_BOARD_SELECTION })
    const stage = stageOf(h)
    stage.clientWidth = 344
    stage.clientHeight = 200
    Object.assign(stage, { scrollTop: 0 })
    h.present()
    expect(stage.dataset.scrollable).toBe('true')
    expect(internals(h).layout.height).toBe(466)
    // A real canvas moves up with the stage's content as it scrolls.
    h.host.all('three-board-canvas')[0].getBoundingClientRect = () => {
      const { layout } = internals(h)
      return { left: 0, top: -stage.scrollTop, width: layout.width, height: layout.height }
    }
    const scrollFrames = () => frames.mock.calls.flatMap(([callback], index) =>
      callback === internals(h).autoScroll ? [frames.mock.results[index].value as number] : [])
    const step = (time: number) => internals(h).autoScroll(time)
    /** Scrolls the stage as a wheel or a script would, so the browser fires a scroll event. */
    const scrollTo = (top: number) => {
      stage.scrollTop = top
      stage.dispatchEvent(new Event('scroll'))
    }
    return { ...h, stage, scrollFrames, step, scrollTo }
  }

  it('scrolls a touch drag held in the bottom band in whole pixels, carrying fractions and rerunning moveDrag', () => {
    const h = scrollingBoard()
    const prompt = h.host.all('three-board-instruction')[0]
    h.board.beginDrag(handHit(h))
    const move = vi.spyOn(h.board, 'moveDrag')
    // 23.5px into the 48px bottom band: (48 - 23.5) / 48 of 600px/s is 306.25px/s.
    h.board.moveDrag(172, 176.5, true)
    expect(h.scrollFrames()).toHaveLength(1)
    move.mockClear()
    const tops = [1000, 9000, 9016, 9046].map((time) => {
      h.step(time)
      return h.stage.scrollTop
    })
    // The first frame steps 16ms and a stalled one at most 64ms.
    expect(tops).toEqual([4, 24, 29, 38])
    expect(h.scrollFrames()).toHaveLength(5)
    // Each step re-places the card under the resting finger and re-pins the pill.
    expect(move.mock.calls).toEqual(Array.from({ length: 4 }, () => [172, 176.5, true]))
    expect(prompt.style.top).toBe('42px')
  })

  it('scrolls faster deeper in a band, stops on leaving it or at either end, and never for the mouse', () => {
    const h = scrollingBoard()
    const cancelled = vi.mocked(cancelAnimationFrame)
    h.board.beginDrag(handHit(h))
    /** Starts a fresh scroll with the finger at `y`, and returns how far its first 16ms frame scrolls. */
    const firstStep = (y: number, touch = true) => {
      // Mid-stage, outside both bands, so any earlier scroll stops first.
      h.board.moveDrag(172, 100, true)
      const top = h.stage.scrollTop
      const before = h.scrollFrames().length
      h.board.moveDrag(172, y, touch)
      if (h.scrollFrames().length === before) return 0
      h.step(1000)
      return h.stage.scrollTop - top
    }
    // 306.25px/s, then 550px/s 4px from the edge, then the 600px/s maximum past it.
    expect(firstStep(176.5)).toBe(4)
    expect(firstStep(196)).toBe(8)
    h.scrollTo(100)
    expect(firstStep(230)).toBe(9)
    // Leaving the band cancels the frame; a late frame does nothing.
    const frames = h.scrollFrames().length
    h.board.moveDrag(172, 100, true)
    expect(cancelled).toHaveBeenLastCalledWith(h.scrollFrames().at(-1))
    h.step(1016)
    expect(h.stage.scrollTop).toBe(109)
    expect(h.scrollFrames()).toHaveLength(frames)
    // The top band scrolls up, and stops at the top.
    h.scrollTo(3)
    expect(firstStep(10)).toBe(-3)
    expect(h.scrollFrames()).toHaveLength(frames + 1)
    expect(firstStep(10)).toBe(0)
    // ...and the bottom band stops at the end of the board.
    h.scrollTo(264)
    h.board.moveDrag(172, 100, true)
    expect(firstStep(176.5)).toBe(2)
    expect(h.stage.scrollTop).toBe(266)
    expect(firstStep(176.5)).toBe(0)
    // A mouse drag never auto-scrolls.
    h.scrollTo(100)
    expect(firstStep(196, false)).toBe(0)
    expect(firstStep(10, false)).toBe(0)
  })

  it('measures a drag once, so its moves and auto-scroll steps read no layout yet place it as measuring again would', () => {
    const h = scrollingBoard()
    const prompt = h.host.all('three-board-instruction')[0]
    h.board.beginDrag(handHit(h))
    const { reads, quiet } = recordReads(h)
    h.board.moveDrag(172, 100, true)
    expect(boxes(reads)).toEqual([CANVAS_BOX, STAGE_BOX])
    expect(reads.filter((read) => read === 'three-board-stage.scrollTop')).toHaveLength(1)
    reads.length = 0
    h.board.moveDrag(172, 176.5, true)
    const tops = [1000, 9000, 9016, 9046].map((time) => {
      h.step(time)
      return quiet(() => h.stage.scrollTop)
    })
    expect(tops).toEqual([4, 24, 29, 38])
    expect(prompt.style.top).toBe('42px')
    h.board.moveDrag(172, 120, true)
    expect(reads).toEqual([])
    // The tracked scroll offset moved the measured canvas with the board.
    const { position } = internals(h).drag!.proxy.group
    const tracked = position.clone()
    h.window.dispatchEvent(new Event('scroll'))
    h.board.moveDrag(172, 120, true)
    expect(boxes(reads)).toEqual([CANVAS_BOX, STAGE_BOX])
    expect(position).toEqual(tracked)
  })

  it('reads only the scroll offset on a stage scroll, and re-places the card only for a scroll that it did not make', () => {
    const h = scrollingBoard()
    const prompt = h.host.all('three-board-instruction')[0]
    h.board.beginDrag(handHit(h))
    h.board.moveDrag(172, 176.5, true)
    h.step(1000)
    const { reads } = recordReads(h)
    const move = vi.spyOn(h.board, 'moveDrag')
    // An auto-scroll step's own scroll event arrives after the step placed the card.
    h.stage.dispatchEvent(new Event('scroll'))
    expect(reads).toEqual(['three-board-stage.scrollTop'])
    expect(move).not.toHaveBeenCalled()
    reads.length = 0
    h.scrollTo(60)
    expect(reads).toEqual(['three-board-stage.scrollTop'])
    expect(move).toHaveBeenCalledExactlyOnceWith(172, 176.5, true)
    expect(prompt.style.top).toBe('64px')
  })

  it.each([
    ['a render', (h: Harness) => { h.present() }],
    ['a relayout that keeps the drag', () => { ObserverStub.latest.callback() }],
  ] as const)('measures a drag again on the move after %s', (_, trigger) => {
    const h = scrollingBoard()
    // The browser's first observation of the resized stage, which a later relayout compares against.
    ObserverStub.latest.callback()
    h.board.beginDrag(handHit(h))
    h.board.moveDrag(172, 100, true)
    const { reads } = recordReads(h)
    trigger(h)
    expect(internals(h).drag).not.toBeNull()
    reads.length = 0
    h.board.moveDrag(172, 110, true)
    expect(boxes(reads)).toEqual([CANVAS_BOX, STAGE_BOX])
    reads.length = 0
    h.board.moveDrag(172, 120, true)
    expect(reads).toEqual([])
  })

  it('decides a release from the geometry behind its highlight, and measures afresh without a live drag', () => {
    const h = scrollingBoard()
    h.board.beginDrag(handHit(h))
    // The drop zone's centre, scrolled to the middle of the 200px stage.
    const [x, y] = dropCentre(h)
    h.scrollTo(y - 100)
    h.board.moveDrag(x, 100, true)
    expect(internals(h).drag!.accepted).toBe(true)
    const { reads } = recordReads(h)
    // A scroll whose event is still to come moves the zone away, yet the release does what the highlight shows.
    h.stage.scrollTop = 0
    h.board.moveDrag(x, 100, true)
    expect(h.board.containsDrop(x, 100, true)).toBe(true)
    expect(reads).toEqual([])
    // Its event re-places the card, and the release follows.
    h.stage.dispatchEvent(new Event('scroll'))
    expect(internals(h).drag!.accepted).toBe(false)
    expect(h.board.containsDrop(x, 100, true)).toBe(false)
    h.board.endDrag(false)
    reads.length = 0
    expect(h.board.containsDrop(x, 100, true)).toBe(false)
    expect(boxes(reads)).toEqual([CANVAS_BOX, STAGE_BOX])
  })

  it('pins the pill to a stage scroll that a fresh measurement finds before the stage reports it', () => {
    const h = scrollingBoard()
    const prompt = h.host.all('three-board-instruction')[0]
    h.board.beginDrag(handHit(h))
    const [x, y] = dropCentre(h)
    h.scrollTo(y - 100)
    h.board.moveDrag(x, 100, true)
    expect(prompt.style.top).toBe(`${y - 96}px`)
    // A scroll chained from the stage to the page: the page's event arrives first.
    h.stage.scrollTop = 0
    h.window.dispatchEvent(new Event('scroll'))
    expect(prompt.style.top).toBe('4px')
    expect(internals(h).drag!.accepted).toBe(false)
    const move = vi.spyOn(h.board, 'moveDrag')
    h.stage.dispatchEvent(new Event('scroll'))
    expect(move).not.toHaveBeenCalled()
    expect(prompt.style.top).toBe('4px')
  })

  it('re-places a drag at once when the page or an ancestor scrolls, ignores other scrollers, and removes its listener', () => {
    const added = vi.spyOn(EventTarget.prototype, 'addEventListener')
    const removed = vi.spyOn(EventTarget.prototype, 'removeEventListener')
    const h = scrollingBoard()
    const { pageScrolled } = internals(h)
    const scrolled = (target: unknown) => pageScrolled({ target } as unknown as Event)
    h.board.beginDrag(handHit(h))
    h.board.moveDrag(172, 100, true)
    const { reads } = recordReads(h)
    const move = vi.spyOn(h.board, 'moveDrag')
    // The stage's own scroll is tracked, and other scrollers outside its ancestors cannot move it.
    scrolled(h.stage)
    scrolled({ contains: () => false })
    expect(reads).toEqual([])
    expect(move).not.toHaveBeenCalled()
    // An ancestor's scroll can, like the page's: the event reaches the window's capture listener.
    scrolled({ contains: (node: unknown) => node === h.stage })
    expect(boxes(reads)).toEqual([CANVAS_BOX, STAGE_BOX])
    expect(move).toHaveBeenCalledExactlyOnceWith(172, 100, true)
    h.window.dispatchEvent(new Event('scroll'))
    expect(boxes(reads)).toEqual([CANVAS_BOX, STAGE_BOX, CANVAS_BOX, STAGE_BOX])
    expect(move).toHaveBeenCalledTimes(2)
    reads.length = 0
    h.board.moveDrag(172, 110, true)
    expect(reads).toEqual([])
    const listener = (calls: readonly unknown[][]) => calls.filter(([, callback]) => callback === pageScrolled)
    expect(listener(added.mock.calls)).toEqual([['scroll', pageScrolled, { capture: true, passive: true }]])
    h.board.dispose()
    expect(listener(removed.mock.calls)).toEqual([['scroll', pageScrolled, { capture: true }]])
    added.mockRestore()
    removed.mockRestore()
  })

  it('never auto-scrolls a stage that fits its board', () => {
    let id = 0
    const frames = vi.fn((_callback: FrameRequestCallback) => ++id)
    vi.stubGlobal('requestAnimationFrame', frames)
    for (const shell of [DESKTOP, NARROW]) {
      const h = setup({ shell, selection: NO_BOARD_SELECTION })
      expect(stageOf(h).dataset.scrollable).toBe('false')
      h.board.beginDrag(handHit(h))
      for (const y of [4, 740]) h.board.moveDrag(195, y, true)
      expect(frames.mock.calls.filter(([callback]) => callback === internals(h).autoScroll)).toEqual([])
      h.board.dispose()
    }
  })

  it.each(['the drag ends', 'the layout changes', 'the board is disposed'] as const)(
    'cancels the auto-scroll frame when %s, and a late frame does nothing',
    (end) => {
      const h = scrollingBoard()
      const cancelled = vi.mocked(cancelAnimationFrame)
      h.board.beginDrag(handHit(h))
      h.board.moveDrag(172, 176.5, true)
      h.step(1000)
      const [, frame] = h.scrollFrames()
      expect(frame).toBeDefined()
      if (end === 'the drag ends') h.board.endDrag(false)
      else if (end === 'the layout changes') {
        h.stage.clientWidth = 340
        ObserverStub.latest.callback()
      } else h.board.dispose()
      expect(internals(h).drag).toBeNull()
      expect(cancelled).toHaveBeenCalledWith(frame)
      const top = h.stage.scrollTop
      h.step(1016)
      expect(h.stage.scrollTop).toBe(top)
      expect(h.scrollFrames()).toHaveLength(2)
    },
  )

  it('centres the long-press ring on the finger in board pixels, hides it, and does nothing after disposal', () => {
    const h = setup()
    const layer = h.host.all('three-drag-layer')[0]
    const ring = h.host.all('three-peek-ring')[0]
    expect(ring.parent).toBe(layer)
    const { layout } = internals(h)
    // A half-scale canvas, offset inside the page.
    h.host.all('three-board-canvas')[0].getBoundingClientRect = () => ({
      left: 10, top: 20, width: layout.width / 2, height: layout.height / 2,
    })
    expect(ring.hidden).toBe(true)
    h.board.showPeekRing(110, 70)
    expect({ hidden: ring.hidden, layer: layer.hidden, left: ring.style.left, top: ring.style.top })
      .toEqual({ hidden: false, layer: false, left: '200px', top: '100px' })
    h.board.hidePeekRing()
    expect(ring.hidden).toBe(true)
    expect(layer.hidden).toBe(true)
    h.board.dispose()
    h.board.showPeekRing(110, 70)
    expect(ring.hidden).toBe(true)
  })

  it('places the peek beside the held card in client pixels, and offers none for a card off the page', () => {
    const h = setup({ shell: NARROW, selection: NO_BOARD_SELECTION })
    const player = h.app.game!.players[0]
    player.hand.push(...player.deck.splice(0))
    h.present()
    const { layout } = internals(h)
    const canvas = h.host.all('three-board-canvas')[0]
    canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: layout.width / 2, height: layout.height / 2 })
    const hit = handHit(h)
    const anchor = h.registry.get(hit.key)!.anchor()
    const card = {
      left: 10 + (layout.width / 2 + anchor.x - anchor.width / 2) / 2,
      top: 20 + (layout.height / 2 - anchor.y - anchor.height / 2) / 2,
      width: anchor.width / 2,
      height: anchor.height / 2,
    }
    for (const y of [card.top + 2, 700]) {
      const placement = h.board.peekPlacement(hit, card.left + 2, y)!
      expect(placement).toEqual(peekPlacement({
        stage: { left: 0, top: 0, width: 390, height: 760 }, card, pointer: { x: card.left + 2, y },
      }))
      // The panel never covers the held card.
      if (placement.side === 'above') expect(placement.y).toBeLessThanOrEqual(card.top)
      else expect(placement.y).toBeGreaterThanOrEqual(card.top + card.height)
    }
    // The interface's fit check reaches the layout: a refused peek opens nowhere.
    const fitted = h.board.peekPlacement(hit, card.left + 2, 700)!
    const offered: PeekPlacement[] = []
    expect(h.board.peekPlacement(hit, card.left + 2, 700, (placement) => { offered.push(placement); return true })).toEqual(fitted)
    expect(offered).toEqual([fitted])
    expect(h.board.peekPlacement(hit, card.left + 2, 700, () => false)).toBeNull()
    const hidden = player.hand.find((entry) => !h.registry.get(boardCardKey(entry.id, 0))?.descriptor.visible)!
    expect(hidden).toBeDefined()
    expect(h.board.peekPlacement({ ...hit, key: boardCardKey(hidden.id, 0), cardId: hidden.id }, 50, 50)).toBeNull()
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 })
    expect(h.board.peekPlacement(hit, 50, 50)).toBeNull()
    canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: layout.width / 2, height: layout.height / 2 })
    h.board.dispose()
    expect(h.board.peekPlacement(hit, 50, 50)).toBeNull()
  })

  it('scrolls the least distance that shows the near lane after a relayout or on returning to narrow', () => {
    const presentation = { shell: NARROW, selection: NO_BOARD_SELECTION }
    const h = setup(presentation)
    const stage = stageOf(h)
    stage.clientWidth = 344
    stage.clientHeight = 200
    Object.assign(stage, { scrollTop: 0 })
    h.present()
    const lane = () => {
      const { layout } = internals(h)
      const row = layout.rows.near
      return {
        top: Math.min(row.labelTop, layout.height / 2 - row.y - row.height / 2),
        bottom: Math.max(row.labelTop + row.labelHeight, layout.height / 2 - row.y + row.height / 2),
      }
    }
    // The lane fits the stage but starts out below its fold; presenting alone never scrolls.
    expect(lane().bottom - lane().top).toBeLessThan(200)
    expect(lane().bottom).toBeGreaterThan(200)
    expect(stage.scrollTop).toBe(0)
    const relayout = () => {
      stage.clientWidth = stage.clientWidth === 344 ? 340 : 344
      ObserverStub.latest.callback()
    }
    relayout()
    expect(stage.scrollTop).toBeCloseTo(lane().bottom - 200)
    // A lane already in view stays where the player left it.
    stage.scrollTop = Math.ceil(lane().bottom - 200) + 5
    const kept = stage.scrollTop
    relayout()
    expect(stage.scrollTop).toBe(kept)
    // A lane above the view scrolls back down to its top edge.
    stage.scrollTop = 266
    relayout()
    expect(stage.scrollTop).toBeCloseTo(lane().top)
    presentation.shell = 'desktop'
    h.present()
    stage.scrollTop = 0
    presentation.shell = 'narrow'
    h.present()
    expect(stage.scrollTop).toBeCloseTo(lane().bottom - 200)
  })

  it('ignores the primary button while a card is lifted, and accepts it once the card drops or returns', () => {
    const h = setup()
    h.board.beginDrag(handHit(h))
    emit(h.button, 'pointerdown', { isPrimary: false })
    emit(h.button, 'click')
    expect(h.activate).not.toHaveBeenCalled()
    h.board.endDrag(true)
    emit(h.button, 'click')
    expect(h.activate).toHaveBeenCalledOnce()
  })

  it('ignores hand page buttons while a card is lifted, and turns the page once the card drops or returns', () => {
    const h = setup({ shell: NARROW, selection: NO_BOARD_SELECTION })
    const player = h.app.game!.players[0]
    player.hand.push(...player.deck.splice(0))
    h.present()
    const [, label, next] = h.host.all('three-board-pagination')[0].children
    expect(label.textContent).toMatch(/^1\//)
    h.board.beginDrag(handHit(h))
    h.cancel.mockClear()
    emit(next, 'click')
    expect(label.textContent).toMatch(/^1\//)
    expect(internals(h).drag?.returning).toBe(false)
    expect(h.cancel).not.toHaveBeenCalled()
    expect(h.handPage).not.toHaveBeenCalled()
    h.board.endDrag(true)
    emit(next, 'click')
    expect(label.textContent).toMatch(/^2\//)
    expect(h.handPage).toHaveBeenCalledOnce()
  })

  it('cancels gestures and shows the near lane when only the visible stage changes, but not on unchanged callbacks', () => {
    const h = setup({ shell: NARROW, selection: NO_BOARD_SELECTION })
    const stage = stageOf(h)
    // Both stages are below the 356px minimum board, so the layout stays the same.
    stage.clientWidth = 344
    stage.clientHeight = 340
    Object.assign(stage, { scrollTop: 0 })
    ObserverStub.latest.callback()
    const layout = internals(h).layout
    expect(layout.height).toBe(466)
    const row = layout.rows.near
    const lane = {
      top: Math.min(row.labelTop, layout.height / 2 - row.y - row.height / 2),
      bottom: Math.max(row.labelTop + row.labelHeight, layout.height / 2 - row.y + row.height / 2),
    }
    expect(lane.bottom).toBeLessThanOrEqual(340)
    expect(lane.bottom).toBeGreaterThan(200)
    expect(lane.bottom - lane.top).toBeLessThan(200)
    // Repeated callbacks keep a live drag and the player's own scroll.
    h.board.beginDrag(handHit(h))
    h.cancel.mockClear()
    ObserverStub.latest.callback()
    emit(h.window, 'resize')
    expect(internals(h).drag).not.toBeNull()
    expect(h.cancel).not.toHaveBeenCalled()
    expect(stage.scrollTop).toBe(0)
    // A shorter stage keeps the minimum-height layout, but still ends the
    // gesture and scrolls the near lane back into view.
    stage.clientHeight = 200
    ObserverStub.latest.callback()
    expect(internals(h).layout).toEqual(layout)
    expect(internals(h).drag).toBeNull()
    expect(h.cancel).toHaveBeenCalledOnce()
    expect(stage.scrollTop).toBeCloseTo(lane.bottom - 200)
    ObserverStub.latest.callback()
    expect(h.cancel).toHaveBeenCalledOnce()
  })

  it.each(['resize', 'pointercancel'] as const)(
    'cancels a touch drag cleanly when %s arrives first, releasing the capture and the card lease and submitting nothing',
    (first) => {
      ElementStub.context2d = context2d()
      const leases = countLeases()
      const h = setup({ shell: NARROW, selection: NO_BOARD_SELECTION })
      const stage = stageOf(h)
      const canvas = h.host.all('three-board-canvas')[0]
      const captures = new Set<number>()
      const release = vi.fn((pointer: number) => captures.delete(pointer))
      Object.assign(canvas, {
        setPointerCapture: (pointer: number) => captures.add(pointer),
        hasPointerCapture: (pointer: number) => captures.has(pointer),
        releasePointerCapture: release,
      })
      const playCard = vi.fn()
      const activate = vi.fn()
      const interaction = new ThreeInteraction(h.board, () => buildViewModel(h.app, false), () => false, playCard, activate)
      h.cancel.mockImplementation(() => interaction.cancel())
      const resting = leases.live
      const hit = handHit(h)
      const anchor = h.registry.get(hit.key)!.anchor()
      const { layout } = internals(h)
      const pointer = { pointerId: 7, pointerType: 'touch', buttons: 1 }
      emit(canvas, 'pointerdown', { ...pointer, clientX: layout.width / 2 + anchor.x, clientY: layout.height / 2 - anchor.y })
      const [x, y] = dropCentre(h)
      emit(canvas, 'pointermove', { ...pointer, clientX: x, clientY: y })
      expect(interaction.dragging).toBe(true)
      expect(captures).toEqual(new Set([7]))
      expect(leases.live).toBe(resting + 2)
      const resize = () => {
        stage.clientWidth = 340
        ObserverStub.latest.callback()
      }
      const cancel = () => emit(canvas, 'pointercancel', { pointerId: 7, pointerType: 'touch' })
      if (first === 'resize') {
        resize()
        cancel()
      } else {
        cancel()
        resize()
      }
      expect(interaction.dragging).toBe(false)
      expect(internals(h).drag).toBeNull()
      expect(captures.size).toBe(0)
      expect(release).toHaveBeenCalledOnce()
      // Relayout re-presents the board, so its resting faces may be re-leased; none leak.
      expect(leases.repeated).toBe(0)
      expect(h.host.all('three-drag-card')[0].hidden).toBe(true)
      emit(canvas, 'pointerup', { ...pointer, buttons: 0, clientX: x, clientY: y })
      expect(playCard).not.toHaveBeenCalled()
      expect(activate).not.toHaveBeenCalled()
      expect(h.feedback).toHaveBeenLastCalledWith(null)
      interaction.dispose()
      h.board.dispose()
      expect(leases.live).toBe(0)
    },
  )

  it('keeps a long press on the game board from selecting text or opening the touch callout', () => {
    const css = readFileSync(join(__dirname, '..', 'renderers', 'three', 'graphics.css'), 'utf8')
    expect(css).toMatch(
      /\.three-root--game \.three-board-stage\s*\{[^}]*-webkit-touch-callout:\s*none;[^}]*-webkit-user-select:\s*none;[^}]*user-select:\s*none;/,
    )
  })
})

describe('Three short-landscape rail board', () => {
  type Harness = ReturnType<typeof setup>
  type StageStub = ElementStub & { scrollTop: number }
  interface BoardInternals {
    readonly layout: ThreeLayout
    readonly drag: {
      readonly side: string; readonly accepted: boolean; readonly width: number; readonly height: number
      readonly proxy: { readonly group: Group }
    } | null
    readonly landing: Mesh
    readonly autoScroll: (time: number) => void
  }
  const RAIL = 'rail' as ThreeShellProfile
  /** The stage's visible height. */
  const VIEW = 220
  const internals = (h: Harness) => h.board as unknown as BoardInternals
  /** A playable hand card that the board currently shows. */
  const handHit = (h: Harness) => {
    const card = h.app.game!.players[0].hand.find((entry) => h.registry.get(boardCardKey(entry.id, 0))?.descriptor.visible)!
    return { ...h.registry.get(boardCardKey(card.id, 0))!.descriptor.hit }
  }
  /** A row's lane bottom in board pixels from the top. */
  const bottomOf = (h: Harness, row: 'near' | 'hand') => {
    const { layout } = internals(h)
    return layout.height / 2 - layout.rows[row].y + layout.rows[row].height / 2
  }
  /**
   * The Fold4 cover screen held sideways (882x232): a 637x220 stage beside the
   * rail, with single-line headers, so the 356px minimum board scrolls 136px.
   */
  const coverBoard = (presentation: ThreeBoardPresentation) => {
    // Numbered frames tell the auto-scroll's own frames apart from drawing.
    let id = 0
    const frames = vi.fn((_callback: FrameRequestCallback) => ++id)
    vi.stubGlobal('requestAnimationFrame', frames)
    const h = setup(presentation)
    const stage = h.host.all('three-board-stage')[0] as StageStub
    for (const sizer of h.host.all('three-board-label three-board-sizer')) {
      Object.defineProperty(sizer, 'offsetHeight', { configurable: true, value: sizer.dataset.row === 'hand' ? 22 : 21 })
    }
    Object.assign(stage, { scrollTop: 0 })
    stage.clientWidth = 637
    stage.clientHeight = VIEW
    ObserverStub.latest.callback()
    expect(internals(h).layout.height).toBe(356)
    expect(stage.dataset.scrollable).toBe('true')
    // A real canvas moves up with the stage's content as it scrolls.
    const canvas = h.host.all('three-board-canvas')[0]
    canvas.getBoundingClientRect = () => {
      const { layout } = internals(h)
      return { left: 0, top: -stage.scrollTop, width: layout.width, height: layout.height }
    }
    const scrollFrames = () => frames.mock.calls.filter(([callback]) => callback === internals(h).autoScroll).length
    const step = (time: number) => internals(h).autoScroll(time)
    return { ...h, stage, canvas, scrollFrames, step }
  }

  it('anchors the near lane and the whole hand in view, where the plain rail leaves the hand below the fold', () => {
    const presentation = { shell: RAIL, short: true, selection: NO_BOARD_SELECTION }
    const h = coverBoard(presentation)
    const { layout } = internals(h)
    const nearTop = layout.height / 2 - layout.rows.near.y - layout.rows.near.height / 2
    // End Turn lives in the rail, off the board.
    expect(h.button.parent).toBe(h.dock)
    expect(h.stage.scrollTop).toBeCloseTo(bottomOf(h, 'hand') - VIEW)
    expect(nearTop).toBeGreaterThanOrEqual(h.stage.scrollTop)
    expect(layout.rows.hand.labelTop).toBeGreaterThanOrEqual(h.stage.scrollTop)
    // From the top, the plain rail already shows its near lane, so it stays put.
    h.stage.scrollTop = 0
    presentation.short = false
    h.present()
    expect(h.stage.scrollTop).toBe(0)
    expect(internals(h).layout.rows.hand.labelTop).toBeGreaterThanOrEqual(VIEW)
    presentation.short = true
    h.present()
    expect(h.stage.scrollTop).toBeCloseTo(bottomOf(h, 'hand') - VIEW)
  })

  it('reserves a 44px pager strip for a paged short-rail hand, and 50px in the other unfolded shells', () => {
    const presentation = { shell: RAIL, short: true, selection: NO_BOARD_SELECTION }
    const h = coverBoard(presentation)
    const header = h.host.all('three-board-label').find((entry) => entry.dataset.row === 'hand')!
    const player = h.app.game!.players[0]
    player.hand.push(...player.deck.splice(0, 20))
    h.present()
    expect(narrowHandPageSize(internals(h).layout)).toBeLessThan(player.hand.length)
    expect(internals(h).layout.rows.hand.labelHeight).toBe(44)
    expect(header.style.height).toBe('44px')
    presentation.short = false
    h.present()
    expect(internals(h).layout.rows.hand.labelHeight).toBe(50)
    expect(header.style.height).toBe('50px')
    // Only a rail can be short.
    presentation.shell = 'dock'
    presentation.short = true
    h.present()
    expect(internals(h).layout.rows.hand.labelHeight).toBe(50)
  })

  it('lifts a touch drag beside the finger even with room above it, where the plain rail lifts it above', () => {
    const presentation = { shell: RAIL, short: true, selection: NO_BOARD_SELECTION }
    const h = coverBoard(presentation)
    /** Lifts a hand card with the finger low over the hand, and returns the card's client box. */
    const lift = () => {
      h.board.beginDrag(handHit(h))
      h.board.moveDrag(200, 180, true)
      const { drag, layout } = internals(h)
      const { position, scale } = drag!.proxy.group
      const x = position.x + layout.width / 2
      const y = layout.height / 2 - position.y - h.stage.scrollTop
      const width = drag!.width * scale.x
      const height = drag!.height * scale.y
      return { side: drag!.side, left: x - width / 2, bottom: y + height / 2 }
    }
    const beside = lift()
    // The roomier side, clear of the finger.
    expect(beside.side).toBe('right')
    expect(beside.left).toBeGreaterThanOrEqual(200 + 20 - 0.001)
    presentation.short = false
    h.present()
    const above = lift()
    expect(above.side).toBe('above')
    expect(above.bottom).toBeLessThanOrEqual(180 - 20 + 0.001)
  })

  it('lifts the card to the side of the finger that leaves the landing ghost in view', () => {
    const h = coverBoard({ shell: RAIL, short: true, selection: NO_BOARD_SELECTION })
    h.board.beginDrag(handHit(h))
    const { drag, layout, landing } = internals(h)
    /** Board pixels from the top-left corner, which are also client pixels plus the scroll. */
    const ghost: LayerRect = {
      left: layout.width / 2 + landing.position.x - landing.scale.x / 2,
      top: layout.height / 2 - landing.position.y - landing.scale.y / 2,
      width: landing.scale.x, height: landing.scale.y,
    }
    const card = (): LayerRect => {
      const { position, scale } = drag!.proxy.group
      const width = drag!.width * scale.x
      const height = drag!.height * scale.y
      return { left: layout.width / 2 + position.x - width / 2, top: layout.height / 2 - position.y - height / 2, width, height }
    }
    const spans = (a: number, aSize: number, b: number, bSize: number) => a < b + bSize && b < a + aSize
    // The anchored stage shows the ghost, and a card fits on either side of a finger 10px from it.
    expect(ghost.top).toBeGreaterThanOrEqual(h.stage.scrollTop)
    expect(ghost.top + ghost.height).toBeLessThanOrEqual(h.stage.scrollTop + VIEW)
    const reach = 10 + 20 + drag!.width * TOUCH_DRAG_SCALE
    expect(ghost.left - reach).toBeGreaterThan(4)
    expect(ghost.left + ghost.width + reach).toBeLessThan(layout.width - 4)
    const y = ghost.top + ghost.height / 2 - h.stage.scrollTop
    const left = ghost.left - 10
    const right = ghost.left + ghost.width + 10
    for (const [x, side] of [[left, 'left'], [right, 'right'], [left, 'left']] as const) {
      h.board.moveDrag(x, y, true)
      expect(drag!.side).toBe(side)
      const box = card()
      // Level with the ghost, so only the side keeps it uncovered.
      expect(spans(box.top, box.height, ghost.top, ghost.height)).toBe(true)
      expect(spans(box.left, box.width, ghost.left, ghost.width)).toBe(false)
    }
  })

  it('ends a live drag and re-anchors when the rail turns short or back, but keeps it across other renders', () => {
    const presentation = { shell: RAIL, short: false, selection: NO_BOARD_SELECTION }
    const h = coverBoard(presentation)
    expect(h.stage.scrollTop).toBe(0)
    const nearLabelTop = internals(h).layout.rows.near.labelTop
    for (const short of [true, false]) {
      h.board.beginDrag(handHit(h))
      h.cancel.mockClear()
      h.present()
      expect(internals(h).drag).not.toBeNull()
      presentation.short = short
      h.present()
      expect(internals(h).drag).toBeNull()
      expect(h.cancel).toHaveBeenCalledOnce()
      expect(h.stage.scrollTop).toBeCloseTo(short ? bottomOf(h, 'hand') - VIEW : nearLabelTop)
    }
  })

  it('summons once from a touch drag that auto-scrolls over the drop zone, and a drag scrolled back over the hand submits nothing', () => {
    const h = coverBoard({ shell: RAIL, short: true, selection: NO_BOARD_SELECTION })
    const captures = new Set<number>()
    Object.assign(h.canvas, {
      setPointerCapture: (pointer: number) => captures.add(pointer),
      hasPointerCapture: (pointer: number) => captures.has(pointer),
      releasePointerCapture: (pointer: number) => captures.delete(pointer),
    })
    const playCard = vi.fn()
    const activate = vi.fn()
    const interaction = new ThreeInteraction(h.board, () => buildViewModel(h.app, false), () => false, playCard, activate)
    h.cancel.mockImplementation(() => interaction.cancel())
    const { layout } = internals(h)
    const pointer = { pointerId: 7, pointerType: 'touch', buttons: 1 }
    const move = (clientX: number, clientY: number) => emit(h.canvas, 'pointermove', { ...pointer, clientX, clientY })
    const release = (clientX: number, clientY: number) =>
      emit(h.canvas, 'pointerup', { ...pointer, buttons: 0, clientX, clientY })
    /** Presses a hand card where the scrolled board shows it. */
    const press = () => {
      const hit = handHit(h)
      const anchor = h.registry.get(hit.key)!.anchor()
      const clientY = layout.height / 2 - anchor.y - h.stage.scrollTop
      expect(clientY).toBeGreaterThan(0)
      expect(clientY).toBeLessThan(VIEW)
      emit(h.canvas, 'pointerdown', { ...pointer, clientX: layout.width / 2 + anchor.x, clientY })
      return hit
    }
    const x = layout.width / 2 + layout.drop.x
    // Scrolled to the end of the board, a finger held in the top band over the
    // drop zone scrolls it back up, and the landing ghost stays in view.
    h.stage.scrollTop = 136
    const hit = press()
    move(x, 30)
    expect(interaction.dragging).toBe(true)
    expect(internals(h).drag!.accepted).toBe(true)
    expect(h.scrollFrames()).toBe(1)
    for (const time of [1000, 1064, 1128]) h.step(time)
    const scrolled = h.stage.scrollTop
    expect(scrolled).toBeLessThan(120)
    expect(internals(h).drag!.accepted).toBe(true)
    const { landing } = internals(h)
    const landingTop = layout.height / 2 - landing.position.y - landing.scale.y / 2
    expect(landing.visible).toBe(true)
    expect(landingTop).toBeGreaterThanOrEqual(scrolled)
    expect(landingTop + landing.scale.y).toBeLessThanOrEqual(scrolled + VIEW)
    release(x, 30)
    expect(playCard).toHaveBeenCalledExactlyOnceWith(hit.cardId)
    expect(interaction.dragging).toBe(false)
    // The scroll ended with the drag; a late frame does nothing.
    h.step(1192)
    expect(h.stage.scrollTop).toBe(scrolled)
    // A second drag goes over the drop zone, then back down over the hand,
    // which scrolls the board to its end again; releasing there cancels.
    press()
    move(x, 30)
    expect(internals(h).drag!.accepted).toBe(true)
    move(x, 200)
    expect(internals(h).drag!.accepted).toBe(false)
    for (const time of [2000, 2064, 2128, 2192]) h.step(time)
    expect(h.stage.scrollTop).toBe(136)
    release(x, 200)
    expect(playCard).toHaveBeenCalledOnce()
    expect(activate).not.toHaveBeenCalled()
    expect(interaction.dragging).toBe(false)
    expect(captures.size).toBe(0)
    expect(h.feedback).toHaveBeenLastCalledWith(null)
    interaction.dispose()
  })
})
