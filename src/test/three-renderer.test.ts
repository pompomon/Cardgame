import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppController, type ControllerApi } from '../app/controller'
import { createGameRecord } from '../app/game-recording'
import { DEFAULT_CARD_VISUAL_STYLE } from '../app/card-visual-styles'
import type { AppViewModel } from '../app/types'
import type { CounterHandOptions } from '../app/response-options'
import type { BoardHit } from '../renderers/three/contracts'
import { createInitialGame } from '../game/engine'
import { threePrimaryAction, threeResponse, threeTargets, type ThreePrimaryAction } from '../renderers/three/interface-model'

const mocks = vi.hoisted(() => ({
  board: { render: vi.fn(), setVisible: vi.fn(), dispose: vi.fn(), playEffect: vi.fn(), retainEffectTargets: vi.fn(), canvas: {} },
  ui: { update: vi.fn(), isBlocked: vi.fn(() => false), reset: vi.fn(), dispose: vi.fn(), targetIds: new Set(),
    response: null as CounterHandOptions | null, primaryAction: null as ThreePrimaryAction | null, activatePrimaryAction: vi.fn(), setHover: vi.fn() },
  boardConstruct: vi.fn(),
  uiConstruct: vi.fn(),
  inputConstruct: vi.fn(),
  input: { cancel: vi.fn(), reconcile: vi.fn(), dispose: vi.fn() },
}))
vi.mock('../renderers/three/board', () => ({
  ThreeBoard: class { constructor(...args: unknown[]) { mocks.boardConstruct(...args); return mocks.board } },
}))
vi.mock('../renderers/three/interface', () => ({
  ThreeInterface: class { constructor(...args: unknown[]) { mocks.uiConstruct(...args); return mocks.ui } },
}))
vi.mock('../renderers/three/interaction', () => ({
  ThreeInteraction: class { constructor(...args: unknown[]) { mocks.inputConstruct(...args); return mocks.input } },
}))
import { ThreeRenderer } from '../renderers/three'

function view(): AppViewModel {
  return {
    mode: 'local-hvai', seed: 1, controllers: ['human', 'ai'],
    game: { actor: 1, canInput: true, events: [] },
    replay: { active: false, step: 0 },
    animationSpeed: 'off',
  } as unknown as AppViewModel
}

function harness() {
  const elements: Array<{ hidden: boolean }> = []
  const document = {
    hidden: false,
    createElement: () => {
      const node = { hidden: false, className: '', setAttribute: vi.fn() }
      elements.push(node)
      return node
    },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }
  const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', { matchMedia: () => media })
  const container = {
    classList: { add: vi.fn(), remove: vi.fn() },
    replaceChildren: vi.fn(),
  } as unknown as HTMLElement
  const renderer = new ThreeRenderer()
  renderer.mount(container, {} as ControllerApi)
  return { renderer, document, media, elements, container }
}

afterEach(() => {
  vi.clearAllMocks()
  mocks.ui.update.mockReset()
  mocks.ui.isBlocked.mockReturnValue(false)
  mocks.ui.response = null
  mocks.ui.primaryAction = null
  vi.unstubAllGlobals()
})

