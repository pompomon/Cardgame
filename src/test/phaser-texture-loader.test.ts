import { describe, expect, it, vi } from 'vitest'
import {
  FailedAssetUrlRegistry,
  loadPhaserBoardAssetManifest,
  observeLoaderFileProcessingErrors,
  type LoaderFileFailure,
  type PhaserTextureLoaderPort,
  type ProcessableLoaderFile,
} from '../renderers/phaser/texture-loader'
import {
  AMBIENCE_ATLAS_FRAMES,
  BOARD_UI_ATLAS_FRAMES,
  buildPhaserBoardAssetManifest,
} from '../renderers/phaser/asset-manifest'

type QueuedAsset =
  | { readonly kind: 'image'; readonly key: string; readonly urls: readonly string[] }
  | { readonly kind: 'atlas'; readonly key: string; readonly urls: readonly string[] }

function createLoaderPort(initialTextures: readonly string[] = []): {
  readonly port: PhaserTextureLoaderPort
  readonly queued: QueuedAsset[]
  emitError(file: LoaderFileFailure): void
  emitComplete(): void
  addTexture(key: string, frames?: readonly string[]): void
  errorListenerCount(): number
  completeListenerCount(): number
} {
  const textures = new Set(initialTextures)
  const textureFrames = new Map<string, Set<string>>()
  const queued: QueuedAsset[] = []
  const errorListeners = new Set<(file: LoaderFileFailure) => void>()
  const completeListeners = new Set<() => void>()
  const port: PhaserTextureLoaderPort = {
    textureExists: (key) => textures.has(key),
    textureHasFrame: (key, frame) => textureFrames.get(key)?.has(frame) ?? false,
    removeTexture: (key) => {
      textures.delete(key)
      textureFrames.delete(key)
    },
    queueImage: (key, url) => {
      queued.push({ kind: 'image', key, urls: [url] })
    },
    queueAtlas: (key, textureUrl, atlasUrl) => {
      queued.push({ kind: 'atlas', key, urls: [textureUrl, atlasUrl] })
    },
    onFileError: (listener) => {
      errorListeners.add(listener)
    },
    offFileError: (listener) => {
      errorListeners.delete(listener)
    },
    onceComplete: (listener) => {
      completeListeners.add(listener)
    },
    offComplete: (listener) => {
      completeListeners.delete(listener)
    },
  }
  return {
    port,
    queued,
    emitError: (file) => {
      for (const listener of [...errorListeners]) listener(file)
    },
    emitComplete: () => {
      const listeners = [...completeListeners]
      completeListeners.clear()
      for (const listener of listeners) listener()
    },
    addTexture: (key, frames = []) => {
      textures.add(key)
      textureFrames.set(key, new Set(frames))
    },
    errorListenerCount: () => errorListeners.size,
    completeListenerCount: () => completeListeners.size,
  }
}

