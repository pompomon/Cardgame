import { CanvasTexture, LinearFilter, NearestFilter, SRGBColorSpace } from 'three'
import { boardAmbienceAtlasLocation, boardBackgroundAssetLocation, type BoardAtlasAssetLocation, type BoardBackgroundVariant } from '../../app/board-assets'
import type { BoardTheme } from '../../app/board-theme'
import { cardBackUrl } from '../../app/card-art'
import { cardArtSourceFor, cardVisualPaletteFor, landPixelRects } from '../../app/card-visuals'
import type { CardVisualStyle } from '../../app/card-visual-styles'
import { HIDDEN_HAND_CARD_NAME } from '../../app/types'
import { isIntegerInRange, isRecordObject } from '../../app/validators'
import { isBasicLand } from '../../game/types'
import { computeCoverFitCrop } from '../phaser/board-background'

const FAILED_URL_LIMIT = 128
const ATLAS_METADATA_LIMIT = 16384
const failedUrls = new Set<string>()

export interface TextureLease {
  readonly texture: CanvasTexture
  readonly ready?: boolean
  readonly failed?: boolean
  release(): void
}

export interface AmbienceFrame {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly atlasWidth: number
  readonly atlasHeight: number
}

interface TextureEntry {
  readonly key: string
  readonly texture: CanvasTexture
  readonly canvas: HTMLCanvasElement
  readonly context: CanvasRenderingContext2D
  readonly candidates: readonly string[]
  readonly paint: (image?: HTMLImageElement, frame?: AmbienceFrame) => void
  readonly atlas?: BoardAtlasAssetLocation
  readonly transient: boolean
  ready: boolean
  failed: boolean
  recoverable: boolean
  refs: number
  touched: number
  generation: number
  cancel: (() => void) | null
}

export function boardTextureDimensions(variant: BoardBackgroundVariant): Readonly<{ width: number; height: number }> {
  switch (variant) {
    case 'hd': return { width: 1920, height: 1080 }
    case 'balanced': return { width: 1280, height: 720 }
    case 'low': return { width: 960, height: 540 }
    case 'fallback': return { width: 640, height: 360 }
    default: return { width: 640, height: 360 }
  }
}

/** Only the unrotated mote rectangle is consumed; metadata URLs are never followed. */
export function parseAmbienceFrame(value: unknown): AmbienceFrame | null {
  if (!isRecordObject(value) || !isRecordObject(value.frames) || !isRecordObject(value.meta) || !isRecordObject(value.meta.size)) return null
  const mote = value.frames['ambient-mote']
  if (!isRecordObject(mote) || mote.rotated !== false || mote.trimmed !== false || !isRecordObject(mote.frame)) return null
  const { x, y, w, h } = mote.frame
  const { w: atlasWidth, h: atlasHeight } = value.meta.size
  if (!isIntegerInRange(x, 0, 2048) || !isIntegerInRange(y, 0, 2048)
    || !isIntegerInRange(w, 1, 256) || !isIntegerInRange(h, 1, 256)
    || !isIntegerInRange(atlasWidth, 1, 2048) || !isIntegerInRange(atlasHeight, 1, 2048)
    || x + w > atlasWidth || y + h > atlasHeight) return null
  return { x, y, width: w, height: h, atlasWidth, atlasHeight }
}

async function atlasMetadata(url: string, signal: AbortSignal): Promise<AmbienceFrame> {
  const response = await fetch(url, { signal })
  if (!response.ok || Number(response.headers.get('content-length')) > ATLAS_METADATA_LIMIT) {
    throw new Error('Ambience metadata unavailable')
  }
  let text = ''
  if (response.body) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let bytes = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > ATLAS_METADATA_LIMIT) throw new Error('Ambience metadata too large')
        text += decoder.decode(chunk.value, { stream: true })
      }
      text += decoder.decode()
    } finally {
      await reader.cancel()
      reader.releaseLock()
    }
  } else {
    text = await response.text()
  }
  if (text.length > ATLAS_METADATA_LIMIT) throw new Error('Ambience metadata too large')
  const frame = parseAmbienceFrame(JSON.parse(text))
  if (!frame) throw new Error('Invalid ambience frame')
  return frame
}

function coverImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number): void {
  const crop = computeCoverFitCrop(image.width, image.height, width, height)
  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, x, y, width, height)
}

export function cardAssetCandidates(name: string, style: CardVisualStyle): readonly string[] {
  if (name === HIDDEN_HAND_CARD_NAME) return [cardBackUrl()]
  if (!isBasicLand(name)) return []
  const source = cardArtSourceFor(name, style, 464)
  return source.isRaster
    ? [source.primaryUrl, ...(source.rasterFallbackUrl ? [source.rasterFallbackUrl] : [])]
    : []
}

