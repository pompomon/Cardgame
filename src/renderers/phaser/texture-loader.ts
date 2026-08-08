import type Phaser from 'phaser'
import type { BoardTheme } from '../../app/board-theme'
import type { RenderQualityPreference } from '../../app/render-quality'
import {
  buildPhaserBoardAssetManifest,
  resolveLoadedBoardBackgroundTextureKey,
  type PhaserAssetDescriptor,
  type PhaserBoardAssetManifest,
} from './asset-manifest'

const FILE_LOAD_ERROR_EVENT = 'loaderror'
const LOAD_COMPLETE_EVENT = 'complete'

export interface PhaserTextureLoaderPort {
  textureExists(key: string): boolean
  queueImage(key: string, url: string): void
  queueAtlas(key: string, textureUrl: string, atlasUrl: string): void
  onFileError(listener: (file: LoaderFileFailure) => void): void
  offFileError(listener: (file: LoaderFileFailure) => void): void
  onceComplete(listener: () => void): void
  offComplete(listener: () => void): void
}

export interface LoaderFileFailure {
  readonly key?: unknown
  readonly src?: unknown
}

export interface AssetLoadFailure {
  readonly key: string
  readonly urls: readonly string[]
  readonly source: string | null
}

export class FailedAssetUrlRegistry {
  private readonly urls = new Set<string>()

  has(url: string): boolean {
    return this.urls.has(url)
  }

  hasAny(urls: readonly string[]): boolean {
    return urls.some((url) => this.urls.has(url))
  }

  noteAll(urls: readonly string[]): boolean {
    let changed = false
    for (const url of urls) {
      if (!this.urls.has(url)) {
        this.urls.add(url)
        changed = true
      }
    }
    return changed
  }
}

export interface BoardAssetLoadHandle {
  readonly manifest: PhaserBoardAssetManifest
  resolveBackgroundTextureKey(): string | null
  dispose(): void
}

interface BoardAssetLoaderOptions {
  readonly failedUrls?: FailedAssetUrlRegistry
  readonly onFailure?: (failure: AssetLoadFailure) => void
}

const failedRuntimeAssetUrls = new FailedAssetUrlRegistry()

function descriptorUrls(descriptor: PhaserAssetDescriptor): readonly string[] {
  switch (descriptor.kind) {
    case 'image':
      return [descriptor.url]
    case 'atlas':
      return [descriptor.textureUrl, descriptor.atlasUrl]
    default:
      return []
  }
}

function defaultFailureReporter(failure: AssetLoadFailure): void {
  // eslint-disable-next-line no-console
  console.warn(
    '[phaser] failed to load board asset',
    failure.key,
    failure.source ?? failure.urls.join(', '),
  )
}

export function loadPhaserBoardAssetManifest(
  port: PhaserTextureLoaderPort,
  manifest: PhaserBoardAssetManifest,
  options: BoardAssetLoaderOptions = {},
): BoardAssetLoadHandle {
  const failedUrls = options.failedUrls ?? failedRuntimeAssetUrls
  const onFailure = options.onFailure ?? defaultFailureReporter
  const pending = new Map<string, PhaserAssetDescriptor>()
  const backgroundKeys = new Set(manifest.backgroundCandidates.map((asset) => asset.key))
  let nextBackgroundIndex = 0
  let disposed = false

  const queueDescriptor = (descriptor: PhaserAssetDescriptor): void => {
    const urls = descriptorUrls(descriptor)
    if (port.textureExists(descriptor.key) || failedUrls.hasAny(urls)) {
      return
    }
    pending.set(descriptor.key, descriptor)
    switch (descriptor.kind) {
      case 'image':
        port.queueImage(descriptor.key, descriptor.url)
        return
      case 'atlas':
        port.queueAtlas(descriptor.key, descriptor.textureUrl, descriptor.atlasUrl)
        return
      default:
        return
    }
  }

  const queueNextBackground = (): void => {
    while (nextBackgroundIndex < manifest.backgroundCandidates.length) {
      const candidate = manifest.backgroundCandidates[nextBackgroundIndex]
      nextBackgroundIndex += 1
      if (port.textureExists(candidate.key)) {
        return
      }
      if (failedUrls.has(candidate.url)) {
        continue
      }
      queueDescriptor(candidate)
      return
    }
  }

  const dispose = (): void => {
    if (disposed) {
      return
    }
    disposed = true
    pending.clear()
    port.offFileError(onFileError)
    port.offComplete(onComplete)
  }

  const onFileError = (file: LoaderFileFailure): void => {
    const key = typeof file.key === 'string' ? file.key : null
    if (key === null) {
      return
    }
    const descriptor = pending.get(key)
    if (!descriptor) {
      return
    }
    pending.delete(key)
    const urls = descriptorUrls(descriptor)
    if (failedUrls.noteAll(urls)) {
      onFailure({
        key,
        urls,
        source: typeof file.src === 'string' ? file.src : null,
      })
    }
    if (backgroundKeys.has(key)) {
      queueNextBackground()
    }
  }

  const onComplete = (): void => {
    dispose()
  }

  port.onFileError(onFileError)
  port.onceComplete(onComplete)
  queueNextBackground()
  for (const atlas of manifest.atlases) {
    queueDescriptor(atlas)
  }

  return {
    manifest,
    resolveBackgroundTextureKey: () =>
      resolveLoadedBoardBackgroundTextureKey(manifest, port.textureExists),
    dispose,
  }
}

function textureLoaderPortForScene(scene: Phaser.Scene): PhaserTextureLoaderPort {
  return {
    textureExists: (key) => scene.textures.exists(key),
    queueImage: (key, url) => {
      scene.load.image(key, url)
    },
    queueAtlas: (key, textureUrl, atlasUrl) => {
      scene.load.atlas(key, textureUrl, atlasUrl)
    },
    onFileError: (listener) => {
      scene.load.on(FILE_LOAD_ERROR_EVENT, listener)
    },
    offFileError: (listener) => {
      scene.load.off(FILE_LOAD_ERROR_EVENT, listener)
    },
    onceComplete: (listener) => {
      scene.load.once(LOAD_COMPLETE_EVENT, listener)
    },
    offComplete: (listener) => {
      scene.load.off(LOAD_COMPLETE_EVENT, listener)
    },
  }
}

export function preloadPhaserBoardAssets(
  scene: Phaser.Scene,
  theme: BoardTheme,
  quality: RenderQualityPreference,
): BoardAssetLoadHandle {
  return loadPhaserBoardAssetManifest(
    textureLoaderPortForScene(scene),
    buildPhaserBoardAssetManifest(theme, quality),
  )
}
