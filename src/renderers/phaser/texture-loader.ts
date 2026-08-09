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
const FILE_ADDED_EVENT = 'addfile'
const LOAD_COMPLETE_EVENT = 'complete'

export interface PhaserTextureLoaderPort {
  textureExists(key: string): boolean
  textureHasFrame(key: string, frame: string): boolean
  removeTexture(key: string): void
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

export interface ProcessableLoaderFile extends LoaderFileFailure {
  readonly type?: unknown
  onProcess?: () => void
  onProcessComplete?: () => void
  onProcessError?: () => void
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
  readonly onComplete?: () => void
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

export function observeLoaderFileProcessingErrors(
  file: ProcessableLoaderFile,
  onError: (file: LoaderFileFailure) => void,
): void {
  const originalOnProcessError = file.onProcessError
  if (typeof originalOnProcessError !== 'function') {
    return
  }
  let reported = false
  file.onProcessError = () => {
    if (!reported) {
      reported = true
      onError(file)
    }
    originalOnProcessError.call(file)
  }

  // Atlas assembly happens inside whichever child file completes last. Guard
  // every child so malformed frame data cannot throw out of MultiFile
  // addToCache(), strand the loader queue, and prevent scene creation.
  if (typeof file.onProcessComplete === 'function') {
    const originalOnProcessComplete = file.onProcessComplete
    file.onProcessComplete = () => {
      try {
        originalOnProcessComplete.call(file)
      } catch {
        file.onProcessError?.()
      }
    }
  }

  // Phaser's JSONFile rethrows malformed JSON after calling onProcessError.
  // Atlas JSON is optional presentation data, so keep the loader alive after
  // the original handler has marked the file as failed.
  if (file.type === 'json' && typeof file.onProcess === 'function') {
    const originalOnProcess = file.onProcess
    file.onProcess = () => {
      try {
        originalOnProcess.call(file)
      } catch {
        if (!reported) {
          file.onProcessError?.()
        }
      }
    }
  }
}

function descriptorIsUsable(
  port: PhaserTextureLoaderPort,
  descriptor: PhaserAssetDescriptor,
): boolean {
  switch (descriptor.kind) {
    case 'image':
      return port.textureExists(descriptor.key)
    case 'atlas':
      return port.textureExists(descriptor.key)
        && descriptor.requiredFrames.every((frame) =>
          port.textureHasFrame(descriptor.key, frame),
        )
    default:
      return false
  }
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

  const noteFailure = (
    descriptor: PhaserAssetDescriptor,
    source: string | null,
  ): void => {
    const urls = descriptorUrls(descriptor)
    if (failedUrls.noteAll(urls)) {
      onFailure({
        key: descriptor.key,
        urls,
        source,
      })
    }
  }

  const queueDescriptor = (descriptor: PhaserAssetDescriptor): void => {
    const urls = descriptorUrls(descriptor)
    if (descriptorIsUsable(port, descriptor) || failedUrls.hasAny(urls)) {
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
    if (disposed) {
      return
    }
    const key = typeof file.key === 'string' ? file.key : null
    if (key === null) {
      return
    }
    const descriptor = pending.get(key)
    if (!descriptor) {
      return
    }
    pending.delete(key)
    noteFailure(descriptor, typeof file.src === 'string' ? file.src : null)
    if (descriptor.kind === 'atlas' && port.textureExists(descriptor.key)) {
      port.removeTexture(descriptor.key)
    }
    if (backgroundKeys.has(key)) {
      queueNextBackground()
    }
  }

  const onComplete = (): void => {
    const completedDescriptors = [...pending.values()]
    pending.clear()
    for (const descriptor of completedDescriptors) {
      if (descriptorIsUsable(port, descriptor)) {
        continue
      }
      // Atlas parsing can produce a texture without its declared frames. Treat
      // that as a failed optional atlas so later scene starts do not retry it.
      noteFailure(descriptor, null)
      if (descriptor.kind === 'atlas' && port.textureExists(descriptor.key)) {
        port.removeTexture(descriptor.key)
      }
    }
    dispose()
    options.onComplete?.()
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
  const fileAddedListeners = new Map<
    (file: LoaderFileFailure) => void,
    (
      key: string,
      type: string,
      loader: Phaser.Loader.LoaderPlugin,
      file: ProcessableLoaderFile,
    ) => void
  >()
  return {
    textureExists: (key) => scene.textures.exists(key),
    textureHasFrame: (key, frame) =>
      scene.textures.exists(key) && scene.textures.get(key).has(frame),
    removeTexture: (key) => {
      scene.textures.remove(key)
    },
    queueImage: (key, url) => {
      scene.load.image(key, url)
    },
    queueAtlas: (key, textureUrl, atlasUrl) => {
      scene.load.atlas(key, textureUrl, atlasUrl)
    },
    onFileError: (listener) => {
      const onFileAdded = (
        _key: string,
        _type: string,
        _loader: Phaser.Loader.LoaderPlugin,
        file: ProcessableLoaderFile,
      ): void => {
        observeLoaderFileProcessingErrors(file, listener)
      }
      fileAddedListeners.set(listener, onFileAdded)
      scene.load.on(FILE_ADDED_EVENT, onFileAdded)
      scene.load.on(FILE_LOAD_ERROR_EVENT, listener)
    },
    offFileError: (listener) => {
      const onFileAdded = fileAddedListeners.get(listener)
      if (onFileAdded) {
        scene.load.off(FILE_ADDED_EVENT, onFileAdded)
        fileAddedListeners.delete(listener)
      }
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
  onComplete?: () => void,
): BoardAssetLoadHandle {
  return loadPhaserBoardAssetManifest(
    textureLoaderPortForScene(scene),
    buildPhaserBoardAssetManifest(theme, quality),
    { onComplete },
  )
}
