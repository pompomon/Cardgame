// Card art texture loading: preloads photoreal/raster textures (and their
// geometric fallback) for the currently selected card visual style, plus the
// shared card-back texture. Extracted from card-factory.ts so the "load
// textures into the scene" concern is separate from the "build a card
// GameObject from already-loaded textures" concern.
import Phaser from 'phaser'
import { CARD_BACK_KEY, cardBackUrl } from '../../app/card-art'
import type { AppViewModel } from '../../app/types'
import { preloadCardArtEntriesForStyle } from './card-rendering'

// Per-key tracking so each (style, land) load failure is logged exactly
// once instead of swallowing all subsequent errors after the first. This
// turns "every HD card silently fell back to the procedural pixel icon"
// from invisible into an actionable warning per missing asset.
const cardArtLoadErrorKeys = new Set<string>()
const activeCardArtLoaders = new WeakSet<object>()

export function preloadCardArt(scene: Phaser.Scene, style: AppViewModel['cardVisualStyle']): void {
  const queuedKeys = new Set<string>()
  for (const entry of preloadCardArtEntriesForStyle(style)) {
    if (!scene.textures.exists(entry.key)) {
      scene.load.image(entry.key, entry.url)
      queuedKeys.add(entry.key)
    }
    // Also preload the geometric raster fallback (e.g. hd-fallback) under a
    // dedicated key so `addCardArtToContainer` can render it when the
    // primary photoreal texture is missing or failed to load — before
    // degrading further to the procedural pixel-template icon.
    if (entry.fallbackKey !== undefined && entry.fallbackUrl !== undefined && !scene.textures.exists(entry.fallbackKey)) {
      scene.load.image(entry.fallbackKey, entry.fallbackUrl)
      queuedKeys.add(entry.fallbackKey)
    }
  }
  if (!scene.textures.exists(CARD_BACK_KEY)) {
    scene.load.image(CARD_BACK_KEY, cardBackUrl())
    queuedKeys.add(CARD_BACK_KEY)
  }
  // Phaser scenes can be stopped/started repeatedly (e.g. lobby ↔ game).
  // `scene.load.once` only detaches when the event actually fires, so on
  // successful loads the FILE_LOAD_ERROR handler would accumulate across
  // repeated preload cycles. Detach on COMPLETE as well, and skip
  // re-attaching when a handler is already pending on the loader.
  const loader = scene.load
  const errorEvent = Phaser.Loader.Events.FILE_LOAD_ERROR
  if (queuedKeys.size === 0 || activeCardArtLoaders.has(loader)) {
    return
  }
  activeCardArtLoaders.add(loader)
  const onError = (file: { key?: string; src?: string }): void => {
    const key = file?.key ?? '<unknown>'
    if (!queuedKeys.has(key) || cardArtLoadErrorKeys.has(key)) {
      return
    }
    cardArtLoadErrorKeys.add(key)
    // eslint-disable-next-line no-console
    console.warn('[phaser] failed to load card art', key, file?.src ?? '')
  }
  scene.load.on(errorEvent, onError)
  scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
    scene.load.off(errorEvent, onError)
    activeCardArtLoaders.delete(loader)
  })
}
