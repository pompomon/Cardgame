import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppViewModel } from '../app/types'

const mocks = vi.hoisted(() => {
  const cardgameScene = {
    renderView: vi.fn(),
    retryFailedBoardAssets: vi.fn(),
    presentedActor: vi.fn((actor: number) => actor),
    isTargetPickerOpen: vi.fn(() => false),
    isMenuOverlayOpen: vi.fn(() => false),
  }
  const lobbyScene = {
    renderView: vi.fn(),
    getActiveSubmenu: vi.fn(() => 'root'),
    isAiLevelOptionsOpen: vi.fn(() => false),
  }
  return {
    cardgameScene,
    lobbyScene,
    sceneStop: vi.fn(),
    sceneStart: vi.fn(),
    sceneGet: vi.fn(() => ({})),
    hostDispose: vi.fn(),
    clearFailedUrls: vi.fn(),
    fileInputRemove: vi.fn(),
    p2pRemove: vi.fn(),
    p2pUpdate: vi.fn(),
    a11yRemove: vi.fn(),
    a11yUpdate: vi.fn(),
  }
})

vi.mock('../renderers/phaser/cardgame-scene', () => ({
  CardgameScene: class {
    constructor() {
      return mocks.cardgameScene
    }
  },
}))

vi.mock('../renderers/phaser/lobby-scene', () => ({
  LobbyScene: class {
    constructor() {
      return mocks.lobbyScene
    }
  },
}))

vi.mock('../renderers/phaser/scene-host', () => ({
  createSceneHost: vi.fn(() => ({
    canvasHost: {},
    game: {
      scene: {
        stop: mocks.sceneStop,
        start: mocks.sceneStart,
        getScene: mocks.sceneGet,
      },
    },
    dispose: mocks.hostDispose,
  })),
}))

vi.mock('../renderers/phaser/recording-file-actions', () => ({
  createRecordingFileInput: vi.fn(() => ({
    click: vi.fn(),
    remove: mocks.fileInputRemove,
  })),
  downloadRecordingJson: vi.fn(),
}))

vi.mock('../renderers/phaser/p2p-overlay', () => ({
  createP2POverlay: vi.fn(() => ({
    element: {},
    update: mocks.p2pUpdate,
    remove: mocks.p2pRemove,
  })),
}))

vi.mock('../renderers/phaser/a11y-navigation', () => ({
  createA11yNav: vi.fn(() => ({
    element: {},
    update: mocks.a11yUpdate,
    remove: mocks.a11yRemove,
  })),
}))

vi.mock('../renderers/phaser/ui-utils', () => ({
  measureSafeAreaInsets: vi.fn(() => ({})),
}))

vi.mock('../renderers/phaser/texture-loader', () => ({
  clearFailedRuntimeAssetUrls: mocks.clearFailedUrls,
}))

import { PhaserRenderer } from '../renderers/phaser'

class FakeWindow {
  private readonly listeners = new Map<string, Set<() => void>>()

  addEventListener(event: string, listener: () => void): void {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }

  removeEventListener(event: string, listener: () => void): void {
    this.listeners.get(event)?.delete(listener)
  }

  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener()
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0
  }
}

function containerHarness(): HTMLElement {
  const classes = new Set<string>()
  return {
    classList: {
      add: (value: string) => { classes.add(value) },
      remove: (value: string) => { classes.delete(value) },
    },
    innerHTML: '',
  } as unknown as HTMLElement
}

function view(game: AppViewModel['game']): AppViewModel {
  return {
    mode: 'hvai',
    game,
    p2pStarted: false,
  } as unknown as AppViewModel
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('Phaser renderer lifecycle', () => {
  it('cleans scene transitions, online recovery, and unmount exactly once', () => {
    const fakeWindow = new FakeWindow()
    vi.stubGlobal('window', fakeWindow)
    const renderer = new PhaserRenderer()
    renderer.mount(containerHarness(), {} as never)
    expect(fakeWindow.listenerCount('online')).toBe(1)

    renderer.render(view({ actor: 0 } as AppViewModel['game']))
    expect(mocks.sceneStop).toHaveBeenCalledWith('cardgame-lobby')
    expect(mocks.sceneStart).toHaveBeenCalledWith('cardgame-main')

    fakeWindow.emit('online')
    expect(mocks.clearFailedUrls).toHaveBeenCalledOnce()
    expect(mocks.cardgameScene.retryFailedBoardAssets).toHaveBeenCalledOnce()

    renderer.render(view(null))
    expect(mocks.sceneStop).toHaveBeenCalledWith('cardgame-main')
    expect(mocks.sceneStart).toHaveBeenCalledWith('cardgame-lobby')

    renderer.unmount()
    renderer.unmount()

    expect(fakeWindow.listenerCount('online')).toBe(0)
    expect(mocks.hostDispose).toHaveBeenCalledOnce()
    expect(mocks.fileInputRemove).toHaveBeenCalledOnce()
    expect(mocks.p2pRemove).toHaveBeenCalledOnce()
    expect(mocks.a11yRemove).toHaveBeenCalledOnce()
    expect(mocks.clearFailedUrls).toHaveBeenCalledTimes(2)
  })

  it('disposes an existing mount before remounting without duplicating listeners', () => {
    const fakeWindow = new FakeWindow()
    vi.stubGlobal('window', fakeWindow)
    const renderer = new PhaserRenderer()
    const container = containerHarness()

    renderer.mount(container, {} as never)
    renderer.mount(container, {} as never)

    expect(mocks.hostDispose).toHaveBeenCalledOnce()
    expect(fakeWindow.listenerCount('online')).toBe(1)

    renderer.unmount()
    expect(mocks.hostDispose).toHaveBeenCalledTimes(2)
    expect(fakeWindow.listenerCount('online')).toBe(0)
  })

  it('leaves no global listeners or overlay owners after twenty mount cycles', () => {
    const fakeWindow = new FakeWindow()
    vi.stubGlobal('window', fakeWindow)

    for (let index = 0; index < 20; index += 1) {
      const renderer = new PhaserRenderer()
      renderer.mount(containerHarness(), {} as never)
      renderer.unmount()
    }

    expect(fakeWindow.listenerCount('online')).toBe(0)
    expect(mocks.hostDispose).toHaveBeenCalledTimes(20)
    expect(mocks.fileInputRemove).toHaveBeenCalledTimes(20)
    expect(mocks.p2pRemove).toHaveBeenCalledTimes(20)
    expect(mocks.a11yRemove).toHaveBeenCalledTimes(20)
  })
})
