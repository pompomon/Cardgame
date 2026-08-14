// Card art texture loading: preloads photoreal/raster textures (and their
// geometric fallback) for the currently selected card visual style, plus the
// shared card-back texture. Extracted from card-factory.ts so the "load
// textures into the scene" concern is separate from the "build a card
// GameObject from already-loaded textures" concern.
import Phaser from 'phaser'
import { CARD_BACK_KEY, cardBackUrl } from '../../app/card-art'
import type { AppViewModel } from '../../app/types'
import { preloadCardArtEntriesForStyle } from './card-rendering'
import { FailedAssetUrlRegistry } from './texture-loader'

// Failed URLs are suppressed across scene restarts so offline/missing assets
// do not repeatedly stall preload. Online recovery and renderer teardown clear
// the registry so transient failures can be retried.
const failedCardArtUrls = new FailedAssetUrlRegistry()
const activeCardArtLoaders = new WeakMap<object, CardArtLoadHandle>()

export interface CardArtLoadHandle {
  isActive(): boolean
  dispose(): void
}

export function clearFailedCardArtUrls(): void {
  failedCardArtUrls.clear()
}

export function preloadCardArt(
  scene: Phaser.Scene,
  style: AppViewModel['cardVisualStyle'],
): CardArtLoadHandle | null {
  const loader = scene.load
  const existingHandle = activeCardArtLoaders.get(loader)
  if (existingHandle?.isActive()) {
    return existingHandle
  }
  const queuedUrls = new Map<string, string>()
  const queueImage = (key: string, url: string): void => {
    if (scene.textures.exists(key) || failedCardArtUrls.has(url)) {
      return
    }
    loader.image(key, url)
    queuedUrls.set(key, url)
  }
  for (const entry of preloadCardArtEntriesForStyle(style)) {
    queueImage(entry.key, entry.url)
    // Also preload the geometric raster fallback (e.g. hd-fallback) under a
    // dedicated key so `addCardArtToContainer` can render it when the
    // primary photoreal texture is missing or failed to load — before
    // degrading further to the procedural pixel-template icon.
    if (entry.fallbackKey !== undefined && entry.fallbackUrl !== undefined) {
      queueImage(entry.fallbackKey, entry.fallbackUrl)
    }
  }
  queueImage(CARD_BACK_KEY, cardBackUrl())
  // Phaser scenes can be stopped/started repeatedly (e.g. lobby ↔ game).
  // `scene.load.once` only detaches when the event actually fires, so on
  // successful loads the FILE_LOAD_ERROR handler would accumulate across
  // repeated preload cycles. Detach on COMPLETE as well, and skip
  // re-attaching when a handler is already pending on the loader.
  const errorEvent = Phaser.Loader.Events.FILE_LOAD_ERROR
  const completeEvent = Phaser.Loader.Events.COMPLETE
  if (queuedUrls.size === 0) {
    return null
  }
  let active = true
  const onError = (file: { key?: string; src?: string }): void => {
    const key = file?.key ?? '<unknown>'
    const url = queuedUrls.get(key)
    if (!url || !failedCardArtUrls.noteAll([url])) {
      return
    }
    // eslint-disable-next-line no-console
    console.warn('[phaser] failed to load card art', key, file?.src ?? '')
  }
  const dispose = (): void => {
    if (!active) {
      return
    }
    active = false
    loader.off(errorEvent, onError)
    loader.off(completeEvent, onComplete)
    activeCardArtLoaders.delete(loader)
  }
  const onComplete = (): void => {
    dispose()
  }
  const handle: CardArtLoadHandle = {
    isActive: () => active,
    dispose,
  }
  activeCardArtLoaders.set(loader, handle)
  scene.load.on(errorEvent, onError)
  scene.load.on(completeEvent, onComplete)
  return handle
}
