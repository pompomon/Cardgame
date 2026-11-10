import { clamp } from '../shared/math'
import type { TextureLease } from './assets'
import type { LayerRect } from './layout'

/** The WebGL card body colour, which shows as a 1px edge around the face. */
const CARD_EDGE = '#ebd9b9'
const MAX_PIXEL_RATIO = 3
/** The same slight clockwise tilt as the in-scene drag proxy. */
const CARD_TILT_RAD = 0.025

/**
 * The HTML overlay for an active drag. It draws the lifted card above the
 * board's HTML headers and labels the landing slot. It lives inside the board
 * stage, so it scrolls with the board and shares its pixel coordinates. Each
 * drag owns at most one face-texture lease, released on every end path. A
 * move only changes a CSS transform; it never reads layout.
 */
export class ThreeDragLayer {
  readonly element = document.createElement('div')
  private readonly card = document.createElement('canvas')
  private readonly landing = document.createElement('span')
  private readonly context: CanvasRenderingContext2D | null
  private lease: TextureLease | null = null
  private width = 0
  private height = 0
  private ratio = 1
  /** The card was drawn from a loaded texture, so it never needs repainting. */
  private paintedReady = false
  private disposed = false

  constructor() {
    this.element.className = 'three-drag-layer'
    this.element.setAttribute('aria-hidden', 'true')
    this.element.hidden = true
    this.landing.className = 'three-drag-landing'
    this.landing.hidden = true
    this.card.className = 'three-drag-card'
    this.card.hidden = true
    // The card follows the landing label so it draws above it.
    this.element.append(this.landing, this.card)
    let context: CanvasRenderingContext2D | null = null
    try {
      context = this.card.getContext('2d')
    } catch {
      context = null
    }
    this.context = typeof context?.drawImage === 'function' ? context : null
  }

  /** Whether the layer can draw the lifted card. The landing label never needs a 2D context. */
  get drawsCards(): boolean {
    return this.context !== null && !this.disposed
  }

  /**
   * Prepares the card at `width`×`height` layer pixels; it appears on the
   * first `move`. The layer owns `lease` from here on. When drawing is
   * unavailable or fails, the lease is released at once and this returns
   * false, so the caller keeps its in-scene proxy.
   */
  begin(lease: TextureLease, width: number, height: number, devicePixelRatio = 1): boolean {
    this.endCard()
    const sized = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    if (!this.drawsCards || !sized) {
      lease.release()
      return false
    }
    this.lease = lease
    this.width = width
    this.height = height
    this.ratio = clamp(Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1, 1, MAX_PIXEL_RATIO)
    this.card.width = Math.max(1, Math.round(width * this.ratio))
    this.card.height = Math.max(1, Math.round(height * this.ratio))
    this.card.style.width = `${width}px`
    this.card.style.height = `${height}px`
    if (!this.paint()) {
      this.endCard()
      return false
    }
    return true
  }

  /**
   * Centres the card on (`x`, `y`) layer pixels at `scale`. Returns false when
   * the layer is not drawing a card, including after a failed repaint, so the
   * caller can show its in-scene proxy instead.
   */
  move(x: number, y: number, scale: number): boolean {
    const lease = this.lease
    if (!lease || this.disposed) return false
    // Artwork that finishes loading mid-drag replaces the fallback face once.
    if (!this.paintedReady && lease.ready !== false && !this.paint()) {
      this.endCard()
      this.sync()
      return false
    }
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const size = Number.isFinite(scale) && scale > 0 ? scale : 1
      this.card.style.transform = `translate(${x - this.width / 2}px, ${y - this.height / 2}px) `
        + `rotate(${CARD_TILT_RAD}rad) scale(${size})`
      this.card.hidden = false
      this.sync()
    }
    return true
  }

  /** Labels the landing slot, given in layer pixels, or hides the label for null. */
  setLanding(rect: LayerRect | null, text = ''): void {
    if (this.disposed) return
    if (rect && text) {
      if (this.landing.textContent !== text) this.landing.textContent = text
      this.landing.style.left = `${rect.left + rect.width / 2}px`
      this.landing.style.top = `${rect.top + rect.height / 2}px`
      this.landing.style.maxWidth = `${Math.max(1, rect.width)}px`
      this.landing.hidden = false
    } else {
      this.landing.hidden = true
    }
    this.sync()
  }

  /** Marks whether releasing now would summon; styled with a ring only. */
  setAccepted(accepted: boolean): void {
    if (this.disposed) return
    const value = String(accepted)
    if (this.element.dataset.accepted !== value) this.element.dataset.accepted = value
  }

  /** Hides the layer and releases the card's lease. Safe to call repeatedly. */
  end(): void {
    this.endCard()
    this.landing.hidden = true
    delete this.element.dataset.accepted
    this.sync()
  }

  dispose(): void {
    if (this.disposed) return
    this.end()
    this.disposed = true
    this.element.remove()
  }

  private endCard(): void {
    const lease = this.lease
    this.lease = null
    this.paintedReady = false
    this.card.hidden = true
    lease?.release()
  }

  private sync(): void {
    const hidden = this.card.hidden && this.landing.hidden
    if (this.element.hidden !== hidden) this.element.hidden = hidden
  }

  private paint(): boolean {
    const context = this.context
    const lease = this.lease
    if (!context || !lease) return false
    try {
      const { width, height } = this.card
      const inset = this.ratio
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, width, height)
      context.fillStyle = CARD_EDGE
      context.fillRect(0, 0, width, height)
      context.drawImage(lease.texture.image, inset, inset, Math.max(1, width - 2 * inset), Math.max(1, height - 2 * inset))
    } catch {
      return false
    }
    this.paintedReady = lease.ready !== false
    return true
  }
}