export function boardAssetCandidates(theme: BoardTheme, variant: BoardBackgroundVariant): readonly string[] {
  const variants: readonly BoardBackgroundVariant[] = ['hd', 'balanced', 'low', 'fallback']
  return variants.slice(variants.indexOf(variant)).map((entry) => boardBackgroundAssetLocation(theme, entry).url)
}

function rememberFailure(url: string): void {
  failedUrls.add(url)
  if (failedUrls.size > FAILED_URL_LIMIT) failedUrls.delete(failedUrls.values().next().value!)
}

/** A lease owns its ref; dormant entries are LRU-bounded, including in-flight images. */
export class ThreeAssets {
  private readonly entries = new Map<string, TextureEntry>()
  private disposed = false
  private clock = 0
  private readonly invalidate: () => void
  private readonly idleLimit: number
  private readonly onOnline = (): void => {
    failedUrls.clear()
    for (const entry of this.entries.values()) {
      if (entry.refs > 0 && (!entry.ready || entry.recoverable)) this.load(entry)
    }
  }

  constructor(invalidate: () => void, idleLimit = 20) {
    this.invalidate = invalidate
    this.idleLimit = Math.max(0, idleLimit)
    window.addEventListener('online', this.onOnline)
  }

  acquireCard(name: string, style: CardVisualStyle): TextureLease {
    const safeName = isBasicLand(name) || name === HIDDEN_HAND_CARD_NAME ? name : 'Unknown card'
    return this.acquire(`card:${style}:${safeName}`, 512, 704, cardAssetCandidates(safeName, style), (ctx, image) => {
      const palette = isBasicLand(safeName) ? cardVisualPaletteFor(safeName, style) : null
      ctx.fillStyle = palette?.cardFill ?? '#17283f'
      ctx.fillRect(0, 0, 512, 704)
      ctx.strokeStyle = palette?.cardStroke ?? '#b7c5df'
      ctx.lineWidth = 10
      ctx.strokeRect(8, 8, 496, 688)
      if (safeName === HIDDEN_HAND_CARD_NAME) {
        if (image) {
          coverImage(ctx, image, 20, 20, 472, 664)
        } else {
          ctx.strokeStyle = '#7796bf'
          for (let inset = 40; inset < 210; inset += 30) {
            ctx.strokeRect(inset, inset, 512 - inset * 2, 704 - inset * 2)
          }
          ctx.fillStyle = '#e3eaff'
          ctx.font = 'bold 46px system-ui, sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText('CARDGAME', 256, 368, 420)
        }
        return
      }
      if (image) coverImage(ctx, image, 16, 16, 480, 672)
      else if (palette && isBasicLand(safeName)) {
        for (const pixel of landPixelRects(safeName, 464)) {
          ctx.fillStyle = pixel.tone === 'primary' ? palette.iconPrimary : palette.iconSecondary
          ctx.fillRect(24 + pixel.x, 80 + pixel.y, pixel.size, pixel.size)
        }
      }
      ctx.fillStyle = 'rgba(8, 18, 30, 0.88)'
      ctx.fillRect(16, 588, 480, 100)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 72px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(safeName, 256, 664, 456)
    })
  }

