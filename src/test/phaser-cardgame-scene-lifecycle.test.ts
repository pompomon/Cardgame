import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppViewModel } from '../app/types'

const phaserMocks = vi.hoisted(() => ({
  isActive: vi.fn(() => false),
}))

vi.mock('phaser', () => ({
  default: {
    Scene: class {
      readonly scene = {
        isActive: phaserMocks.isActive,
      }
    },
    Scenes: {
      Events: {
        SHUTDOWN: 'shutdown',
        DESTROY: 'destroy',
      },
    },
    GameObjects: {
      Events: {
        DESTROY: 'destroy',
      },
    },
    Loader: {
      Events: {
        FILE_LOAD_ERROR: 'loaderror',
        COMPLETE: 'complete',
      },
    },
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
      Distance: {
        Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
      },
    },
  },
}))

import { CardgameScene } from '../renderers/phaser/cardgame-scene'

afterEach(() => {
  vi.unstubAllGlobals()
})

interface ResourceHarness {
  readonly dragDestroy: ReturnType<typeof vi.fn>
  readonly previewDestroy: ReturnType<typeof vi.fn>
  readonly cardsDestroy: ReturnType<typeof vi.fn>
  readonly dropZoneDestroy: ReturnType<typeof vi.fn>
  readonly loadDispose: ReturnType<typeof vi.fn>
  readonly backgroundDestroy: ReturnType<typeof vi.fn>
  readonly rootDestroy: ReturnType<typeof vi.fn>
  readonly statusDestroy: ReturnType<typeof vi.fn>
}

function installResources(scene: CardgameScene): ResourceHarness {
  const resources: ResourceHarness = {
    dragDestroy: vi.fn(),
    previewDestroy: vi.fn(),
    cardsDestroy: vi.fn(),
    dropZoneDestroy: vi.fn(),
    loadDispose: vi.fn(),
    backgroundDestroy: vi.fn(),
    rootDestroy: vi.fn(),
    statusDestroy: vi.fn(),
  }
  Object.assign(scene, {
    dragController: { destroy: resources.dragDestroy },
    cardPreview: { destroy: resources.previewDestroy },
    cardViews: { destroy: resources.cardsDestroy },
    dropZoneView: { destroy: resources.dropZoneDestroy },
    boardAssetLoadHandle: { dispose: resources.loadDispose, isActive: () => false },
    boardAssetManifestSignature: 'classic:high',
    boardBackground: { destroy: resources.backgroundDestroy },
    rootContainer: { destroy: resources.rootDestroy },
    statusText: { destroy: resources.statusDestroy },
    battlefieldDropZone: {},
    menuOverlay: {},
    menuOpen: true,
    menuContentScrollOffset: 10,
    menuLogScrollOffset: 20,
    menuLogPinnedToBottom: false,
    lastRenderedSeed: 42,
    lastMenuSignature: 'menu',
    lastLayoutSignature: 'layout',
    lastEffectFeedbackEventCount: 4,
    effectFeedback: {},
  })
  return resources
}

function shutdown(scene: CardgameScene): void {
  const lifecycle = scene as unknown as { shutdownSceneResources(): void }
  lifecycle.shutdownSceneResources()
}

