import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_BOARD_THEME } from '../app/board-theme'
import { DEFAULT_CARD_VISUAL_STYLE } from '../app/card-visual-styles'
import { DEFAULT_RENDER_QUALITY_PREFERENCE } from '../app/render-quality'
import { HIDDEN_HAND_CARD_NAME, type AppViewModel } from '../app/types'
import * as phaserDrag from '../renderers/phaser/drag-state'
import * as sharedDrag from '../renderers/shared/drag-state'
import type { BoardHit, ThreeBoardApi } from '../renderers/three/contracts'
import { ThreeInteraction } from '../renderers/three/interaction'

type Listener = (event: never) => void
type EventFields = Record<string, unknown>

class FakeTarget {
  readonly listeners = new Map<string, Set<Listener>>()

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type)
    listeners?.delete(listener)
    if (listeners?.size === 0) {
      this.listeners.delete(type)
    }
  }

  emit(type: string, fields: EventFields = {}): EventFields {
    const event = {
      type,
      target: this,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: 180,
      clientY: 620,
      relatedTarget: null,
      preventDefault: vi.fn(),
      ...fields,
    }
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event as never)
    }
    return event
  }
}

class FakeWindow extends FakeTarget {
  innerWidth = 1024
  innerHeight = 768
}

class FakeDocument extends FakeTarget {
  hidden = false
  readonly defaultView = new FakeWindow()
}

class FakeCanvas extends FakeTarget {
  readonly ownerDocument = new FakeDocument()
  readonly captures = new Set<number>()
  width = 1600
  height = 1300
  readonly getBoundingClientRect = vi.fn(() => ({
    left: 100, top: 50, width: 800, height: 650,
  }))
  readonly setPointerCapture = vi.fn((id: number) => {
    this.captures.add(id)
  })
  readonly hasPointerCapture = vi.fn((id: number) => this.captures.has(id))
  readonly releasePointerCapture = vi.fn((id: number) => {
    this.captures.delete(id)
    this.emit('lostpointercapture', { pointerId: id })
  })

  override emit(type: string, fields: EventFields = {}): EventFields {
    const event = super.emit(type, fields)
    this.ownerDocument.defaultView.emit(type, event)
    return event
  }
}

const handHit: BoardHit = {
  key: 'hand:0:hand-card',
  cardId: 'hand-card',
  name: 'Forest',
  owner: 0,
  zone: 'hand',
  playable: true,
}

const battlefieldHit: BoardHit = {
  key: 'battlefield:1:field-instance',
  cardId: 'field-card',
  instanceId: 'field-instance',
  name: 'Mountain',
  owner: 1,
  zone: 'battlefield',
  playable: false,
}

function createView(): AppViewModel {
  return {
    mode: 'local-hvh',
    renderer: 'dom',
    status: '',
    offer: '',
    answer: '',
    seed: 42,
    controllers: ['human', 'human'],
    aiLevel: 'basic',
    cardVisualStyle: DEFAULT_CARD_VISUAL_STYLE,
    animationSpeed: 'off',
    boardTheme: DEFAULT_BOARD_THEME,
    renderQualityPreference: DEFAULT_RENDER_QUALITY_PREFERENCE,
    p2pConnected: false,
    p2pStarted: false,
    tutorial: { active: false, stepId: null, hint: null },
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
    recording: { canSave: false, canLoadLocal: true, hasLocalSave: false, metadata: null },
    replay: { active: false, step: 0, totalSteps: 0, isPlaying: false },
    game: {
      turn: 1,
      phase: 'main',
      winnerText: '',
      actor: 0,
      actorControl: 'human',
      canInput: true,
      pendingLandName: null,
      pendingLandPlay: null,
      pendingPlainsReuseName: null,
      players: [
        {
          id: 0, handCount: 1, deckCount: 10, graveyardCount: 0,
          handCards: [{ id: handHit.cardId, name: handHit.name }],
          graveyardCards: [],
          battlefield: [],
        },
        {
          id: 1, handCount: 0, deckCount: 10, graveyardCount: 0,
          handCards: [],
          graveyardCards: [],
          battlefield: [{
            cardId: battlefieldHit.cardId,
            instanceId: battlefieldHit.instanceId!,
            name: battlefieldHit.name,
          }],
        },
      ],
      legal: {
        playLandByCard: {
          [handHit.cardId]: [{
            action: { type: 'play_land', actor: 0, cardId: handHit.cardId },
            label: 'Play Forest',
          }],
        },
        counterOptions: [],
        swampDiscardOptions: [],
        plainsReuseOptions: [],
        canEndTurn: true,
        canPassResponse: false,
      },
      log: [],
      events: [],
      isReplay: false,
      revealedEnemyHandForSwamp: null,
    },
  }
}