describe('Three.js composition', () => {
  it('mounts a separate HUD before the stable board and delegates hover only while mounted', () => {
    const { renderer, elements, container } = harness()
    expect(container.replaceChildren).toHaveBeenLastCalledWith(elements[2], elements[0], elements[1])
    expect(mocks.uiConstruct).toHaveBeenLastCalledWith(elements[1], expect.anything(), expect.any(Function), expect.any(Function), elements[2])
    const hover = mocks.inputConstruct.mock.calls.at(-1)![5] as (hit: BoardHit | null) => void
    const hit: BoardHit = { key: 'card', cardId: 'card', name: 'Forest', owner: 0, zone: 'hand', playable: true }
    hover(hit)
    expect(mocks.ui.setHover).toHaveBeenCalledExactlyOnceWith(hit)
    renderer.render(view())
    expect(container.replaceChildren).toHaveBeenCalledTimes(1)
    renderer.unmount()
    hover(hit)
    expect(mocks.ui.setHover).toHaveBeenCalledTimes(1)
  })

  it('does not reset lobby subviews or signaling drafts during status and settings notifications', () => {
    const { renderer } = harness()
    const snapshot = { ...view(), game: null, status: 'Waiting for offer' }
    renderer.render(snapshot)
    mocks.ui.reset.mockClear()
    renderer.render({ ...snapshot, status: 'Offer ready', aiLevel: 'hard' })
    expect(mocks.ui.reset).not.toHaveBeenCalled()
    renderer.render({ ...snapshot, mode: 'p2p-host' })
    expect(mocks.ui.reset).toHaveBeenCalledOnce()
    renderer.unmount()
  })

  it('limits the viewport shell to active gameplay', () => {
    const { renderer, container } = harness()
    renderer.render(view())
    expect(container.classList.add).toHaveBeenCalledWith('three-root--game')
    renderer.render({ ...view(), game: null })
    expect(container.classList.remove).toHaveBeenCalledWith('three-root--game')
    renderer.unmount()
  })

  it('passes modal and decision blocking to the board without changing the projected game', () => {
    const { renderer } = harness()
    const snapshot = { ...view(), controllers: ['human', 'human'] as AppViewModel['controllers'] }
    mocks.ui.isBlocked.mockReturnValue(true)
    renderer.render(snapshot)
    expect(mocks.board.render).toHaveBeenLastCalledWith(snapshot, 1, mocks.ui.targetIds, null, null, true)
    expect(snapshot.game!.canInput).toBe(true)
    renderer.unmount()
  })

  it('preserves menu/log navigation when seeking backwards in the same replay', () => {
    const { renderer } = harness()
    const snapshot = { ...view(), replay: { active: true, step: 5, totalSteps: 10, isPlaying: false } }
    renderer.render(snapshot)
    mocks.ui.reset.mockClear()
    renderer.render({ ...snapshot, replay: { ...snapshot.replay, step: 2 } })
    expect(mocks.ui.reset).toHaveBeenCalledExactlyOnceWith(true)
    renderer.unmount()
  })

  it('reserves queued Mountain targets before board reconciliation and releases them on disposal', () => {
    const { renderer } = harness()
    const snapshot: AppViewModel = { ...view(), animationSpeed: 'normal', cardVisualStyle: DEFAULT_CARD_VISUAL_STYLE }
    renderer.render(snapshot)
    mocks.board.retainEffectTargets.mockClear()
    mocks.board.render.mockClear()
    renderer.render({ ...snapshot, game: { ...snapshot.game!, events: [{
      kind: 'ability_mountain_destroy', actor: 1, target: 0, cardName: 'Island', targetInstanceId: 'destroyed-island',
    }] } })
    expect(mocks.board.retainEffectTargets).toHaveBeenCalledWith(['destroyed-island'])
    expect(mocks.board.retainEffectTargets.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.board.render.mock.invocationCallOrder[0])
    renderer.unmount()
    expect(mocks.board.retainEffectTargets).toHaveBeenLastCalledWith([])
  })

  it('keeps P2P in the lobby until the seed handshake completes', () => {
    const { renderer, elements } = harness()
    const pending = { ...view(), mode: 'p2p-host' as const, p2pStarted: false }
    renderer.render(pending)
    expect(elements[0].hidden).toBe(true)
    expect(mocks.board.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ game: null }), 0, mocks.ui.targetIds, null, null, false,
    )
    mocks.board.render.mockClear()
    renderer.render({ ...pending, p2pStarted: true })
    expect(elements[0].hidden).toBe(false)
    expect(mocks.board.render).toHaveBeenCalledOnce()
    renderer.unmount()
  })

  it('reconciles an empty board on returning from a response to the lobby', () => {
    const { renderer } = harness()
    const snapshot = view()
    snapshot.game = {
      ...snapshot.game!, phase: 'respond',
      pendingLandPlay: { cardId: 'pending', name: 'Island', actor: 0 },
    }
    renderer.render(snapshot)
    renderer.render({ ...snapshot, game: null })
    expect(mocks.board.setVisible).toHaveBeenLastCalledWith(false)
    expect(mocks.board.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ game: null }), 0, mocks.ui.targetIds, null, null, false,
    )
    renderer.unmount()
  })

  it('projects disabled interaction while an AI actor is on the far side', () => {
    const { renderer } = harness()
    const snapshot = view()
    renderer.render(snapshot)
    expect(mocks.board.render).toHaveBeenCalledWith(
      expect.objectContaining({ game: expect.objectContaining({ actor: 1, canInput: false }) }),
      0, mocks.ui.targetIds, null, null, false,
    )
    expect(snapshot.game!.canInput).toBe(true)
    renderer.unmount()
  })

  it('passes response feedback only after the human responder is presented', () => {
    mocks.ui.update.mockImplementation((snapshot: AppViewModel, presentedActor: number) => {
      mocks.ui.response = threeResponse(snapshot, {
        presentedActor, menuOpen: false, cardsOpen: false, pendingCardId: null, phaseDismissed: false,
        previewReturnToCards: false,
        preview: null, hostAnswerDraft: '', joinOfferDraft: '',
      })
      mocks.ui.primaryAction = threePrimaryAction(snapshot, {
        presentedActor, menuOpen: false, cardsOpen: false, pendingCardId: null, phaseDismissed: false,
        previewReturnToCards: false,
        preview: null, hostAnswerDraft: '', joinOfferDraft: '',
      })
    })
    const { renderer } = harness()
    const snapshot = {
      ...view(), mode: 'local-hvh', controllers: ['human', 'human'], animationSpeed: 'normal',
      cardVisualStyle: 'classic',
      game: {
        actor: 0, actorControl: 'human', canInput: true, phase: 'main', events: [], pendingLandName: null,
        players: [{ handCards: [] }, { handCards: [{ id: 'island', name: 'Island' }, { id: 'forest', name: 'Forest' }] }],
        legal: { counterOptions: [], canPassResponse: false },
      },
    } as unknown as AppViewModel
    renderer.render(snapshot)
    const next: AppViewModel = {
      ...snapshot,
      game: {
        ...snapshot.game!, actor: 1, phase: 'respond', pendingLandName: 'Swamp',
        events: [{ kind: 'play_land', actor: 0, cardName: 'Swamp' }],
        legal: {
          ...snapshot.game!.legal, canPassResponse: true,
          counterOptions: [{ action: { type: 'counter_land', actor: 1, discardCardId: 'forest' }, label: 'Discard Island + Forest' }],
        },
      },
    }
    renderer.render(next)
    expect(mocks.board.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ game: expect.objectContaining({ canInput: false }) }),
      0, mocks.ui.targetIds, null, null, false,
    )
    renderer.render({ ...next, animationSpeed: 'off' })
    expect(mocks.board.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ game: expect.objectContaining({ canInput: true }) }),
      1, mocks.ui.targetIds, expect.objectContaining({ requiredIslandId: 'island', choices: [expect.objectContaining({ cardId: 'forest' })] }),
      expect.objectContaining({ type: 'pass_response', disabled: false }),
      false,
    )
    renderer.unmount()
  })

  it.each(['normal', 'off'] as const)('presents the Plains-triggered Forest choice after the caster handoff with animations %s', (speed) => {
    const { renderer } = harness()
    const game = createInitialGame(42)
    game.players[0].hand = [{ id: 'plains', name: 'Plains', type: 'land' }]
    game.players[0].battlefield = [{ instanceId: 'forest', card: { id: 'forest-card', name: 'Forest', type: 'land' } }]
    game.players[0].graveyard = [{ id: 'grave', name: 'Mountain', type: 'land' }]
    game.players[1].hand = [
      { id: 'island', name: 'Island', type: 'land' },
      { id: 'discard', name: 'Forest', type: 'land' },
    ]
    const controller = new AppController('three')
    controller.importRecordingJson(JSON.stringify(createGameRecord(42, 'local-hvh', ['human', 'human'], 'basic', game)))
    controller.exitReplay()
    controller.setAnimationSpeed(speed)
    const unsubscribe = controller.subscribe((view) => renderer.render(view))
    const targets = () => {
      const [snapshot, presentedActor] = mocks.ui.update.mock.calls.at(-1)! as [AppViewModel, number]
      return threeTargets(snapshot, {
        presentedActor, menuOpen: false, cardsOpen: false, pendingCardId: null, phaseDismissed: false,
        previewReturnToCards: false,
        preview: null, hostAnswerDraft: '', joinOfferDraft: '',
      })
    }
    controller.submitAction({ type: 'play_land', actor: 0, cardId: 'plains', effectTargetId: 'forest' })
    expect(controller.getViewModel().game!.phase).toBe('respond')
    expect(targets()).toBeNull()
    controller.submitAction({ type: 'pass_response', actor: 1 })
    if (speed === 'normal') {
      expect(targets()).toBeNull()
      expect(mocks.ui.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ game: expect.objectContaining({ phase: 'plains_target', actor: 0, canInput: false }) }), 1,
      )
      const done = mocks.board.playEffect.mock.calls.at(-1)![2] as () => void
      done()
    }
    expect(targets()).toMatchObject({
      context: { kind: 'plains_reuse' }, battlefield: false,
      options: [{ effectTargetId: 'grave', cardName: 'Mountain' }],
    })
    expect(mocks.ui.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ game: expect.objectContaining({ phase: 'plains_target', actor: 0, canInput: true }) }), 0,
    )
    unsubscribe()
    renderer.unmount()
  })

  it('routes battlefield intent through the interface and ignores callbacks after unmount', () => {
    const { renderer } = harness()
    const activate = mocks.boardConstruct.mock.calls.at(-1)![3] as (action: ThreePrimaryAction) => void
    const action: ThreePrimaryAction = { type: 'end_turn', label: 'End Turn', prompt: '', decision: 'decision', disabled: false }
    activate(action)
    expect(mocks.ui.activatePrimaryAction).toHaveBeenCalledExactlyOnceWith(action)
    renderer.unmount()
    activate(action)
    expect(mocks.ui.activatePrimaryAction).toHaveBeenCalledTimes(1)
  })

  it('resets ephemeral interactions for replacements but not status updates', () => {
    const { renderer } = harness()
    const snapshot = view()
    renderer.render(snapshot)
    mocks.ui.reset.mockClear()
    renderer.render({ ...snapshot, status: 'Saved' })
    expect(mocks.ui.reset).not.toHaveBeenCalled()
    renderer.render({ ...snapshot, seed: 2 })
    expect(mocks.ui.reset).toHaveBeenCalledOnce()
    expect(mocks.input.cancel).toHaveBeenCalled()
    renderer.unmount()
  })

  it('disposes observers, input, graphics and HTML exactly once', () => {
    const { renderer, document, media } = harness()
    renderer.render(view())
    renderer.unmount()
    renderer.unmount()
    expect(mocks.board.dispose).toHaveBeenCalledOnce()
    expect(mocks.ui.dispose).toHaveBeenCalledOnce()
    expect(mocks.input.dispose).toHaveBeenCalledOnce()
    expect(document.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(media.removeEventListener).toHaveBeenCalledOnce()
  })
})
