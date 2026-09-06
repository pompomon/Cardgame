import {
  BoxGeometry, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, OrthographicCamera, PlaneGeometry, Scene, SRGBColorSpace, WebGLRenderer,
} from 'three'
import { DEFAULT_BOARD_THEME } from '../../app/board-theme'
import { DEFAULT_CARD_VISUAL_STYLE } from '../../app/card-visual-styles'
import { HIDDEN_HAND_CARD_NAME, type AppViewModel } from '../../app/types'
import type { VisualEffectDescriptor } from '../../app/visual-effects'
import { ThreeAssets, type TextureLease } from './assets'
import { boardCardKey, ThreeCardRegistry, type CardAnchor, type CardDescriptor, type RetainedCard } from './card-registry'
import type { BoardHit, ThreeBoardApi } from './contracts'
import { EffectGeometry, EffectVisual, effectRecipe } from './effect-visual'
import { boardLayout, cardSlotX, clientToBoard, pageWindow, pointInRect, type BoardRow, type ThreeLayout } from './layout'
import { threeQualityProfile, type ThreeQualityProfile } from './quality'
import './graphics.css'

interface RowChrome {
  readonly label: HTMLParagraphElement
  readonly controls: HTMLDivElement
  readonly previous: HTMLButtonElement
  readonly next: HTMLButtonElement
  readonly count: HTMLSpanElement
  readonly dispose: () => void
}

interface DragVisual {
  readonly source: RetainedCard
  readonly proxy: RetainedCard
  returning: boolean
  elapsed: number
  fromX: number
  fromY: number
}

const ROWS: readonly BoardRow[] = ['far', 'near', 'hand']

