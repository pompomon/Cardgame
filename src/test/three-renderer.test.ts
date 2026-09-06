import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ControllerApi } from '../app/controller'
import type { AppViewModel } from '../app/types'
import type { CounterHandOptions } from '../app/response-options'
import { threePrimaryAction, threeResponse, type ThreePrimaryAction } from '../renderers/three/interface-model'

const mocks = vi.hoisted(() => ({
  board: { render: vi.fn(), setVisible: vi.fn(), dispose: vi.fn(), playEffect: vi.fn(), canvas: {} },
  ui: { update: vi.fn(), isBlocked: vi.fn(), reset: vi.fn(), dispose: vi.fn(), targetIds: new Set(),
    response: null as CounterHandOptions | null, primaryAction: null as ThreePrimaryAction | null, activatePrimaryAction: vi.fn() },
  boardConstruct: vi.fn(),
  input: { cancel: vi.fn(), reconcile: vi.fn(), dispose: vi.fn() },
}))
vi.mock('../renderers/three/board', () => ({
  ThreeBoard: class { constructor(...args: unknown[]) { mocks.boardConstruct(...args); return mocks.board } },
}))
vi.mock('../renderers/three/interface', () => ({
  ThreeInterface: class { constructor() { return mocks.ui } },
}))
vi.mock('../renderers/three/interaction', () => ({
  ThreeInteraction: class { constructor() { return mocks.input } },
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
  return { renderer, document, media, elements }
}

afterEach(() => {
  vi.clearAllMocks()
  mocks.ui.update.mockReset()
  mocks.ui.response = null
  mocks.ui.primaryAction = null
  vi.unstubAllGlobals()
})

describe('Three.js composition', () => {
  it('keeps P2P in the lobby until the seed handshake completes', () => {
    const { renderer, elements } = harness()
    const pending = { ...view(), mode: 'p2p-host' as const, p2pStarted: false }
    renderer.render(pending)
    expect(elements[0].hidden).toBe(true)
    expect(mocks.board.render).not.toHaveBeenCalled()
    renderer.render({ ...pending, p2pStarted: true })
    expect(elements[0].hidden).toBe(false)
    expect(mocks.board.render).toHaveBeenCalledOnce()
    renderer.unmount()
  })

  it('projects disabled interaction while an AI actor is on the far side', () => {
    const { renderer } = harness()
    const snapshot = view()
    renderer.render(snapshot)
    expect(mocks.board.render).toHaveBeenCalledWith(
      expect.objectContaining({ game: expect.objectContaining({ actor: 1, canInput: false }) }),
      0, mocks.ui.targetIds, null, null,
    )
    expect(snapshot.game!.canInput).toBe(true)
    renderer.unmount()
  })

  it('passes response feedback only after the human responder is presented', () => {
    mocks.ui.update.mockImplementation((snapshot: AppViewModel, presentedActor: number) => {
      mocks.ui.response = threeResponse(snapshot, {
        presentedActor, menuOpen: false, pendingCardId: null, phaseDismissed: false,
        preview: null, hostAnswerDraft: '', joinOfferDraft: '',
      })
      mocks.ui.primaryAction = threePrimaryAction(snapshot, {
        presentedActor, menuOpen: false, pendingCardId: null, phaseDismissed: false,
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
      0, mocks.ui.targetIds, null, null,
    )
    renderer.render({ ...next, animationSpeed: 'off' })
    expect(mocks.board.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ game: expect.objectContaining({ canInput: true }) }),
      1, mocks.ui.targetIds, expect.objectContaining({ requiredIslandId: 'island', choices: [expect.objectContaining({ cardId: 'forest' })] }),
      expect.objectContaining({ type: 'pass_response', disabled: false }),
    )
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