describe('CardgameScene lifecycle cleanup', () => {
  it('cleans every retained owner once per restart cycle and clears stale scene state', () => {
    const rendererRef = {
      currentView: null,
      refreshA11yNavForCurrentView: vi.fn(),
    }
    const scene = new CardgameScene(rendererRef as never)
    const first = installResources(scene)

    shutdown(scene)
    shutdown(scene)

    for (const cleanup of Object.values(first)) {
      expect(cleanup).toHaveBeenCalledOnce()
    }
    expect(scene).toMatchObject({
      rootContainer: null,
      statusText: null,
      battlefieldDropZone: null,
      menuOverlay: null,
      menuOpen: false,
      menuContentScrollOffset: null,
      menuLogScrollOffset: null,
      menuLogPinnedToBottom: true,
      lastRenderedSeed: null,
      lastMenuSignature: null,
      lastLayoutSignature: '',
      lastEffectFeedbackEventCount: 0,
      effectFeedback: null,
    })

    const restarted = installResources(scene)
    shutdown(scene)
    for (const cleanup of Object.values(restarted)) {
      expect(cleanup).toHaveBeenCalledOnce()
    }
  })

  it('disposes a stale asset load and retries only while the scene is active', () => {
    const currentView = { game: null }
    const scene = new CardgameScene({
      currentView,
      refreshA11yNavForCurrentView: vi.fn(),
    } as never)
    const renderView = vi.spyOn(scene, 'renderView').mockImplementation(() => {})
    const firstDispose = vi.fn()
    Object.assign(scene, {
      boardAssetLoadHandle: { dispose: firstDispose, isActive: () => false },
      boardAssetManifestSignature: 'classic:high',
    })

    phaserMocks.isActive.mockReturnValue(false)
    scene.retryFailedBoardAssets()
    expect(firstDispose).toHaveBeenCalledOnce()
    expect(renderView).not.toHaveBeenCalled()

    const secondDispose = vi.fn()
    Object.assign(scene, {
      boardAssetLoadHandle: { dispose: secondDispose, isActive: () => false },
      boardAssetManifestSignature: 'verdant:balanced',
    })
    phaserMocks.isActive.mockReturnValue(true)
    scene.retryFailedBoardAssets()

    expect(secondDispose).toHaveBeenCalledOnce()
    expect(renderView).toHaveBeenCalledWith(currentView)
  })

  it('defers online asset retry while the existing loader generation is active', () => {
    const scene = new CardgameScene({
      currentView: { game: null },
      refreshA11yNavForCurrentView: vi.fn(),
    } as never)
    const dispose = vi.fn()
    const renderView = vi.spyOn(scene, 'renderView').mockImplementation(() => {})
    Object.assign(scene, {
      boardAssetLoadHandle: { dispose, isActive: () => true },
      boardAssetManifestSignature: 'classic:high',
    })
    phaserMocks.isActive.mockReturnValue(true)

    scene.retryFailedBoardAssets()

    expect(dispose).not.toHaveBeenCalled()
    expect(renderView).not.toHaveBeenCalled()
    expect(scene).toMatchObject({
      boardAssetRetryPending: true,
      boardAssetManifestSignature: 'classic:high',
    })
  })

  it('defers a changed asset manifest while the existing loader generation is active', () => {
    const scene = new CardgameScene({
      currentView: { game: null },
      refreshA11yNavForCurrentView: vi.fn(),
    } as never)
    const activeHandle = {
      dispose: vi.fn(),
      isActive: () => true,
    }
    const syncBackground = vi.fn()
    Object.assign(scene, {
      boardAssetLoadHandle: activeHandle,
      boardAssetManifestSignature: 'classic:high',
      boardBackground: { sync: syncBackground },
      textures: { exists: () => false },
    })
    const lifecycle = scene as unknown as {
      syncBoardBackground(view: AppViewModel): void
    }

    lifecycle.syncBoardBackground({
      boardTheme: 'verdant',
      renderQualityPreference: 'balanced',
    } as AppViewModel)

    expect(activeHandle.dispose).not.toHaveBeenCalled()
    expect(scene).toMatchObject({
      boardAssetLoadHandle: activeHandle,
      boardAssetManifestSignature: 'classic:high',
    })
    expect(syncBackground).toHaveBeenCalledWith(expect.objectContaining({
      theme: 'verdant',
      backgroundTextureKey: null,
    }))
  })

  it('cancels hidden-page visuals and refreshes accessibility on hide and restore', () => {
    const currentView = {
      game: {
        actor: 1,
        events: [{ kind: 'game_started' }, { kind: 'turn_start' }],
      },
    }
    const refreshA11yNavForCurrentView = vi.fn()
    const scene = new CardgameScene({
      currentView,
      refreshA11yNavForCurrentView,
    } as never)
    const cancel = vi.fn()
    const resetEffects = vi.fn()
    const resetPresentation = vi.fn()
    const renderView = vi.spyOn(scene, 'renderView').mockImplementation(() => {})
    Object.assign(scene, {
      dragController: { cancel },
      effectController: { reset: resetEffects },
      boardPresentation: { reset: resetPresentation },
    })
    const documentState = { visibilityState: 'hidden' }
    vi.stubGlobal('document', documentState)
    const lifecycle = scene as unknown as { handleVisibilityChange(): void }

    lifecycle.handleVisibilityChange()
    documentState.visibilityState = 'visible'
    lifecycle.handleVisibilityChange()

    expect(cancel).toHaveBeenNthCalledWith(1, 'visibility')
    expect(cancel).toHaveBeenNthCalledWith(2, 'visibility')
    expect(resetEffects).toHaveBeenCalledOnce()
    expect(resetEffects).toHaveBeenCalledWith(2)
    expect(resetPresentation).toHaveBeenCalledWith(1)
    expect(renderView).toHaveBeenCalledTimes(2)
    expect(renderView).toHaveBeenLastCalledWith(currentView)
    expect(refreshA11yNavForCurrentView).toHaveBeenCalledTimes(2)
  })
})