export class ThreeBoard implements ThreeBoardApi {
  readonly canvas: HTMLCanvasElement
  private readonly host: HTMLElement
  private readonly stage = document.createElement('div')
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 3000)
  private readonly plane = new PlaneGeometry(1, 1)
  private readonly box = new BoxGeometry(1, 1, 1)
  private readonly tableMaterial = new MeshStandardMaterial({ color: '#574634', roughness: 0.8 })
  private readonly backgroundMaterial = new MeshBasicMaterial()
  private readonly dropMaterial = new MeshBasicMaterial({ color: '#70e7b1', opacity: 0.05, transparent: true, depthWrite: false })
  private readonly table = new Mesh(this.box, this.tableMaterial)
  private readonly background = new Mesh(this.plane, this.backgroundMaterial)
  private readonly drop = new Mesh(this.plane, this.dropMaterial)
  private readonly effectGeometry = new EffectGeometry()
  private readonly effects = new Set<EffectVisual>()
  private readonly chrome = new Map<BoardRow, RowChrome>()
  private readonly instruction = document.createElement('p')
  private readonly pages: Record<BoardRow, number> = { far: 0, near: 0, hand: 0 }
  private readonly point = { x: 0, y: 0 }
  private readonly onFailure: (message: string) => void
  private readonly onResize: () => void
  private renderer: WebGLRenderer | null = null
  private assets: ThreeAssets | null = null
  private cards: ThreeCardRegistry | null = null
  private backgroundLease: TextureLease | null = null
  private backgroundKey = ''
  private observer: ResizeObserver | null = null
  private motionQuery: MediaQueryList | null = null
  private layout: ThreeLayout = boardLayout(1000, 750)
  private quality: ThreeQualityProfile = threeQualityProfile({ preference: 'auto', width: 1000, height: 750 })
  private view: AppViewModel | null = null
  private actor = 0
  private targetIds: ReadonlySet<string> = new Set()
  private visible = true
  private disposed = false
  private failed = false
  private frame: number | null = null
  private lastFrame: number | null = null
  private drag: DragVisual | null = null
  private canDrop = false

  constructor(host: HTMLElement, onFailure: (message: string) => void, onResize: () => void) {
    this.host = host
    this.onFailure = onFailure
    this.onResize = onResize
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'three-board-canvas'
    this.canvas.setAttribute('aria-label', 'Cardgame tabletop. Use the adjacent card controls for keyboard play.')
    this.stage.className = 'three-board-stage'
    this.stage.append(this.canvas)
    try {
      const context = this.canvas.getContext('webgl2', { alpha: false, antialias: true, powerPreference: 'low-power' })
      if (!context || context.isContextLost()) throw new Error('WebGL2 is unavailable')
      this.renderer = new WebGLRenderer({ canvas: this.canvas, context, antialias: true, alpha: false })
      this.renderer.outputColorSpace = SRGBColorSpace
      this.renderer.setClearColor('#09121d')
      this.assets = new ThreeAssets(this.invalidate)
      this.cards = new ThreeCardRegistry(this.assets)
      this.scene.add(this.table, this.background, this.drop, this.cards.layer)
      this.scene.add(new HemisphereLight('#e9f5ff', '#493a29', 2))
      const light = new DirectionalLight('#fff5dc', 2.5)
      light.position.set(-200, 300, 800)
      this.scene.add(light)
      this.table.position.z = -14
      this.background.position.z = -0.1
      this.drop.position.z = 0.1
      this.camera.position.set(0, 0, 1200)
      this.camera.lookAt(0, 0, 0)
      for (const row of ROWS) this.createChrome(row)
      this.instruction.className = 'three-board-instruction'
      this.instruction.hidden = true
      this.stage.append(this.instruction)
      host.append(this.stage)
      this.canvas.addEventListener('webglcontextlost', this.contextLost)
      window.addEventListener('resize', this.resize)
      window.addEventListener('orientationchange', this.resize)
      window.visualViewport?.addEventListener('resize', this.resize)
      document.addEventListener('visibilitychange', this.visibilityChanged)
      if (typeof window.matchMedia === 'function') {
        this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
        if (this.motionQuery.addEventListener) this.motionQuery.addEventListener('change', this.motionChanged)
        else this.motionQuery.addListener(this.motionChanged)
      }
      if (typeof ResizeObserver !== 'undefined') {
        this.observer = new ResizeObserver(this.resize)
        this.observer.observe(this.stage)
      }
      this.applySize()
      this.setBackground(DEFAULT_BOARD_THEME)
      // Compile/render once here so shader/driver failures take the safe startup path.
      this.renderer.render(this.scene, this.camera)
    } catch (error) {
      this.dispose()
      throw error instanceof Error ? error : new Error('Three.js could not start')
    }
  }

  render(view: AppViewModel, presentedActor: number, targetIds: ReadonlySet<string>): void {
    if (this.disposed || this.failed) return
    const previous = this.view
    const boundary = previous && (previous.seed !== view.seed || previous.mode !== view.mode
      || previous.replay.active !== view.replay.active
      || (view.replay.active && view.replay.step < previous.replay.step)
      || (previous.game && (!view.game || view.game.events.length < previous.game.events.length)))
    if (this.actor !== presentedActor || boundary) {
      this.endDrag(false)
      for (const row of ROWS) this.pages[row] = 0
    }
    if (boundary) {
      for (const effect of this.effects) effect.cancel()
      this.cards?.clear()
    }
    this.view = view
    this.actor = presentedActor === 1 ? 1 : 0
    this.targetIds = new Set(targetIds)
    this.updateQuality()
    this.setBackground(view.boardTheme ?? DEFAULT_BOARD_THEME)
    this.present()
    this.invalidate()
  }

  private present(): void {
    const game = this.view?.game
    if (!game) {
      this.canDrop = false
      this.cards?.reconcile([])
      this.instruction.hidden = true
      for (const chrome of this.chrome.values()) chrome.controls.hidden = true
      return
    }
    const descriptors: CardDescriptor[] = []
    const style = this.view?.cardVisualStyle ?? DEFAULT_CARD_VISUAL_STYLE
    const input = game.canInput && game.actor === this.actor
    this.canDrop = input && Object.values(game.legal.playLandByCard).some((options) => options.length > 0)
    for (const row of ROWS) {
      const owner = row === 'far' ? 1 - this.actor : this.actor
      const player = game.players[owner]
      const entries = row === 'hand' ? player.handCards : player.battlefield
      const page = pageWindow(entries.length, this.pages[row], this.layout.capacity)
      this.pages[row] = page.page
      const chrome = this.chrome.get(row)!
      const label = row === 'hand' ? `Player ${owner + 1} · hand` : `Player ${owner + 1} · battlefield`
      chrome.label.textContent = `${label}${game.actor === owner ? ' · ACTIVE' : ''}`
      chrome.label.dataset.active = String(game.actor === owner)
      chrome.controls.hidden = false
      chrome.previous.disabled = page.page === 0 || this.drag !== null
      chrome.next.disabled = page.page === page.pages - 1 || this.drag !== null
      chrome.count.textContent = page.count === 0 ? '0 cards' : `${page.start + 1}–${page.end} of ${page.count}`
      chrome.previous.setAttribute('aria-label', `Previous ${label} page`)
      chrome.next.setAttribute('aria-label', `Next ${label} page`)
      for (let index = 0; index < entries.length; index++) {
        const card = entries[index]
        const instanceId = 'instanceId' in card ? card.instanceId : undefined
        const cardId = 'cardId' in card ? card.cardId : card.id
        const visible = index >= page.start && index < page.end
        const hit: BoardHit = {
          key: boardCardKey(cardId, owner, instanceId),
          cardId, instanceId, name: card.name, owner, zone: row === 'hand' ? 'hand' : 'battlefield',
          playable: row === 'hand' && input && card.name !== HIDDEN_HAND_CARD_NAME
            && (game.legal.playLandByCard[cardId]?.length ?? 0) > 0,
        }
        descriptors.push({
          hit, style, visible,
          x: visible ? cardSlotX(index - page.start, page.end - page.start, this.layout) : 0,
          y: this.layout.rows[row].y,
          width: this.layout.cardWidth, height: this.layout.cardHeight,
          target: this.targetIds.has(instanceId ?? cardId) || this.targetIds.has(cardId),
          shadows: this.quality.shadows,
        })
      }
    }
    if (this.drag && !this.drag.returning) {
      const desired = descriptors.find((descriptor) => descriptor.hit.key === this.drag?.source.descriptor.hit.key)
      if (!desired?.hit.playable || !desired.visible) this.endDrag(false)
    }
    this.cards?.reconcile(descriptors)
    if (this.drag) this.drag.source.setOpacity(0.35)
    this.dropMaterial.opacity = this.canDrop ? 0.05 : 0.015
    this.instruction.hidden = !this.canDrop
    this.instruction.textContent = 'Drag a highlighted card into your battlefield'
  }

  hitTest(clientX: number, clientY: number): BoardHit | null {
    if (!this.usable() || !clientToBoard(clientX, clientY, this.canvas.getBoundingClientRect(), this.layout, this.point)) return null
    return this.cards?.hitTest(this.point) ?? null
  }

  containsDrop(clientX: number, clientY: number): boolean {
    return this.usable() && this.canDrop
      && clientToBoard(clientX, clientY, this.canvas.getBoundingClientRect(), this.layout, this.point)
      && pointInRect(this.point, this.layout.drop)
  }

  beginDrag(hit: BoardHit): void {
    if (!this.usable()) return
    this.endDrag(false)
    const source = this.cards?.get(hit.key)
    if (!source?.descriptor.hit.playable || !source.descriptor.visible) return
    const proxy = this.cards!.createProxy(source)
    proxy.group.rotation.set(-0.06, 0.08, -0.025)
    source.setOpacity(0.35)
    this.drag = { source, proxy, returning: false, elapsed: 0, fromX: 0, fromY: 0 }
    for (const chrome of this.chrome.values()) {
      chrome.previous.disabled = true
      chrome.next.disabled = true
    }
    this.invalidate()
  }

  moveDrag(clientX: number, clientY: number, touch: boolean): void {
    if (!this.drag || this.drag.returning || !this.usable()) return
    const rect = this.canvas.getBoundingClientRect()
    const inside = clientToBoard(clientX, clientY, rect, this.layout, this.point)
    this.drag.proxy.group.position.x = this.point.x
    this.drag.proxy.group.position.y = this.point.y + (touch ? 44 * this.layout.height / Math.max(1, rect.height) : 0)
    const allowed = inside && this.canDrop && pointInRect(this.point, this.layout.drop)
    this.dropMaterial.color.set(allowed ? '#94ffc9' : '#f6d78d')
    this.dropMaterial.opacity = allowed ? 0.2 : 0.08
    this.instruction.textContent = allowed ? 'Release to play' : 'Move into your battlefield · release elsewhere to cancel'
    this.invalidate()
  }

  endDrag(animateReturn: boolean): void {
    const drag = this.drag
    if (!drag) return
    drag.source.setOpacity(1)
    if (animateReturn && this.quality.motion && this.usable() && !drag.returning) {
      drag.returning = true
      drag.elapsed = 0
      drag.fromX = drag.proxy.group.position.x
      drag.fromY = drag.proxy.group.position.y
    } else {
      drag.proxy.dispose()
      this.drag = null
    }
    this.dropMaterial.color.set('#70e7b1')
    this.dropMaterial.opacity = this.canDrop ? 0.05 : 0.015
    this.instruction.textContent = 'Drag a highlighted card into your battlefield'
    this.updatePageButtons()
    this.invalidate()
  }

  playEffect(effect: VisualEffectDescriptor, duration: number, done: () => void): () => void {
    if (!this.usable() || !this.quality.motion || !Number.isFinite(duration) || duration <= 0 || !effectRecipe(effect.kind)) {
      done()
      return (): void => {}
    }
    if (this.effects.size >= 4) this.effects.values().next().value!.cancel()
    const source = this.cards?.anchorFor(effect.sourceInstanceId) ?? this.actorAnchor(effect.actor)
    const target = this.effectTargetAnchor(effect)
    const removed = effect.kind === 'mountain_destroy' && effect.targetInstanceId
      ? this.cards?.pinRemoved(effect.targetInstanceId) ?? null : null
    const visual = new EffectVisual(this.effectGeometry, effect, source, target, duration, this.quality.effectParticles, removed, () => {
      this.effects.delete(visual)
      done()
      this.invalidate()
    })
    this.effects.add(visual)
    this.scene.add(visual.group)
    this.invalidate()
    return visual.cancel
  }

  private actorAnchor(actor: number, hand = false): CardAnchor {
    const row: BoardRow = actor === this.actor ? hand ? 'hand' : 'near' : 'far'
    return { x: 0, y: this.layout.rows[row].y, width: this.layout.cardWidth, height: this.layout.cardHeight, owner: actor, zone: hand ? 'hand' : 'battlefield' }
  }

  private effectTargetAnchor(effect: VisualEffectDescriptor): CardAnchor {
    const targetActor = effect.targetActor ?? effect.actor
    if (effect.kind === 'swamp_discard') return this.actorAnchor(targetActor, true)
    return this.cards?.anchorFor(effect.targetInstanceId, effect.targetCardId)
      ?? this.actorAnchor(targetActor, effect.kind === 'forest_return')
  }

  setVisible(visible: boolean): void {
    if (this.disposed || this.visible === visible) return
    this.visible = visible
    this.stage.hidden = !visible
    this.visibilityChanged()
    if (visible) this.resize()
  }

  private usable(): boolean {
    return !this.disposed && !this.failed && this.visible && !document.hidden
  }

  private visibilityChanged = (): void => {
    if (this.disposed) return
    this.lastFrame = null
    if (!this.usable()) {
      if (this.frame !== null) cancelAnimationFrame(this.frame)
      this.frame = null
      this.endDrag(false)
      this.onResize()
    } else this.invalidate()
  }

  private motionChanged = (): void => {
    this.endDrag(false)
    this.updateQuality()
    if (!this.quality.motion) for (const effect of this.effects) effect.cancel()
    this.onResize()
    this.invalidate()
  }

  private resize = (): void => {
    if (!this.usable()) return
    this.endDrag(false)
    this.onResize()
    this.applySize()
    this.present()
    this.invalidate()
  }

  private applySize(): void {
    const rect = this.stage.getBoundingClientRect()
    const width = Math.max(1, rect.width || this.host.clientWidth || window.innerWidth || 1000)
    const height = Math.max(1, rect.height || 750)
    this.layout = boardLayout(width, height)
    this.camera.left = -width / 2
    this.camera.right = width / 2
    this.camera.top = height / 2
    this.camera.bottom = -height / 2
    this.camera.updateProjectionMatrix()
    this.updateQuality()
    this.renderer?.setSize(width, height, false)
    this.table.scale.set(width - 4, height - 4, 24)
    this.background.scale.set(width - 12, height - 12, 1)
    this.drop.scale.set(this.layout.drop.width, this.layout.drop.height, 1)
    this.drop.position.x = this.layout.drop.x
    this.drop.position.y = this.layout.drop.y
    for (const row of ROWS) {
      const chrome = this.chrome.get(row)!
      chrome.label.style.top = `${this.layout.rows[row].labelTop}px`
      chrome.controls.style.top = `${this.layout.rows[row].controlsTop}px`
    }
    this.instruction.style.top = `${height / 3 + 33}px`
  }

  private updateQuality(): void {
    const profile = threeQualityProfile({
      preference: this.view?.renderQualityPreference ?? 'auto',
      width: this.layout.width,
      height: this.layout.height,
      devicePixelRatio: window.devicePixelRatio,
      animationSpeed: this.view?.animationSpeed,
      reducedMotion: this.motionQuery?.matches ?? false,
    })
    if (this.quality.pixelRatio !== profile.pixelRatio) this.renderer?.setPixelRatio(profile.pixelRatio)
    this.quality = profile
    if (!profile.motion) {
      this.endDrag(false)
      for (const effect of this.effects) effect.cancel()
    }
  }

  private setBackground(theme: AppViewModel['boardTheme']): void {
    const key = `${theme}:${this.quality.backgroundVariant}`
    if (!this.assets || this.backgroundKey === key) return
    const lease = this.assets.acquireBoard(theme, this.quality.backgroundVariant)
    this.backgroundLease?.release()
    this.backgroundLease = lease
    this.backgroundKey = key
    this.backgroundMaterial.map = lease.texture
    this.backgroundMaterial.needsUpdate = true
  }

  private createChrome(row: BoardRow): void {
    const label = document.createElement('p')
    label.className = 'three-board-label'
    const controls = document.createElement('div')
    controls.className = 'three-board-pagination'
    const previous = document.createElement('button')
    const next = document.createElement('button')
    const count = document.createElement('span')
    previous.type = next.type = 'button'
    previous.textContent = '‹ Previous'
    next.textContent = 'Next ›'
    count.setAttribute('aria-live', 'polite')
    const back = (): void => this.changePage(row, -1)
    const forward = (): void => this.changePage(row, 1)
    previous.addEventListener('click', back)
    next.addEventListener('click', forward)
    controls.append(previous, count, next)
    this.stage.append(label, controls)
    this.chrome.set(row, {
      label, controls, previous, next, count,
      dispose: (): void => {
        previous.removeEventListener('click', back)
        next.removeEventListener('click', forward)
      },
    })
  }

  private changePage(row: BoardRow, delta: number): void {
    if (!this.usable()) return
    this.endDrag(false)
    this.onResize()
    this.pages[row] += delta
    this.present()
    this.invalidate()
  }

  private updatePageButtons(): void {
    const game = this.view?.game
    if (!game) return
    for (const row of ROWS) {
      const owner = row === 'far' ? 1 - this.actor : this.actor
      const count = row === 'hand' ? game.players[owner].handCards.length : game.players[owner].battlefield.length
      const page = pageWindow(count, this.pages[row], this.layout.capacity)
      const chrome = this.chrome.get(row)!
      chrome.previous.disabled = page.page === 0 || this.drag !== null
      chrome.next.disabled = page.page === page.pages - 1 || this.drag !== null
    }
  }

  private invalidate = (): void => {
    if (this.usable() && this.frame === null) this.frame = requestAnimationFrame(this.drawFrame)
  }

  private drawFrame = (now: number): void => {
    this.frame = null
    if (!this.usable()) return
    const delta = this.lastFrame === null ? 16 : Math.max(0, Math.min(64, now - this.lastFrame))
    this.lastFrame = now
    for (const effect of this.effects) effect.advance(delta)
    const drag = this.drag
    if (drag?.returning) {
      drag.elapsed += delta
      const t = Math.min(1, drag.elapsed / 140)
      const ease = 1 - (1 - t) ** 3
      drag.proxy.group.position.x = drag.fromX + (drag.source.descriptor.x - drag.fromX) * ease
      drag.proxy.group.position.y = drag.fromY + (drag.source.descriptor.y - drag.fromY) * ease
      drag.proxy.setOpacity(1 - t * 0.65)
      if (t >= 1) this.endDrag(false)
    }
    try {
      this.renderer?.render(this.scene, this.camera)
    } catch {
      this.fail('Three.js rendering failed. Switching to the DOM renderer.')
      return
    }
    if (this.effects.size || this.drag?.returning) this.invalidate()
    else this.lastFrame = null
  }

  private contextLost = (event: Event): void => {
    event.preventDefault()
    this.fail('The WebGL context was lost. Switching to the DOM renderer.')
  }

  private fail(message: string): void {
    if (this.disposed || this.failed) return
    this.failed = true
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
    this.endDrag(false)
    this.onFailure(message)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
    this.observer?.disconnect()
    this.observer = null
    this.canvas.removeEventListener('webglcontextlost', this.contextLost)
    window.removeEventListener('resize', this.resize)
    window.removeEventListener('orientationchange', this.resize)
    window.visualViewport?.removeEventListener('resize', this.resize)
    document.removeEventListener('visibilitychange', this.visibilityChanged)
    if (this.motionQuery?.removeEventListener) this.motionQuery.removeEventListener('change', this.motionChanged)
    else this.motionQuery?.removeListener(this.motionChanged)
    this.endDrag(false)
    for (const effect of this.effects) effect.cancel()
    this.effects.clear()
    for (const chrome of this.chrome.values()) chrome.dispose()
    this.chrome.clear()
    this.cards?.dispose()
    this.assets?.dispose()
    this.backgroundLease = null
    this.effectGeometry.dispose()
    this.plane.dispose()
    this.box.dispose()
    this.tableMaterial.dispose()
    this.backgroundMaterial.dispose()
    this.dropMaterial.dispose()
    this.scene.clear()
    this.renderer?.dispose()
    this.renderer?.forceContextLoss()
    this.renderer = null
    this.stage.remove()
  }
}
