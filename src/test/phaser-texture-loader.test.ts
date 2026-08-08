import { describe, expect, it, vi } from 'vitest'
import {
  FailedAssetUrlRegistry,
  loadPhaserBoardAssetManifest,
  type LoaderFileFailure,
  type PhaserTextureLoaderPort,
} from '../renderers/phaser/texture-loader'
import { buildPhaserBoardAssetManifest } from '../renderers/phaser/asset-manifest'

type QueuedAsset =
  | { readonly kind: 'image'; readonly key: string; readonly urls: readonly string[] }
  | { readonly kind: 'atlas'; readonly key: string; readonly urls: readonly string[] }

function createLoaderPort(initialTextures: readonly string[] = []): {
  readonly port: PhaserTextureLoaderPort
  readonly queued: QueuedAsset[]
  emitError(file: LoaderFileFailure): void
  emitComplete(): void
  errorListenerCount(): number
  completeListenerCount(): number
} {
  const textures = new Set(initialTextures)
  const queued: QueuedAsset[] = []
  const errorListeners = new Set<(file: LoaderFileFailure) => void>()
  const completeListeners = new Set<() => void>()
  const port: PhaserTextureLoaderPort = {
    textureExists: (key) => textures.has(key),
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
      for (const listener of [...completeListeners]) listener()
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

  it('suppresses failed atlases on later cycles without affecting gameplay', () => {
    const failedUrls = new FailedAssetUrlRegistry()
    const first = createLoaderPort()
    const firstHandle = loadPhaserBoardAssetManifest(
      first.port,
      buildPhaserBoardAssetManifest('classic', 'balanced'),
      { failedUrls, onFailure: vi.fn() },
    )
    first.emitError({ key: 'board-atlas:effects', src: '/sprites/effects-atlas.png' })
    firstHandle.dispose()

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
    expect(harness.queued.some((asset) => asset.kind === 'image')).toBe(false)
    expect(harness.errorListenerCount()).toBe(1)
    expect(harness.completeListenerCount()).toBe(1)

    harness.emitComplete()
    handle.dispose()
    expect(harness.errorListenerCount()).toBe(0)
    expect(harness.completeListenerCount()).toBe(0)
  })
})
