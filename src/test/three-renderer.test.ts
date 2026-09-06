import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ControllerApi } from '../app/controller'
import type { AppViewModel } from '../app/types'

const mocks = vi.hoisted(() => ({
  board: { render: vi.fn(), setVisible: vi.fn(), dispose: vi.fn(), playEffect: vi.fn(), canvas: {} },
  ui: { update: vi.fn(), isBlocked: vi.fn(), reset: vi.fn(), dispose: vi.fn(), targetIds: new Set() },
  input: { cancel: vi.fn(), reconcile: vi.fn(), dispose: vi.fn() },
}))
vi.mock('../renderers/three/board', () => ({
  ThreeBoard: class { constructor() { return mocks.board } },
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
      0, mocks.ui.targetIds,
    )
    expect(snapshot.game!.canInput).toBe(true)
    renderer.unmount()
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