  acquireBoard(theme: BoardTheme, variant: BoardBackgroundVariant): TextureLease {
    const { width, height } = boardTextureDimensions(variant)
    return this.acquire(`board:${theme}:${variant}`, width, height, boardAssetCandidates(theme, variant), (ctx, image) => {
      const gradient = ctx.createRadialGradient(width / 2, height * 0.4, 20, width / 2, height / 2, width * 0.65)
      gradient.addColorStop(0, theme === 'verdant' ? '#244e3d' : theme === 'moonlit' ? '#303657' : '#284546')
      gradient.addColorStop(1, '#080f1d')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)
      if (image) coverImage(ctx, image, 0, 0, width, height)
    }, { transient: true, smooth: true })
  }

  acquireAmbience(theme: BoardTheme): TextureLease {
    const atlas = boardAmbienceAtlasLocation(theme)
    return this.acquire(`ambience:${theme}`, 64, 64, [atlas.textureUrl], (ctx, image, frame) => {
      ctx.clearRect(0, 0, 64, 64)
      if (image && frame) ctx.drawImage(image, frame.x, frame.y, frame.width, frame.height, 0, 0, 64, 64)
    }, { transient: true, smooth: true, atlas })
  }

  get size(): number {
    return this.entries.size
  }

  private acquire(
    key: string,
    width: number,
    height: number,
    candidates: readonly string[],
    draw: (context: CanvasRenderingContext2D, image?: HTMLImageElement, frame?: AmbienceFrame) => void,
    options: { transient?: boolean; smooth?: boolean; atlas?: BoardAtlasAssetLocation } = {},
  ): TextureLease {
    if (this.disposed) throw new Error('Three.js assets have been disposed')
    let entry = this.entries.get(key)
    if (!entry) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas text rendering is unavailable')
      const texture = new CanvasTexture(canvas)
      texture.colorSpace = SRGBColorSpace
      texture.generateMipmaps = false
      const paint = (image?: HTMLImageElement, frame?: AmbienceFrame): void => {
        const smooth = Boolean(image) || options.smooth === true
        context.imageSmoothingEnabled = smooth
        texture.minFilter = smooth ? LinearFilter : NearestFilter
        texture.magFilter = smooth ? LinearFilter : NearestFilter
        draw(context, image, frame)
        texture.needsUpdate = true
      }
      entry = {
        key, texture, canvas, context, candidates, paint, atlas: options.atlas,
        transient: options.transient === true, ready: candidates.length === 0, failed: false, recoverable: false,
        refs: 0, touched: 0, generation: 0, cancel: null,
      }
      this.entries.set(key, entry)
      paint()
      this.load(entry)
    }
    entry.refs++
    entry.touched = ++this.clock
    const owned = entry
    let released = false
    return {
      texture: entry.texture,
      get ready(): boolean { return owned.ready },
      get failed(): boolean { return owned.failed },
      release: (): void => {
        if (released || this.disposed) return
        released = true
        owned.refs--
        owned.touched = ++this.clock
        if (owned.refs === 0 && owned.transient) this.remove(owned)
        this.trim()
      },
    }
  }

  private load(entry: TextureEntry): void {
    entry.cancel?.()
    const generation = ++entry.generation
    entry.failed = false
    const live = (): boolean => !this.disposed && this.entries.get(entry.key) === entry
      && entry.generation === generation
    if (entry.atlas) {
      const url = entry.atlas.atlasUrl
      if (failedUrls.has(url) || failedUrls.has(entry.atlas.textureUrl)) {
        this.failed(entry)
        return
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => {
        if (!live()) return
        controller.abort()
        rememberFailure(url)
        entry.generation++
        entry.cancel = null
        this.failed(entry)
      }, 15000)
      entry.cancel = (): void => {
        clearTimeout(timeout)
        controller.abort()
        entry.cancel = null
      }
      void atlasMetadata(url, controller.signal).then((frame) => {
        if (!live()) return
        clearTimeout(timeout)
        entry.cancel = null
        this.loadImages(entry, generation, frame)
      }).catch(() => {
        if (!live()) return
        clearTimeout(timeout)
        controller.abort()
        entry.cancel = null
        rememberFailure(url)
        this.failed(entry)
      })
      return
    }
    this.loadImages(entry, generation)
  }

  private failed(entry: TextureEntry): void {
    entry.failed = true
    this.invalidate()
  }

  private loadImages(entry: TextureEntry, generation: number, frame?: AmbienceFrame): void {
    let candidate = 0
    let attempt = 0
    const live = (): boolean => !this.disposed && this.entries.get(entry.key) === entry
      && entry.generation === generation
    const next = (): void => {
      if (!live()) return
      while (candidate < entry.candidates.length && failedUrls.has(entry.candidates[candidate])) candidate++
      const url = entry.candidates[candidate++]
      if (!url) {
        if (!entry.ready) this.failed(entry)
        return
      }
      const token = ++attempt
      const requestLive = (): boolean => live() && token === attempt
      const image = new Image()
      let timeout: ReturnType<typeof setTimeout> | undefined
      const detach = (): void => {
        image.onload = null
        image.onerror = null
        clearTimeout(timeout)
        entry.cancel = null
      }
      entry.cancel = (): void => {
        detach()
        image.removeAttribute('src')
      }
      const fail = (): void => {
        if (!requestLive()) return
        detach()
        image.removeAttribute('src')
        attempt++
        rememberFailure(url)
        next()
      }
      image.onload = (): void => {
        if (!requestLive()) return
        detach()
        if (!Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0
          || (frame && (image.width !== frame.atlasWidth || image.height !== frame.atlasHeight))) {
          fail()
          return
        }
        try {
          entry.paint(image, frame)
        } catch {
          entry.paint()
          fail()
          return
        }
        entry.ready = true
        entry.failed = false
        entry.recoverable = url !== entry.candidates[0]
        attempt++
        this.invalidate()
      }
      image.onerror = fail
      timeout = setTimeout(fail, 15000)
      image.src = url
    }
    next()
  }

  private trim(): void {
    const idle = [...this.entries.values()].filter((entry) => entry.refs === 0)
      .sort((a, b) => a.touched - b.touched)
    for (const entry of idle.slice(0, Math.max(0, idle.length - this.idleLimit))) this.remove(entry)
  }

  private remove(entry: TextureEntry): void {
    entry.generation++
    entry.cancel?.()
    entry.texture.dispose()
    entry.canvas.width = 1
    entry.canvas.height = 1
    this.entries.delete(entry.key)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    window.removeEventListener('online', this.onOnline)
    for (const entry of this.entries.values()) this.remove(entry)
  }
}