function createHarness() {
  const canvas = new FakeCanvas()
  const controls = {
    view: createView() as AppViewModel | null,
    hit: { ...handHit } as BoardHit | null,
    blocked: false,
    dragging: false,
  }
  const board = {
    canvas: canvas as unknown as HTMLCanvasElement,
    hitTest: vi.fn((x: number, y: number) => (
      !controls.dragging && x >= 130 && x <= 230 && y >= 580 && y <= 660 ? controls.hit : null
    )),
    containsDrop: vi.fn((x: number, y: number) => x >= 350 && x <= 750 && y >= 120 && y <= 480),
    beginDrag: vi.fn(() => { controls.dragging = true }),
    moveDrag: vi.fn(),
    endDrag: vi.fn(() => { controls.dragging = false }),
    render: vi.fn(),
    playEffect: vi.fn(() => () => {}),
    setVisible: vi.fn(),
    dispose: vi.fn(),
  } satisfies ThreeBoardApi
  const playCard = vi.fn()
  const activate = vi.fn()
  const hover = vi.fn()
  const interaction = new ThreeInteraction(
    board, () => controls.view, () => controls.blocked, playCard, activate, hover,
  )
  return {
    interaction, canvas, board, playCard, activate, hover, controls,
    document: canvas.ownerDocument,
    window: canvas.ownerDocument.defaultView,
    start: (fields: EventFields = {}) => canvas.emit('pointerdown', fields),
    move: (fields: EventFields = {}) => canvas.emit('pointermove', fields),
    release: (fields: EventFields = {}) => canvas.emit('pointerup', fields),
    drop: (fields: EventFields = {}) => canvas.emit('pointerup', {
      clientX: 420, clientY: 220, ...fields,
    }),
  }
}

function responseHarness() {
  const h = createHarness()
  const game = h.controls.view!.game!
  game.phase = 'respond'
  game.pendingLandName = 'Swamp'
  game.players[0].handCards.unshift({ id: 'required-island', name: 'Island' })
  game.players[0].handCount = 2
  game.legal.playLandByCard = {}
  game.legal.counterOptions = [{
    action: { type: 'counter_land', actor: 0, discardCardId: handHit.cardId },
    label: 'Counter with Island (discard Island + Forest)',
  }]
  game.legal.canPassResponse = true
  return h
}

type Harness = ReturnType<typeof createHarness>