describe('Phaser board texture loader', () => {
  it('loads only the requested background tier plus small atlases initially', () => {
    const harness = createLoaderPort()
    loadPhaserBoardAssetManifest(
      harness.port,
      buildPhaserBoardAssetManifest('classic', 'high'),
      { failedUrls: new FailedAssetUrlRegistry(), onFailure: vi.fn() },
    )

    expect(harness.queued.map((asset) => asset.key)).toEqual([
      'board-background:classic:hd',
      'board-atlas:ambience:classic',
      'board-atlas:board-ui',
      'board-atlas:effects',
    ])
  })

  it('queues background fallbacks one at a time until the placeholder fails', () => {
    const harness = createLoaderPort()
    const onFailure = vi.fn()
    loadPhaserBoardAssetManifest(
      harness.port,
      buildPhaserBoardAssetManifest('moonlit', 'high'),
      { failedUrls: new FailedAssetUrlRegistry(), onFailure },
    )

    for (const variant of ['hd', 'balanced', 'low', 'fallback']) {
      harness.emitError({
        key: `board-background:moonlit:${variant}`,
        src: `/boards/moonlit/background-${variant}.png`,
      })
    }

    expect(
      harness.queued
        .filter((asset) => asset.kind === 'image')
        .map((asset) => asset.key),
    ).toEqual([
      'board-background:moonlit:hd',
      'board-background:moonlit:balanced',
      'board-background:moonlit:low',
      'board-background:moonlit:fallback',
    ])
    expect(onFailure).toHaveBeenCalledTimes(4)
  })

  it('does not retry failed URLs in a later preload cycle', () => {
    const failedUrls = new FailedAssetUrlRegistry()
    const first = createLoaderPort()
    const firstHandle = loadPhaserBoardAssetManifest(
      first.port,
      buildPhaserBoardAssetManifest('verdant', 'high'),
      { failedUrls, onFailure: vi.fn() },
    )
    first.emitError({ key: 'board-background:verdant:hd' })
    firstHandle.dispose()

    const second = createLoaderPort()
    loadPhaserBoardAssetManifest(
      second.port,
      buildPhaserBoardAssetManifest('verdant', 'high'),
      { failedUrls, onFailure: vi.fn() },
    )

    expect(
      second.queued.filter((asset) => asset.kind === 'image').map((asset) => asset.key),
    ).toEqual(['board-background:verdant:balanced'])
  })

  it('retries a transiently failed URL after the registry is cleared', () => {
    const failedUrls = new FailedAssetUrlRegistry()
    const first = createLoaderPort()
    const firstHandle = loadPhaserBoardAssetManifest(
      first.port,
      buildPhaserBoardAssetManifest('verdant', 'high'),
      { failedUrls, onFailure: vi.fn() },
    )
    first.emitError({ key: 'board-background:verdant:hd' })
    firstHandle.dispose()

    failedUrls.clear()
    const retry = createLoaderPort()
    loadPhaserBoardAssetManifest(
      retry.port,
      buildPhaserBoardAssetManifest('verdant', 'high'),
      { failedUrls, onFailure: vi.fn() },
    )

    expect(
      retry.queued.filter((asset) => asset.kind === 'image').map((asset) => asset.key),
    ).toEqual(['board-background:verdant:hd'])
  })

  it('queues a fallback before loader completion when image processing fails', () => {
    const failedUrls = new FailedAssetUrlRegistry()
    const harness = createLoaderPort()
    const onFailure = vi.fn()
    const handle = loadPhaserBoardAssetManifest(
      harness.port,
      buildPhaserBoardAssetManifest('moonlit', 'high'),
      { failedUrls, onFailure },
    )
    const originalOnProcessError = vi.fn()
    const file: ProcessableLoaderFile = {
      key: 'board-background:moonlit:hd',
      src: '/boards/moonlit/background-hd.png',
      type: 'image',
      onProcessError: originalOnProcessError,
    }
    observeLoaderFileProcessingErrors(file, harness.emitError)
    file.onProcessError?.()

    expect(
      harness.queued.filter((asset) => asset.kind === 'image').map((asset) => asset.key),
    ).toEqual([
      'board-background:moonlit:hd',
      'board-background:moonlit:balanced',
    ])
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
      key: 'board-background:moonlit:hd',
      source: '/boards/moonlit/background-hd.png',
    }))
    expect(originalOnProcessError).toHaveBeenCalledTimes(1)

    harness.addTexture('board-background:moonlit:balanced')
    harness.addTexture('board-atlas:ambience:moonlit', AMBIENCE_ATLAS_FRAMES)
    harness.addTexture('board-atlas:board-ui', BOARD_UI_ATLAS_FRAMES)
    harness.addTexture('board-atlas:effects', ['spark', 'impact-ring', 'trail', 'shield'])
    harness.emitComplete()
    expect(handle.resolveBackgroundTextureKey()).toBe('board-background:moonlit:balanced')
    expect(harness.errorListenerCount()).toBe(0)

    const nextCycle = createLoaderPort()
    loadPhaserBoardAssetManifest(
      nextCycle.port,
      buildPhaserBoardAssetManifest('moonlit', 'high'),
      { failedUrls, onFailure: vi.fn() },
    )
    expect(
      nextCycle.queued.filter((asset) => asset.kind === 'image').map((asset) => asset.key),
    ).toEqual(['board-background:moonlit:balanced'])
  })

  it('swallows malformed atlas JSON after reporting its processing failure', () => {
    const onError = vi.fn()
    const originalOnProcessError = vi.fn()
    const file: ProcessableLoaderFile = {
      key: 'board-atlas:effects',
      src: '/sprites/effects-atlas.json',
      type: 'json',
      onProcessError: originalOnProcessError,
    }
    file.onProcess = () => {
      file.onProcessError?.()
      throw new SyntaxError('malformed JSON')
    }

    observeLoaderFileProcessingErrors(file, onError)

    expect(() => file.onProcess?.()).not.toThrow()
    expect(onError).toHaveBeenCalledWith(file)
    expect(originalOnProcessError).toHaveBeenCalledTimes(1)
  })

  it('recovers when malformed atlas frames throw during last-child assembly', () => {
    const harness = createLoaderPort()
    const onFailure = vi.fn()
    loadPhaserBoardAssetManifest(
      harness.port,
      buildPhaserBoardAssetManifest('classic', 'balanced'),
      { failedUrls: new FailedAssetUrlRegistry(), onFailure },
    )
    harness.addTexture('board-atlas:effects')
    const originalOnProcessError = vi.fn()
    const file: ProcessableLoaderFile = {
      key: 'board-atlas:effects',
      src: '/sprites/effects-atlas.png',
      type: 'image',
      onProcessComplete: () => {
        throw new TypeError('malformed atlas frame')
      },
      onProcessError: originalOnProcessError,
    }
    observeLoaderFileProcessingErrors(file, harness.emitError)

    expect(() => file.onProcessComplete?.()).not.toThrow()
    expect(originalOnProcessError).toHaveBeenCalledTimes(1)
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
      key: 'board-atlas:effects',
    }))
    expect(harness.port.textureExists('board-atlas:effects')).toBe(false)
  })

  it('rejects a late file completion after its loader generation is disposed', () => {
    const onError = vi.fn()
    const originalOnProcessComplete = vi.fn()
    const originalOnProcessError = vi.fn()
    let disposed = false
    const file: ProcessableLoaderFile = {
      key: 'board-background:classic:hd',
      src: '/boards/classic/background-hd.png',
      type: 'image',
      onProcessComplete: originalOnProcessComplete,
      onProcessError: originalOnProcessError,
    }
    observeLoaderFileProcessingErrors(file, onError, () => disposed)

    disposed = true
    file.onProcessComplete?.()

    expect(originalOnProcessComplete).not.toHaveBeenCalled()
    expect(originalOnProcessError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(file)
  })

  it('rejects atlases missing required frames and suppresses later retries', () => {
    const failedUrls = new FailedAssetUrlRegistry()
    const first = createLoaderPort()
    const onFailure = vi.fn()
    loadPhaserBoardAssetManifest(
      first.port,
      buildPhaserBoardAssetManifest('classic', 'balanced'),
      { failedUrls, onFailure },
    )
    first.addTexture('board-background:classic:balanced')
    first.addTexture('board-atlas:ambience:classic', AMBIENCE_ATLAS_FRAMES)
    first.addTexture('board-atlas:board-ui', BOARD_UI_ATLAS_FRAMES)
    first.addTexture('board-atlas:effects', ['spark'])
    first.emitComplete()

    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
      key: 'board-atlas:effects',
    }))
    expect(first.port.textureExists('board-atlas:effects')).toBe(false)

    const second = createLoaderPort()
    loadPhaserBoardAssetManifest(
      second.port,
      buildPhaserBoardAssetManifest('classic', 'balanced'),
      { failedUrls, onFailure: vi.fn() },
    )

    expect(second.queued.map((asset) => asset.key)).not.toContain('board-atlas:effects')
    expect(second.queued.map((asset) => asset.key)).toContain('board-background:classic:balanced')
  })

  it('uses existing textures and removes listeners on complete or repeated disposal', () => {
    const harness = createLoaderPort(['board-background:classic:balanced'])
    const handle = loadPhaserBoardAssetManifest(
      harness.port,
      buildPhaserBoardAssetManifest('classic', 'balanced'),
      { failedUrls: new FailedAssetUrlRegistry(), onFailure: vi.fn() },
    )

    expect(handle.resolveBackgroundTextureKey()).toBe('board-background:classic:balanced')
    expect(handle.isActive()).toBe(true)
    expect(harness.queued.some((asset) => asset.kind === 'image')).toBe(false)
    expect(harness.errorListenerCount()).toBe(1)
    expect(harness.completeListenerCount()).toBe(1)

    harness.emitComplete()
    expect(handle.isActive()).toBe(false)
    handle.dispose()
    expect(harness.errorListenerCount()).toBe(0)
    expect(harness.completeListenerCount()).toBe(0)
  })

  it('notifies the scene after a dynamically queued manifest completes', () => {
    const harness = createLoaderPort()
    const onComplete = vi.fn()
    loadPhaserBoardAssetManifest(
      harness.port,
      buildPhaserBoardAssetManifest('verdant', 'high'),
      {
        failedUrls: new FailedAssetUrlRegistry(),
        onFailure: vi.fn(),
        onComplete,
      },
    )

    harness.emitComplete()

    expect(onComplete).toHaveBeenCalledOnce()
    expect(harness.errorListenerCount()).toBe(0)
    expect(harness.completeListenerCount()).toBe(0)
  })
})
