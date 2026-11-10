import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasTexture } from 'three'
import type { TextureLease } from '../renderers/three/assets'
import { ThreeDragLayer } from '../renderers/three/drag-layer'

interface Context2d {
  fillStyle: string
  setTransform: ReturnType<typeof vi.fn>
  clearRect: ReturnType<typeof vi.fn>
  fillRect: ReturnType<typeof vi.fn>
  drawImage: ReturnType<typeof vi.fn>
}

let nextContext: (() => unknown) = () => null

class NodeStub {
  hidden = false
  className = ''
  textContent = ''
  width = 300
  height = 150
  readonly style: Record<string, string> = {}
  readonly dataset: Record<string, string> = {}
  readonly children: NodeStub[] = []
  private readonly attributes = new Map<string, string>()
  parent: NodeStub | null = null
  readonly tagName: string

  constructor(tagName: string) {
    this.tagName = tagName
  }

  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  append(...nodes: NodeStub[]): void {
    for (const node of nodes) {
      node.parent = this
      this.children.push(node)
    }
  }
  remove(): void {
    if (!this.parent) return
    this.parent.children.splice(this.parent.children.indexOf(this), 1)
    this.parent = null
  }
  getContext(type: string): unknown {
    return type === '2d' ? nextContext() : null
  }
}

function context(): Context2d {
  return { fillStyle: '', setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn() }
}

function lease(ready?: boolean) {
  const state = { ready }
  const image = { name: 'face-canvas' }
  const release = vi.fn()
  const value: TextureLease = {
    texture: { image } as unknown as CanvasTexture,
    get ready() { return state.ready },
    release,
  }
  return { lease: value, state, image, release }
}

function parts(layer: ThreeDragLayer) {
  const element = layer.element as unknown as NodeStub
  const [landing, card, ring] = element.children
  return { element, landing, card, ring }
}

let ctx: Context2d

