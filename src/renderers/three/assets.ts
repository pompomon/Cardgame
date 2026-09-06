import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three'
import { boardBackgroundAssetLocation, type BoardBackgroundVariant } from '../../app/board-assets'
import type { BoardTheme } from '../../app/board-theme'
import { cardBackUrl } from '../../app/card-art'
import { cardArtSourceFor, cardVisualPaletteFor, landPixelRects } from '../../app/card-visuals'
import type { CardVisualStyle } from '../../app/card-visual-styles'
import { HIDDEN_HAND_CARD_NAME } from '../../app/types'
import { isBasicLand } from '../../game/types'

const FAILED_URL_LIMIT = 128
const failedUrls = new Set<string>()

export interface TextureLease {
  readonly texture: CanvasTexture
  release(): void
}

interface TextureEntry {
  readonly key: string
  readonly texture: CanvasTexture
  readonly canvas: HTMLCanvasElement
  readonly context: CanvasRenderingContext2D
  readonly candidates: readonly string[]
  readonly paint: (image?: HTMLImageElement) => void
  refs: number
  touched: number
  generation: number
  cancel: (() => void) | null
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
      if (entry.refs > 0) this.load(entry)
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
          ctx.drawImage(image, 20, 20, 472, 664)
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
      if (image) ctx.drawImage(image, 24, 24, 464, 464)
      else if (palette && isBasicLand(safeName)) {
        for (const pixel of landPixelRects(safeName, 464)) {
          ctx.fillStyle = pixel.tone === 'primary' ? palette.iconPrimary : palette.iconSecondary
          ctx.fillRect(24 + pixel.x, 24 + pixel.y, pixel.size, pixel.size)
        }
      }
      ctx.fillStyle = '#08121e'
      ctx.fillRect(20, 508, 472, 174)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 72px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(safeName, 256, 586, 458)
      ctx.fillStyle = palette?.cardText ?? '#dce6f3'
      ctx.font = '32px system-ui, sans-serif'
      ctx.fillText('BASIC LAND', 256, 643, 440)
    })
  }

  acquireBoard(theme: BoardTheme, variant: BoardBackgroundVariant): TextureLease {
    return this.acquire(`board:${theme}:${variant}`, 1536, 1024, boardAssetCandidates(theme, variant), (ctx, image) => {
      const gradient = ctx.createRadialGradient(768, 400, 20, 768, 512, 1000)
      gradient.addColorStop(0, theme === 'verdant' ? '#244e3d' : theme === 'moonlit' ? '#303657' : '#284546')
      gradient.addColorStop(1, '#080f1d')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, 1536, 1024)
      if (image) {
        const scale = Math.max(1536 / image.width, 1024 / image.height)
        const width = image.width * scale
        const height = image.height * scale
        ctx.drawImage(image, (1536 - width) / 2, (1024 - height) / 2, width, height)
      }
    })
  }

  get size(): number {
    return this.entries.size
  }

  private acquire(
    key: string,
    width: number,
    height: number,
    candidates: readonly string[],
    draw: (context: CanvasRenderingContext2D, image?: HTMLImageElement) => void,
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
      texture.minFilter = LinearFilter
      texture.magFilter = LinearFilter
      texture.generateMipmaps = false
      const paint = (image?: HTMLImageElement): void => {
        draw(context, image)
        texture.needsUpdate = true
      }
      entry = { key, texture, canvas, context, candidates, paint, refs: 0, touched: 0, generation: 0, cancel: null }
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
      release: (): void => {
        if (released || this.disposed) return
        released = true
        owned.refs--
        owned.touched = ++this.clock
        this.trim()
      },
    }
  }

  private load(entry: TextureEntry): void {
    entry.cancel?.()
    const generation = ++entry.generation
    let candidate = 0
    let attempt = 0
    const live = (): boolean => !this.disposed && this.entries.get(entry.key) === entry
      && entry.generation === generation
    const next = (): void => {
      if (!live()) return
      while (candidate < entry.candidates.length && failedUrls.has(entry.candidates[candidate])) candidate++
      const url = entry.candidates[candidate++]
      if (!url) return
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
        attempt++
        rememberFailure(url)
        next()
      }
      image.onload = (): void => {
        if (!requestLive()) return
        detach()
        if (!image.width || !image.height) {
          fail()
          return
        }
        try {
          entry.paint(image)
          this.invalidate()
          attempt++
        } catch {
          fail()
        }
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