describe('ThreeInteraction', () => {
  it('previews idle mouse movement without capture, submission, prevention or redundant notifications', () => {
    const h = createHarness()
    const event = h.move({ buttons: 0 })
    expect(h.hover).toHaveBeenCalledExactlyOnceWith(handHit)
    h.move({ buttons: 0, clientX: 185 })
    expect(h.hover).toHaveBeenCalledTimes(1)
    expect(h.canvas.setPointerCapture).not.toHaveBeenCalled()
    expect(h.board.beginDrag).not.toHaveBeenCalled()
    expect(h.playCard).not.toHaveBeenCalled()
    expect(h.activate).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    h.controls.hit = battlefieldHit
    h.move({ buttons: 0 })
    expect(h.hover).toHaveBeenLastCalledWith(battlefieldHit)
    h.interaction.dispose()
    expect(h.hover).toHaveBeenLastCalledWith(null)
  })

  it.each([
    { pointerType: 'touch', buttons: 0 },
    { pointerType: 'pen', buttons: 0 },
    { pointerType: '', buttons: 0 },
    { buttons: 1 }, { buttons: 2 }, { buttons: 4 },
    { buttons: 0, isPrimary: false }, { buttons: 0, clientX: -1 },
  ])('does not add mouse-hover behavior to %j', (event) => {
    const h = createHarness()
    h.move(event)
    expect(h.hover).not.toHaveBeenCalled()
    expect(h.activate).not.toHaveBeenCalled()
    expect(h.canvas.setPointerCapture).not.toHaveBeenCalled()
    h.interaction.dispose()
  })

  it.each([
    ['pointer exit', (h: Harness) => h.canvas.emit('pointerleave')],
    ['empty board', (h: Harness) => h.move({ buttons: 0, clientX: 300 })],
    ['mouse down', (h: Harness) => h.start()],
    ['secondary down', (h: Harness) => h.start({ button: 2 })],
    ['window exit', (h: Harness) => h.window.emit('pointerout')],
    ['blur', (h: Harness) => h.window.emit('blur')],
    ['Escape', (h: Harness) => h.window.emit('keydown', { key: 'Escape' })],
    ['visibility', (h: Harness) => { h.document.hidden = true; h.document.emit('visibilitychange') }],
    ['reset', (h: Harness) => h.interaction.cancel()],
    ['disposal', (h: Harness) => h.interaction.dispose()],
  ] as const)('clears mouse hover on %s without firing an action', (_reason, cancel) => {
    const h = createHarness()
    h.move({ buttons: 0 })
    cancel(h)
    expect(h.hover).toHaveBeenNthCalledWith(2, null)
    expect(h.activate).not.toHaveBeenCalled()
    expect(h.playCard).not.toHaveBeenCalled()
    h.interaction.dispose()
  })

  it.each([
    ['decision', (h: Harness) => { h.controls.view!.game!.turn += 1 }],
    ['legality', (h: Harness) => { h.controls.view!.game!.legal.playLandByCard = {} }],
    ['menu', (h: Harness) => { h.controls.blocked = true }],
    ['removed source', (h: Harness) => { h.controls.view!.game!.players[0].handCards = [] }],
    ['hidden source', (h: Harness) => { h.controls.view!.game!.players[0].handCards[0].name = HIDDEN_HAND_CARD_NAME }],
    ['session', (h: Harness) => { h.controls.view!.seed += 1 }],
  ] as const)('reconciles hovered cards after %s changes', (_reason, update) => {
    const h = createHarness()
    h.move({ buttons: 0 })
    update(h)
    h.interaction.reconcile()
    expect(h.hover).toHaveBeenNthCalledWith(2, null)
    h.interaction.dispose()
  })

  it('preserves hover across status/settings and never previews stale hidden AI cards', () => {
    const h = createHarness()
    h.move({ buttons: 0 })
    h.controls.view = { ...h.controls.view!, status: 'Saved', animationSpeed: 'normal' }
    h.interaction.reconcile()
    expect(h.hover).toHaveBeenCalledTimes(1)
    h.controls.view.controllers = ['ai', 'human']
    h.interaction.reconcile()
    expect(h.hover).toHaveBeenLastCalledWith(null)
    h.hover.mockClear()
    h.move({ buttons: 0 })
    expect(h.hover).not.toHaveBeenCalled()
    h.interaction.dispose()
  })

  it('does not reopen hover during a drag or alter the explicit mouse/touch/pen tap path', () => {
    for (const pointerType of ['mouse', 'touch', 'pen']) {
      const h = createHarness()
      h.move({ buttons: 0 })
      h.start({ pointerType })
      h.move({ pointerType })
      expect(h.hover).toHaveBeenLastCalledWith(null)
      h.release({ pointerType })
      expect(h.activate).toHaveBeenCalledExactlyOnceWith(handHit)
      expect(h.hover).toHaveBeenCalledTimes(2)
      h.interaction.dispose()
    }
  })

  it.each(['mouse', 'touch', 'pen'])('activates a %s response tap exactly once without dragging', (pointerType) => {
    const h = responseHarness()
    h.start({ pointerType })
    h.release({ pointerType })
    h.release({ pointerType })
    expect(h.activate).toHaveBeenCalledExactlyOnceWith(handHit)
    expect(h.board.beginDrag).not.toHaveBeenCalled()
    expect(h.board.containsDrop).not.toHaveBeenCalled()
    expect(h.playCard).not.toHaveBeenCalled()
    expect(h.canvas.captures.size).toBe(0)
    h.interaction.dispose()
  })

  it.each(['mouse', 'touch', 'pen'])('does not counter after a %s swipe returning to the response card', (pointerType) => {
    const h = responseHarness()
    h.start({ pointerType })
    h.move({ pointerType, clientX: 180 + sharedDrag.TOUCH_DRAG_THRESHOLD_PX })
    h.release({ pointerType })
    expect(h.activate).not.toHaveBeenCalled()
    expect(h.board.beginDrag).not.toHaveBeenCalled()
    expect(h.playCard).not.toHaveBeenCalled()
    h.interaction.dispose()
  })

  it.each([
    ['counter removed', (view: AppViewModel) => { view.game!.legal.counterOptions = [] }],
    ['pending land', (view: AppViewModel) => { view.game!.pendingLandName = 'Forest' }],
    ['required Island replaced', (view: AppViewModel) => { view.game!.players[0].handCards[0].id = 'new-island' }],
    ['hand order', (view: AppViewModel) => { view.game!.players[0].handCards.reverse() }],
  ] as const)('invalidates a same-phase response gesture on %s', (_name, change) => {
    const h = responseHarness()
    h.start({ pointerType: 'touch' })
    change(h.controls.view!)
    h.release({ pointerType: 'touch' })
    expect(h.activate).not.toHaveBeenCalled()
    expect(h.canvas.captures.size).toBe(0)
    h.interaction.dispose()
  })

  it('preserves response taps across unrelated status/settings notifications', () => {
    const h = responseHarness()
    h.start()
    h.controls.view = { ...h.controls.view!, status: 'Saved', animationSpeed: 'off' }
    h.interaction.reconcile()
    h.release()
    expect(h.activate).toHaveBeenCalledOnce()
    h.interaction.dispose()
  })

  it('keeps the Phaser drag-state exports identical to the shared implementation', () => {
    expect(phaserDrag).toEqual(sharedDrag)
    expect(phaserDrag.DragStateMachine).toBe(sharedDrag.DragStateMachine)
  })

  it('captures immediately, follows a mouse without a threshold, and submits only once', () => {
    const h = createHarness()
    h.start()
    expect(h.canvas.setPointerCapture).toHaveBeenCalledExactlyOnceWith(1)
    expect(h.board.beginDrag).toHaveBeenCalledExactlyOnceWith(handHit)
    expect(h.board.moveDrag).toHaveBeenLastCalledWith(180, 620, false)
    h.move({ clientX: 181 })
    expect(h.board.moveDrag).toHaveBeenLastCalledWith(181, 620, false)
    h.drop()
    h.drop()
    h.window.emit('pointerup', { clientX: 420, clientY: 220 })
    expect(h.playCard).toHaveBeenCalledExactlyOnceWith(handHit.cardId)
    expect(h.activate).not.toHaveBeenCalled()
    expect(h.board.endDrag).toHaveBeenCalledExactlyOnceWith(false)
    expect(h.canvas.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1)
    expect(h.canvas.captures.size).toBe(0)
  })

  it('restores a mouse source before hit-testing a zero-movement preview, even in the drop zone', () => {
    const h = createHarness()
    h.board.containsDrop.mockReturnValue(true)
    h.activate.mockImplementation(() => {
      expect(h.controls.dragging).toBe(false)
      expect(h.canvas.captures.size).toBe(0)
      h.interaction.reconcile()
      h.interaction.cancel()
    })
    h.start()
    expect(h.board.hitTest(180, 620)).toBeNull()
    h.release()
    h.canvas.emit('click')
    h.release()
    expect(h.activate).toHaveBeenCalledExactlyOnceWith(handHit)
    expect(h.playCard).not.toHaveBeenCalled()
    expect(h.board.containsDrop).not.toHaveBeenCalled()
    expect(h.board.endDrag).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('classifies even a one-pixel mouse movement as a drag, not a preview', () => {
    const h = createHarness()
    h.start()
    h.release({ clientX: 181 })
    expect(h.board.endDrag).toHaveBeenCalledExactlyOnceWith(true)
    expect(h.activate).not.toHaveBeenCalled()
    expect(h.playCard).not.toHaveBeenCalled()
  })

  it.each(['touch', 'pen'])('previews a sub-threshold %s tap without hiding the source', (pointerType) => {
    const h = createHarness()
    h.start({ pointerType })
    h.move({ pointerType, clientX: 180 + sharedDrag.TOUCH_DRAG_THRESHOLD_PX - 1 })
    expect(h.board.beginDrag).not.toHaveBeenCalled()
    expect(h.board.moveDrag).not.toHaveBeenCalled()
    h.release({ pointerType })
    expect(h.activate).toHaveBeenCalledExactlyOnceWith(handHit)
    expect(h.board.endDrag).not.toHaveBeenCalled()
    expect(h.playCard).not.toHaveBeenCalled()
    expect(h.canvas.captures.size).toBe(0)
  })

  it.each(['touch', 'pen'])('starts %s at the exact threshold and passes client pixels unchanged', (pointerType) => {
    const h = createHarness()
    h.start({ pointerType })
    h.move({ pointerType, clientX: 180 + sharedDrag.TOUCH_DRAG_THRESHOLD_PX })
    expect(h.board.beginDrag).toHaveBeenCalledExactlyOnceWith(handHit)
    expect(h.board.moveDrag).toHaveBeenLastCalledWith(
      180 + sharedDrag.TOUCH_DRAG_THRESHOLD_PX, 620, true,
    )
    h.move({ pointerType, clientX: 420, clientY: 220 })
    expect(h.board.moveDrag).toHaveBeenLastCalledWith(420, 220, true)
    h.drop({ pointerType })
    expect(h.board.hitTest).toHaveBeenCalledExactlyOnceWith(180, 620)
    expect(h.board.containsDrop).toHaveBeenCalledExactlyOnceWith(420, 220)
    expect(h.playCard).toHaveBeenCalledExactlyOnceWith(handHit.cardId)
    expect(h.canvas.getBoundingClientRect).not.toHaveBeenCalled()
  })

  it('never applies the visual touch offset to drop geometry', () => {
    const h = createHarness()
    h.start({ pointerType: 'touch' })
    h.release({ pointerType: 'touch', clientX: 420, clientY: 500 })
    expect(h.board.moveDrag).toHaveBeenLastCalledWith(420, 500, true)
    expect(h.board.containsDrop).toHaveBeenCalledExactlyOnceWith(420, 500)
    expect(h.playCard).not.toHaveBeenCalled()
    expect(h.board.endDrag).toHaveBeenCalledExactlyOnceWith(true)
  })

  it.each(['mouse', 'touch', 'pen'])('uses final %s release coordinates when moves were coalesced', (pointerType) => {
    const h = createHarness()
    h.start({ pointerType })
    h.drop({ pointerType })
    expect(h.playCard).toHaveBeenCalledExactlyOnceWith(handHit.cardId)
    expect(h.activate).not.toHaveBeenCalled()
  })

  it.each(['mouse', 'touch', 'pen'])('does not turn a returning %s drag into a tap', (pointerType) => {
    const h = createHarness()
    h.start({ pointerType })
    h.move({ pointerType, clientX: 420, clientY: 220 })
    h.release({ pointerType })
    expect(h.playCard).not.toHaveBeenCalled()
    expect(h.activate).not.toHaveBeenCalled()
    expect(h.board.endDrag).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('ignores other pointers, including their cancellation and capture-loss events', () => {
    const h = createHarness()
    h.start({ pointerType: 'touch' })
    h.start({ pointerId: 2, pointerType: 'touch' })
    h.move({ pointerId: 2, pointerType: 'touch', clientX: 420, clientY: 220 })
    h.drop({ pointerId: 2, pointerType: 'touch' })
    h.canvas.emit('pointercancel', { pointerId: 2 })
    h.canvas.emit('lostpointercapture', { pointerId: 2 })
    expect(h.canvas.setPointerCapture).toHaveBeenCalledExactlyOnceWith(1)
    expect(h.board.beginDrag).not.toHaveBeenCalled()
    h.drop({ pointerType: 'touch' })
    expect(h.playCard).toHaveBeenCalledExactlyOnceWith(handHit.cardId)
  })

  it.each([
    { button: 1 },
    { button: 2 },
    { isPrimary: false, pointerType: 'touch' },
    { pointerId: -1 },
    { pointerId: 1.5 },
    { clientX: Number.NaN },
    { clientY: Number.POSITIVE_INFINITY },
    { clientX: -1 },
    { clientX: 1024 },
  ])('ignores unsupported pointerdown %j', (fields) => {
    const h = createHarness()
    h.start(fields)
    h.drop()
    expect(h.canvas.setPointerCapture).not.toHaveBeenCalled()
    expect(h.board.beginDrag).not.toHaveBeenCalled()
    expect(h.playCard).not.toHaveBeenCalled()
  })

  it('does not lose the primary gesture when a secondary button is released', () => {
    const h = createHarness()
    h.start()
    h.release({ button: 2, buttons: 1 })
    expect(h.board.endDrag).not.toHaveBeenCalled()
    h.drop()
    expect(h.playCard).toHaveBeenCalledOnce()
  })

  it('previews unplayable hand cards but never drags them despite stale hit eligibility', () => {
    const h = createHarness()
    h.controls.view!.game!.legal.playLandByCard = {}
    h.start()
    h.release()
    expect(h.activate).toHaveBeenCalledExactlyOnceWith(handHit)
    h.start()
    h.drop()
    expect(h.board.beginDrag).not.toHaveBeenCalled()
    expect(h.playCard).not.toHaveBeenCalled()
    expect(h.activate).toHaveBeenCalledOnce()
  })

  it('uses live legality rather than a stale unplayable hit flag', () => {
    const h = createHarness()
    h.controls.hit = { ...handHit, playable: false }
    h.start()
    h.drop()
    expect(h.playCard).toHaveBeenCalledExactlyOnceWith(handHit.cardId)
  })

  it('allows battlefield target taps despite blocked drag input', () => {
    const h = createHarness()
    h.controls.blocked = true
    h.controls.hit = battlefieldHit
    h.controls.view!.game!.phase = 'plains_target'
    h.start()
    h.interaction.reconcile()
    h.release()
    expect(h.activate).toHaveBeenCalledExactlyOnceWith(battlefieldHit)
    expect(h.board.beginDrag).not.toHaveBeenCalled()
    expect(h.playCard).not.toHaveBeenCalled()
  })

  it('leaves battlefield preview/input validation to the UI and does not activate swipes', () => {
    const h = createHarness()
    h.controls.view!.game!.canInput = false
    h.controls.hit = battlefieldHit
    h.start({ pointerType: 'pen' })
    h.release({ pointerType: 'pen' })
    expect(h.activate).toHaveBeenCalledExactlyOnceWith(battlefieldHit)
    h.start()
    h.move({ clientX: 250 })
    h.release()
    expect(h.activate).toHaveBeenCalledOnce()
    expect(h.board.beginDrag).not.toHaveBeenCalled()
  })

  it('blocks hand previews and drags while a modal or target selection is active', () => {
    const h = createHarness()
    h.controls.blocked = true
    h.start()
    h.release()
    expect(h.canvas.setPointerCapture).not.toHaveBeenCalled()
    expect(h.activate).not.toHaveBeenCalled()
  })

  it.each([
    ['redacted face', (h: Harness) => {
      h.controls.hit = { ...handHit, name: HIDDEN_HAND_CARD_NAME }
      h.controls.view!.game!.players[0].handCards[0].name = HIDDEN_HAND_CARD_NAME
    }],
    ['stale revealed face', (h: Harness) => {
      h.controls.view!.game!.players[0].handCards[0].name = HIDDEN_HAND_CARD_NAME
    }],
    ['human versus AI hand', (h: Harness) => {
      h.controls.view!.controllers = ['ai', 'human']
    }],
    ['missing source', (h: Harness) => {
      h.controls.view!.game!.players[0].handCards = []
    }],
    ['wrong owner', (h: Harness) => {
      h.controls.hit = { ...handHit, owner: 1 }
    }],
  ] as const)('never captures or previews a %s', (_name, prepare) => {
    const h = createHarness()
    prepare(h)
    h.start()
    h.release()
    expect(h.canvas.setPointerCapture).not.toHaveBeenCalled()
    expect(h.board.beginDrag).not.toHaveBeenCalled()
    expect(h.activate).not.toHaveBeenCalled()
  })

  const staleChanges: ReadonlyArray<readonly [string, (h: Harness) => void]> = [
    ['missing view', (h) => { h.controls.view = null }],
    ['missing game', (h) => { h.controls.view!.game = null }],
    ['mode', (h) => { h.controls.view!.mode = 'tutorial' }],
    ['seed', (h) => { h.controls.view!.seed += 1 }],
    ['adventure seed', (h) => { h.controls.view!.adventure = { ...h.controls.view!.adventure, activeGameSeed: 7 } }],
    ['turn', (h) => { h.controls.view!.game!.turn += 1 }],
    ['phase', (h) => { h.controls.view!.game!.phase = 'respond' }],
    ['actor', (h) => { h.controls.view!.game!.actor = 1 }],
    ['actor control', (h) => { h.controls.view!.game!.actorControl = 'remote' }],
    ['presented actor/input', (h) => { h.controls.view!.game!.canInput = false }],
    ['game replay', (h) => { h.controls.view!.game!.isReplay = true }],
    ['replay active', (h) => { h.controls.view!.replay.active = true }],
    ['replay step', (h) => { h.controls.view!.replay.step += 1 }],
    ['replay playing', (h) => { h.controls.view!.replay.isPlaying = true }],
    ['replay total', (h) => { h.controls.view!.replay.totalSteps += 1 }],
    ['missing legal card', (h) => { h.controls.view!.game!.legal.playLandByCard = {} }],
    ['empty options', (h) => { h.controls.view!.game!.legal.playLandByCard[handHit.cardId] = [] }],
    ['source removal', (h) => { h.controls.view!.game!.players[0].handCards = [] }],
    ['source rename', (h) => { h.controls.view!.game!.players[0].handCards[0].name = 'Island' }],
    ['source hidden', (h) => { h.controls.view!.game!.players[0].handCards[0].name = HIDDEN_HAND_CARD_NAME }],
    ['modal', (h) => { h.controls.blocked = true }],
  ]

  it.each(staleChanges)('reconciles %s changes before a stale drop', (_name, change) => {
    const h = createHarness()
    h.start()
    change(h)
    h.interaction.reconcile()
    expect(h.board.endDrag).toHaveBeenCalledExactlyOnceWith(false)
    expect(h.canvas.captures.size).toBe(0)
    h.move({ clientX: 420, clientY: 220 })
    h.drop()
    expect(h.playCard).not.toHaveBeenCalled()
    expect(h.activate).not.toHaveBeenCalled()
  })

  it.each(staleChanges)('rechecks %s changes on pointerup even without reconcile', (_name, change) => {
    const h = createHarness()
    h.start()
    change(h)
    h.drop()
    expect(h.board.endDrag).toHaveBeenCalledExactlyOnceWith(false)
    expect(h.canvas.captures.size).toBe(0)
    expect(h.playCard).not.toHaveBeenCalled()
    expect(h.activate).not.toHaveBeenCalled()
  })

  it('rechecks legality on moves before updating visuals', () => {
    const h = createHarness()
    h.start()
    h.controls.view!.game!.legal.playLandByCard = {}
    h.move({ clientX: 420, clientY: 220 })
    expect(h.board.moveDrag).toHaveBeenCalledOnce()
    expect(h.board.endDrag).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('preserves a drag across fresh view snapshots with unchanged eligibility', () => {
    const h = createHarness()
    h.start()
    const replacement = createView()
    replacement.status = 'Unrelated render'
    replacement.game!.legal.playLandByCard[handHit.cardId] = [
      { action: { type: 'play_land', actor: 0, cardId: handHit.cardId, effectTargetId: 'new-target-1' }, label: 'New target 1' },
      { action: { type: 'play_land', actor: 0, cardId: handHit.cardId, effectTargetId: 'new-target-2' }, label: 'New target 2' },
    ]
    h.controls.view = replacement
    h.interaction.reconcile()
    expect(h.board.endDrag).not.toHaveBeenCalled()
    h.drop()
    expect(h.playCard).toHaveBeenCalledExactlyOnceWith(handHit.cardId)
  })

  it('cancels a nonplayable press if its eligibility becomes playable', () => {
    const h = createHarness()
    h.controls.view!.game!.legal.playLandByCard = {}
    h.start({ pointerType: 'touch' })
    h.controls.view = createView()
    h.interaction.reconcile()
    h.drop({ pointerType: 'touch' })
    expect(h.canvas.captures.size).toBe(0)
    expect(h.board.beginDrag).not.toHaveBeenCalled()
    expect(h.playCard).not.toHaveBeenCalled()
    expect(h.activate).not.toHaveBeenCalled()
  })

  it('cancels a battlefield press when its instance is replaced, not just its card ID', () => {
    const h = createHarness()
    h.controls.hit = battlefieldHit
    h.start()
    h.controls.view!.game!.players[1].battlefield[0].instanceId = 'new-instance'
    h.interaction.reconcile()
    h.release()
    expect(h.activate).not.toHaveBeenCalled()
    expect(h.canvas.captures.size).toBe(0)
  })

  it('cancels a pending touch preview on phase changes without starting visuals', () => {
    const h = createHarness()
    h.start({ pointerType: 'touch' })
    h.controls.view!.game!.phase = 'respond'
    h.interaction.reconcile()
    h.release({ pointerType: 'touch' })
    expect(h.activate).not.toHaveBeenCalled()
    expect(h.board.beginDrag).not.toHaveBeenCalled()
    expect(h.board.endDrag).not.toHaveBeenCalled()
    expect(h.canvas.captures.size).toBe(0)
  })

  const interruptions: ReadonlyArray<readonly [string, (h: Harness) => void]> = [
    ['pointercancel', (h) => { h.canvas.emit('pointercancel') }],
    ['lostpointercapture', (h) => { h.canvas.emit('lostpointercapture') }],
    ['window pointerup', (h) => { h.window.emit('pointerup', { clientX: 420, clientY: 220 }) }],
    ['window pointercancel', (h) => { h.window.emit('pointercancel') }],
    ['window pointerout', (h) => { h.window.emit('pointerout', { relatedTarget: null }) }],
    ['window blur', (h) => { h.window.emit('blur') }],
    ['Escape', (h) => { h.window.emit('keydown', { key: 'Escape' }) }],
    ['document hidden', (h) => {
      h.document.hidden = true
      h.document.emit('visibilitychange')
    }],
    ['out-of-window release', (h) => { h.release({ clientX: 1200, clientY: 220 }) }],
    ['out-of-window move', (h) => { h.move({ clientX: -10 }) }],
    ['missed outside release', (h) => { h.move({ buttons: 0 }) }],
    ['invalid release coordinates', (h) => { h.release({ clientX: Number.NaN }) }],
    ['invalid move coordinates', (h) => { h.move({ clientY: Number.POSITIVE_INFINITY }) }],
    ['parent cancellation', (h) => { h.interaction.cancel() }],
  ]

  it.each(interruptions)('restores the source once after %s and ignores late releases', (_name, interrupt) => {
    const h = createHarness()
    h.start()
    interrupt(h)
    h.drop()
    h.interaction.cancel()
    h.interaction.reconcile()
    expect(h.playCard).not.toHaveBeenCalled()
    expect(h.activate).not.toHaveBeenCalled()
    expect(h.board.endDrag).toHaveBeenCalledExactlyOnceWith(false)
    expect(h.canvas.captures.size).toBe(0)
  })

  it.each(interruptions)('cancels a response tap after %s', (_name, interrupt) => {
    const h = responseHarness()
    h.start()
    interrupt(h)
    h.release()
    expect(h.activate).not.toHaveBeenCalled()
    expect(h.playCard).not.toHaveBeenCalled()
    expect(h.canvas.captures.size).toBe(0)
    h.interaction.dispose()
  })

  it('does not cancel for unrelated keys, visible documents, or movement between elements', () => {
    const h = createHarness()
    h.start()
    h.window.emit('keydown', { key: 'ArrowRight' })
    h.document.emit('visibilitychange')
    h.window.emit('pointerout', { relatedTarget: {} })
    expect(h.board.endDrag).not.toHaveBeenCalled()
    h.drop()
    expect(h.playCard).toHaveBeenCalledOnce()
  })

  it('clears ownership before releasing capture or restoring the source', () => {
    const h = createHarness()
    h.canvas.releasePointerCapture.mockImplementation((id) => {
      h.canvas.captures.delete(id)
      h.canvas.emit('lostpointercapture', { pointerId: id })
      h.drop({ pointerId: id })
      h.interaction.cancel()
    })
    h.board.endDrag.mockImplementation(() => {
      h.controls.dragging = false
      h.interaction.reconcile()
      h.interaction.cancel()
    })
    h.playCard.mockImplementation(() => {
      expect(h.controls.dragging).toBe(false)
      expect(h.canvas.captures.size).toBe(0)
      h.controls.view = null
      h.interaction.reconcile()
    })
    h.start()
    h.drop()
    expect(h.board.endDrag).toHaveBeenCalledExactlyOnceWith(false)
    expect(h.playCard).toHaveBeenCalledExactlyOnceWith(handHit.cardId)
  })

  it('rechecks the view after synchronous source restoration before invoking UI actions', () => {
    const h = createHarness()
    h.board.endDrag.mockImplementation(() => {
      h.controls.dragging = false
      h.controls.view!.game!.legal.playLandByCard = {}
    })
    h.start()
    h.drop()
    expect(h.playCard).not.toHaveBeenCalled()
    expect(h.canvas.captures.size).toBe(0)
  })

  it('cancels cleanly when capture acquisition fails and can start the next gesture', () => {
    const h = createHarness()
    h.canvas.setPointerCapture.mockImplementationOnce(() => { throw new Error('Inactive pointer') })
    expect(() => h.start()).not.toThrow()
    h.drop()
    expect(h.board.beginDrag).not.toHaveBeenCalled()
    expect(h.playCard).not.toHaveBeenCalled()
    h.start()
    h.drop()
    expect(h.playCard).toHaveBeenCalledOnce()
  })

  it('still restores the source if capture release throws on a detached canvas', () => {
    const h = createHarness()
    h.canvas.releasePointerCapture.mockImplementation(() => { throw new Error('Detached canvas') })
    h.start()
    expect(() => h.interaction.cancel()).not.toThrow()
    h.drop()
    expect(h.board.endDrag).toHaveBeenCalledExactlyOnceWith(false)
    expect(h.playCard).not.toHaveBeenCalled()
  })

  it('does not start visuals after synchronous capture loss during acquisition', () => {
    const h = createHarness()
    h.canvas.setPointerCapture.mockImplementation((id) => {
      h.canvas.emit('lostpointercapture', { pointerId: id })
    })
    h.start()
    h.drop()
    expect(h.board.beginDrag).not.toHaveBeenCalled()
    expect(h.playCard).not.toHaveBeenCalled()
  })

  it('does not activate a different card under the release point', () => {
    const h = createHarness()
    h.start({ pointerType: 'touch' })
    h.controls.hit = { ...handHit, key: 'another-key' }
    h.release({ pointerType: 'touch' })
    expect(h.activate).not.toHaveBeenCalled()
    expect(h.canvas.captures.size).toBe(0)
  })

  it('does not activate a tap released outside its source hit box', () => {
    const h = createHarness()
    h.start({ pointerType: 'touch', clientX: 230 })
    h.release({ pointerType: 'touch', clientX: 231 })
    expect(h.activate).not.toHaveBeenCalled()
    expect(h.playCard).not.toHaveBeenCalled()
  })

  it('does not act on a hidden document, empty board, or missing view', () => {
    const h = createHarness()
    h.document.hidden = true
    h.start()
    h.document.hidden = false
    h.controls.hit = null
    h.start()
    h.controls.hit = handHit
    h.controls.view = null
    h.start()
    expect(h.canvas.setPointerCapture).not.toHaveBeenCalled()
    expect(h.board.beginDrag).not.toHaveBeenCalled()
  })

  it('removes every listener and restores an active source idempotently on disposal', () => {
    const h = createHarness()
    expect(h.canvas.listeners.size).toBe(6)
    expect(h.window.listeners.size).toBe(5)
    expect(h.document.listeners.size).toBe(1)
    h.start()
    h.interaction.dispose()
    h.interaction.dispose()
    h.interaction.cancel()
    h.interaction.reconcile()
    expect(h.canvas.listeners.size).toBe(0)
    expect(h.window.listeners.size).toBe(0)
    expect(h.document.listeners.size).toBe(0)
    expect(h.board.endDrag).toHaveBeenCalledExactlyOnceWith(false)
    expect(h.canvas.captures.size).toBe(0)
    h.start()
    h.drop()
    h.window.emit('pointerup')
    expect(h.playCard).not.toHaveBeenCalled()
    expect(h.board.dispose).not.toHaveBeenCalled()
  })

  it('disposes a pressed touch without unnecessary board restoration', () => {
    const h = createHarness()
    h.start({ pointerType: 'touch' })
    h.interaction.dispose()
    expect(h.board.endDrag).not.toHaveBeenCalled()
    expect(h.canvas.captures.size).toBe(0)
  })

  it('uses pointer events only and never prevents unrelated page gestures', () => {
    const h = createHarness()
    expect([...h.canvas.listeners.keys()]).not.toContain('click')
    expect([...h.canvas.listeners.keys()]).not.toContain('dragstart')
    expect([...h.canvas.listeners.keys()]).not.toContain('touchmove')
    const down = h.start()
    const up = h.release()
    expect(down.preventDefault).not.toHaveBeenCalled()
    expect(up.preventDefault).not.toHaveBeenCalled()
  })
})