beforeEach(() => {
  ctx = context()
  nextContext = () => ctx
  vi.stubGlobal('document', { createElement: (tag: string) => new NodeStub(tag) })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Three.js drag layer', () => {
  it('builds one hidden, inert overlay with a landing label beneath the card', () => {
    const layer = new ThreeDragLayer()
    const { element, landing, card } = parts(layer)
    expect(element.className).toBe('three-drag-layer')
    expect(element.getAttribute('aria-hidden')).toBe('true')
    expect(element.hidden).toBe(true)
    expect(landing.className).toBe('three-drag-landing')
    expect(card.className).toBe('three-drag-card')
    expect(card.tagName).toBe('canvas')
    expect(layer.drawsCards).toBe(true)
  })

  it('draws the face once at the device pixel ratio and shows it on the first move', () => {
    const layer = new ThreeDragLayer()
    const { element, card } = parts(layer)
    const { lease: owned, image, release } = lease(true)
    expect(layer.begin(owned, 80, 110, 2)).toBe(true)
    expect(card.width).toBe(160)
    expect(card.height).toBe(220)
    expect(card.style.width).toBe('80px')
    expect(card.style.height).toBe('110px')
    expect(ctx.setTransform).toHaveBeenCalledExactlyOnceWith(1, 0, 0, 1, 0, 0)
    expect(ctx.clearRect).toHaveBeenCalledExactlyOnceWith(0, 0, 160, 220)
    expect(ctx.fillRect).toHaveBeenCalledExactlyOnceWith(0, 0, 160, 220)
    expect(ctx.fillStyle).toBe('#ebd9b9')
    // The face is inset by one CSS pixel, like the in-scene card body.
    expect(ctx.drawImage).toHaveBeenCalledExactlyOnceWith(image, 2, 2, 156, 216)
    // Nothing shows until the card has a position.
    expect(card.hidden).toBe(true)
    expect(element.hidden).toBe(true)
    expect(layer.move(200, 300, 0.9)).toBe(true)
    expect(card.hidden).toBe(false)
    expect(element.hidden).toBe(false)
    expect(card.style.transform).toBe('translate(160px, 245px) rotate(0.025rad) scale(0.9)')
    layer.move(10, 20, 1.08)
    expect(card.style.transform).toBe('translate(-30px, -35px) rotate(0.025rad) scale(1.08)')
    expect(ctx.drawImage).toHaveBeenCalledOnce()
    expect(release).not.toHaveBeenCalled()
  })

  it('keeps the last position for non-finite moves and ignores invalid scales', () => {
    const layer = new ThreeDragLayer()
    const { card } = parts(layer)
    layer.begin(lease().lease, 80, 110)
    layer.move(40, 55, 0.9)
    const placed = card.style.transform
    expect(layer.move(Number.NaN, 10, 1)).toBe(true)
    expect(layer.move(10, Number.POSITIVE_INFINITY, 1)).toBe(true)
    expect(card.style.transform).toBe(placed)
    layer.move(40, 55, Number.NaN)
    expect(card.style.transform).toBe('translate(0px, 0px) rotate(0.025rad) scale(1)')
    layer.move(40, 55, -2)
    expect(card.style.transform).toBe('translate(0px, 0px) rotate(0.025rad) scale(1)')
  })

  it.each([[0.5, 1], [1, 1], [2.625, 2.625], [3, 3], [5, 3], [Number.NaN, 1], [Number.POSITIVE_INFINITY, 1]])(
    'clamps a %s device pixel ratio to %s',
    (ratio, expected) => {
      const layer = new ThreeDragLayer()
      const { card } = parts(layer)
      layer.begin(lease().lease, 80, 110, ratio)
      expect(card.width).toBe(Math.round(80 * expected))
      expect(card.height).toBe(Math.round(110 * expected))
      expect(card.style.width).toBe('80px')
    },
  )

  it('repaints exactly once when the artwork finishes loading mid-drag', () => {
    const layer = new ThreeDragLayer()
    const loading = lease(false)
    layer.begin(loading.lease, 80, 110)
    layer.move(100, 100, 0.9)
    layer.move(110, 100, 0.9)
    expect(ctx.drawImage).toHaveBeenCalledOnce()
    loading.state.ready = true
    layer.move(120, 100, 0.9)
    expect(ctx.drawImage).toHaveBeenCalledTimes(2)
    layer.move(130, 100, 0.9)
    expect(ctx.drawImage).toHaveBeenCalledTimes(2)
    // A lease without a ready flag is treated as loaded.
    const unknown = lease(undefined)
    layer.begin(unknown.lease, 80, 110)
    layer.move(100, 100, 0.9)
    expect(ctx.drawImage).toHaveBeenCalledTimes(3)
    expect(loading.release).toHaveBeenCalledOnce()
  })

  it('releases each lease exactly once on end, a new drag, and disposal', () => {
    const layer = new ThreeDragLayer()
    const { element } = parts(layer)
    const first = lease(true)
    layer.begin(first.lease, 80, 110)
    layer.move(1, 1, 1)
    layer.end()
    layer.end()
    expect(first.release).toHaveBeenCalledOnce()
    expect(element.hidden).toBe(true)
    expect(layer.move(5, 5, 1)).toBe(false)
    const second = lease(true)
    const third = lease(true)
    layer.begin(second.lease, 80, 110)
    layer.begin(third.lease, 80, 110)
    expect(second.release).toHaveBeenCalledOnce()
    expect(third.release).not.toHaveBeenCalled()
    const host = new NodeStub('div')
    host.append(element)
    layer.dispose()
    layer.dispose()
    expect(third.release).toHaveBeenCalledOnce()
    expect(host.children).toEqual([])
    expect(layer.drawsCards).toBe(false)
    // A disposed layer refuses new work and releases what it is handed.
    const late = lease(true)
    expect(layer.begin(late.lease, 80, 110)).toBe(false)
    expect(late.release).toHaveBeenCalledOnce()
    layer.setLanding({ left: 0, top: 0, width: 50, height: 70 }, '+1')
    expect(element.hidden).toBe(true)
  })

  it.each([
    ['getContext returns null', () => null],
    ['getContext returns a WebGL-like context', () => ({ isContextLost: () => false })],
    ['getContext throws', () => { throw new Error('blocked') }],
  ])('releases the lease and keeps the in-scene proxy when %s', (_, create) => {
    nextContext = create
    const layer = new ThreeDragLayer()
    expect(layer.drawsCards).toBe(false)
    const { lease: owned, release } = lease(true)
    expect(layer.begin(owned, 80, 110)).toBe(false)
    expect(release).toHaveBeenCalledOnce()
    expect(layer.move(10, 10, 1)).toBe(false)
    // The landing label still works without a 2D context.
    layer.setLanding({ left: 10, top: 20, width: 60, height: 80 }, 'Lands here')
    expect(parts(layer).element.hidden).toBe(false)
  })

  it.each([[0, 110], [80, 0], [-80, 110], [Number.NaN, 110], [80, Number.POSITIVE_INFINITY]])(
    'refuses a %sx%s card and releases its lease',
    (width, height) => {
      const layer = new ThreeDragLayer()
      const { lease: owned, release } = lease(true)
      expect(layer.begin(owned, width, height)).toBe(false)
      expect(release).toHaveBeenCalledOnce()
      expect(ctx.drawImage).not.toHaveBeenCalled()
    },
  )

  it('falls back when drawing fails at the start or on a mid-drag repaint', () => {
    const layer = new ThreeDragLayer()
    const { element, card } = parts(layer)
    ctx.drawImage.mockImplementationOnce(() => { throw new Error('tainted') })
    const failed = lease(true)
    expect(layer.begin(failed.lease, 80, 110)).toBe(false)
    expect(failed.release).toHaveBeenCalledOnce()
    const loading = lease(false)
    expect(layer.begin(loading.lease, 80, 110)).toBe(true)
    layer.move(50, 60, 0.9)
    layer.setLanding({ left: 0, top: 0, width: 56, height: 78 }, '+1')
    loading.state.ready = true
    ctx.drawImage.mockImplementationOnce(() => { throw new Error('lost') })
    expect(layer.move(55, 60, 0.9)).toBe(false)
    expect(loading.release).toHaveBeenCalledOnce()
    expect(card.hidden).toBe(true)
    // The landing label outlives the card.
    expect(element.hidden).toBe(false)
    layer.end()
    expect(element.hidden).toBe(true)
    expect(loading.release).toHaveBeenCalledOnce()
  })

  it('centres the landing label on its slot and writes text only when it changes', () => {
    const layer = new ThreeDragLayer()
    const { element, landing } = parts(layer)
    layer.setLanding({ left: 100, top: 40, width: 56, height: 78 }, 'Lands here')
    expect(landing.hidden).toBe(false)
    expect(element.hidden).toBe(false)
    expect(landing.textContent).toBe('Lands here')
    expect(landing.style).toMatchObject({ left: '128px', top: '79px', maxWidth: '56px' })
    let writes = 0
    let text = landing.textContent
    Object.defineProperty(landing, 'textContent', {
      get: () => text,
      set: (value: string) => { writes++; text = value },
    })
    layer.setLanding({ left: 120, top: 40, width: 56, height: 78 }, 'Lands here')
    expect(writes).toBe(0)
    layer.setLanding({ left: 120, top: 40, width: 56, height: 78 }, '+1')
    expect(writes).toBe(1)
    layer.setLanding(null)
    expect(landing.hidden).toBe(true)
    expect(element.hidden).toBe(true)
    layer.setLanding({ left: 0, top: 0, width: 56, height: 78 }, '')
    expect(landing.hidden).toBe(true)
  })

  it('marks the accepted state for styling and clears it when the drag ends', () => {
    const layer = new ThreeDragLayer()
    const { element } = parts(layer)
    layer.setAccepted(false)
    expect(element.dataset.accepted).toBe('false')
    layer.setAccepted(true)
    expect(element.dataset.accepted).toBe('true')
    layer.end()
    expect(element.dataset).not.toHaveProperty('accepted')
  })

  it('centres the long-press ring on the finger and hides it with the layer', () => {
    const layer = new ThreeDragLayer()
    const { element, ring } = parts(layer)
    expect(ring.className).toBe('three-peek-ring')
    expect(ring.hidden).toBe(true)
    layer.setRing({ x: 140, y: 610 })
    expect(ring.hidden).toBe(false)
    expect(element.hidden).toBe(false)
    expect(ring.style).toMatchObject({ left: '140px', top: '610px' })
    layer.setRing({ x: Number.NaN, y: 10 })
    expect(ring.hidden).toBe(true)
    expect(element.hidden).toBe(true)
    layer.setRing({ x: 1, y: 2 })
    layer.end()
    expect([ring.hidden, element.hidden]).toEqual([true, true])
    layer.setRing({ x: 1, y: 2 })
    layer.setLanding({ left: 0, top: 0, width: 56, height: 78 }, 'Lands here')
    layer.setRing(null)
    expect(element.hidden).toBe(false)
    layer.dispose()
    layer.setRing({ x: 1, y: 2 })
    expect(ring.hidden).toBe(true)
  })
})
