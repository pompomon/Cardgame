import {
  BoxGeometry, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, OrthographicCamera, PlaneGeometry, Scene, SRGBColorSpace, WebGLRenderer,
} from 'three'
import { DEFAULT_BOARD_THEME } from '../../app/board-theme'
import { DEFAULT_CARD_VISUAL_STYLE } from '../../app/card-visual-styles'
import { durationMsForSpeed, MAX_QUEUED_EFFECTS } from '../../app/animation-settings'
import { HIDDEN_HAND_CARD_NAME, type AppViewModel } from '../../app/types'
import type { CounterHandOptions } from '../../app/response-options'
import type { VisualEffectDescriptor } from '../../app/visual-effects'
import { effectFeedbackForDescriptor } from '../phaser/interaction-feedback'
import { ThreeAssets } from './assets'
import { ThreeBackground } from './background'
import { boardCardKey, ThreeCardRegistry, type CardAnchor, type CardDescriptor, type RetainedCard } from './card-registry'
import type { BoardHit, ThreeBoardApi } from './contracts'
import { EffectGeometry, EffectVisual, effectRecipe } from './effect-visual'
import { presentationBoundary } from './effects'
import type { ThreePrimaryAction } from './interface-model'
import { boardColumns, boardLayout, cardSlotX, clientToBoard, compactBoardViewport, pendingCardRect, pointInRect, type BoardRow, type ThreeLayout } from './layout'
import { threeQualityProfile, type ThreeQualityProfile } from './quality'
import './graphics.css'

interface RowChrome {
  readonly header: HTMLDivElement
  readonly label: HTMLParagraphElement
  readonly stats: HTMLParagraphElement
  readonly stacks: readonly HTMLSpanElement[]
}

interface DragVisual {
  readonly source: RetainedCard
  readonly proxy: RetainedCard
  returning: boolean
  elapsed: number
  fromX: number
  fromY: number
}

interface TargetLabel {
  readonly element: HTMLSpanElement
  nextKey: string | null
}

const ROWS: readonly BoardRow[] = ['far', 'near', 'hand']
const PLAY_INSTRUCTION = 'Drag a highlighted card into your battlefield'
const CANCEL_INSTRUCTION = 'Move into your battlefield · release elsewhere to cancel'

export class ThreeBoard implements ThreeBoardApi {
  readonly canvas: HTMLCanvasElement
  private readonly host: HTMLElement
  private readonly stage = document.createElement('div')
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 3000)
  private readonly plane = new PlaneGeometry(1, 1)
  private readonly box = new BoxGeometry(1, 1, 1)
  private readonly tableMaterial = new MeshStandardMaterial({ color: '#574634', roughness: 0.8 })
  private readonly dropMaterial = new MeshBasicMaterial({ color: '#70e7b1', opacity: 0.05, transparent: true, depthWrite: false })
  private readonly table = new Mesh(this.box, this.tableMaterial)
  private readonly drop = new Mesh(this.plane, this.dropMaterial)
  private readonly effectGeometry = new EffectGeometry()
  private readonly effects = new Set<EffectVisual>()
  private readonly effectDescriptors = new Map<EffectVisual, VisualEffectDescriptor>()
  private readonly chrome = new Map<BoardRow, RowChrome>()
  private readonly surfaces = new Map<BoardRow, Mesh<PlaneGeometry, MeshBasicMaterial>>()
  private readonly targetLabels = new Map<string, TargetLabel>()
  private readonly effectCaption = document.createElement('p')
  private readonly pendingCaption = document.createElement('p')
  private pendingCard: RetainedCard | null = null
  private readonly instruction = document.createElement('p')
  private readonly instructionText = document.createElement('span')
  private readonly instructionSizes: HTMLSpanElement[] = []
  private readonly primaryButton = document.createElement('button')
  private primaryAction: ThreePrimaryAction | null = null
  private pressedAction: ThreePrimaryAction | null = null
  private readonly point = { x: 0, y: 0 }
  private readonly onFailure: (message: string) => void
  private readonly onResize: () => void
  private readonly onPrimaryAction: (action: ThreePrimaryAction) => void
  private renderer: WebGLRenderer | null = null
  private assets: ThreeAssets | null = null
  private cards: ThreeCardRegistry | null = null
  private background: ThreeBackground | null = null
  private observer: ResizeObserver | null = null
  private motionQuery: MediaQueryList | null = null
  private layout: ThreeLayout = boardLayout(1000, 750)
  private quality: ThreeQualityProfile = threeQualityProfile({ preference: 'auto', width: 1000, height: 750 })
  private view: AppViewModel | null = null
  private actor = 0
  private targetIds: ReadonlySet<string> = new Set()
  private response: CounterHandOptions | null = null
  private visible = true
  private disposed = false
  private failed = false
  private frame: number | null = null
  private lastFrame: number | null = null
  private drag: DragVisual | null = null
  private canDrop = false
  private inputBlocked = false
  private sized = false

  constructor(
    host: HTMLElement,
    onFailure: (message: string) => void,
    onResize: () => void,
    onPrimaryAction: (action: ThreePrimaryAction) => void,
  ) {
    this.host = host
    this.onFailure = onFailure
    this.onResize = onResize
    this.onPrimaryAction = onPrimaryAction
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
      this.background = new ThreeBackground(this.assets, this.invalidate)
      this.scene.add(this.table, this.drop, this.cards.layer, this.background.group)
      this.scene.add(new HemisphereLight('#e9f5ff', '#493a29', 2))
      const light = new DirectionalLight('#fff5dc', 2.5)
      light.position.set(-200, 300, 800)
      this.scene.add(light)
      this.table.position.z = -14
      this.drop.position.z = 0.1
      this.camera.position.set(0, 0, 1200)
      this.camera.lookAt(0, 0, 0)
      for (const row of ROWS) {
        this.createChrome(row)
        const surface = new Mesh(this.plane, new MeshBasicMaterial({
          color: '#132d29', transparent: true, opacity: 0.68, depthWrite: false,
        }))
        surface.position.z = 0
        this.surfaces.set(row, surface)
        this.scene.add(surface)
      }
      this.effectCaption.className = 'three-board-effect-caption'
      this.effectCaption.hidden = true
      this.effectCaption.setAttribute('role', 'status')
      this.effectCaption.setAttribute('aria-live', 'polite')
      this.stage.append(this.effectCaption)
      this.pendingCaption.className = 'three-board-pending-caption'
      this.pendingCaption.hidden = true
      this.pendingCaption.setAttribute('role', 'status')
      this.pendingCaption.setAttribute('aria-live', 'polite')
      this.stage.append(this.pendingCaption)
      this.primaryButton.type = 'button'
      this.primaryButton.className = 'three-board-primary'
      this.primaryButton.hidden = true
      this.primaryButton.addEventListener('click', this.activatePrimary)
      this.primaryButton.addEventListener('pointerdown', this.capturePrimary)
      this.primaryButton.addEventListener('keydown', this.capturePrimaryKey)
      this.primaryButton.addEventListener('pointercancel', this.clearPrimaryPress)
      this.primaryButton.addEventListener('blur', this.clearPrimaryPress)
      this.instruction.className = 'three-board-instruction'
      this.instruction.id = 'three-battlefield-prompt'
      this.instruction.setAttribute('role', 'status')
      this.instruction.setAttribute('aria-live', 'polite')
      this.instruction.hidden = true
      this.instruction.append(this.instructionText)
      // Reserve every drag prompt's wrapped height before a gesture starts;
      // otherwise changing feedback triggers ResizeObserver and cancels the drag.
      for (const text of [PLAY_INSTRUCTION, CANCEL_INSTRUCTION]) {
        const size = document.createElement('span')
        size.className = 'three-board-instruction-size'
        size.setAttribute('aria-hidden', 'true')
        size.textContent = text
        this.instruction.append(size)
        this.instructionSizes.push(size)
      }
      this.primaryButton.setAttribute('aria-describedby', this.instruction.id)
      this.chrome.get('near')!.header.append(this.primaryButton, this.instruction)
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
        for (const chrome of this.chrome.values()) this.observer.observe(chrome.header)
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

  render(
    view: AppViewModel, presentedActor: number, targetIds: ReadonlySet<string>,
    response: CounterHandOptions | null, primaryAction: ThreePrimaryAction | null,
    blocked = false,
  ): void {
    if (this.disposed || this.failed) return
    const boundary = presentationBoundary(this.view, view)
    const sessionBoundary = !this.view?.game || !view.game
      || this.view.seed !== view.seed || this.view.mode !== view.mode
    const reoriented = this.actor !== presentedActor || boundary
    if (reoriented) {
      this.endDrag(false)
    }
    if (boundary) {
      for (const effect of this.effects) effect.cancel()
      if (sessionBoundary) this.clearPendingCard()
      this.cards?.clear()
    }
    this.view = view
    this.actor = presentedActor === 1 ? 1 : 0
    this.targetIds = new Set(targetIds)
    this.response = response
    this.primaryAction = primaryAction
    this.inputBlocked = blocked
    this.updateQuality()
    this.setBackground(view.boardTheme ?? DEFAULT_BOARD_THEME)
    this.present(!reoriented, reoriented)
    this.invalidate()
  }

  private present(animate = true, invalidateHistory = false): void {
    const game = this.view?.game
    if (!game) {
      this.canDrop = false
      this.clearPendingCard()
      this.cards?.reconcile([])
      this.syncTargetLabels([])
      this.effectCaption.hidden = true
      this.instruction.hidden = true
      this.primaryButton.hidden = true
      return
    }
    const descriptors: CardDescriptor[] = []
    const style = this.view?.cardVisualStyle ?? DEFAULT_CARD_VISUAL_STYLE
    const input = !this.inputBlocked && game.canInput && game.actor === this.actor && game.actorControl === 'human'
      && !game.isReplay && !this.view?.replay.active
    const response = input && game.phase === 'respond' ? this.response : null
    const responseIds = new Set(response?.choices.map((choice) => choice.cardId))
    this.canDrop = input && game.phase === 'main'
      && Object.values(game.legal.playLandByCard).some((options) => options.length > 0)
    const primary = input ? this.primaryAction : null
    const primaryFocused = this.primaryButton.ownerDocument.activeElement === this.primaryButton
    this.primaryButton.hidden = primary === null
    this.primaryButton.disabled = !primary || primary.disabled
    this.primaryButton.textContent = primary?.label ?? ''
    this.primaryButton.dataset.action = primary?.type ?? ''
    if (primaryFocused && (this.primaryButton.hidden || this.primaryButton.disabled)) {
      this.chrome.get('near')!.label.focus({ preventScroll: true })
    }
    this.instruction.hidden = !this.canDrop && !response
    for (const size of this.instructionSizes) size.hidden = !this.canDrop
    this.instructionText.textContent = response
      ? primary?.prompt || `Respond to ${game.pendingLandName ?? 'land'}. ${response.choices.length
        ? response.instruction : 'No legal counter cards available.'}`
      : PLAY_INSTRUCTION
    for (const row of ROWS) {
      const owner = row === 'far' ? 1 - this.actor : this.actor
      const player = game.players[owner]
      const chrome = this.chrome.get(row)!
      const label = row === 'hand' ? `Player ${owner + 1} · hand` : `Player ${owner + 1} · battlefield`
      chrome.label.textContent = `${label}${game.actor === owner ? ' · ACTIVE' : ''}`
      chrome.header.dataset.active = String(game.actor === owner)
      if (row !== 'hand') {
        const counts = `Hand ${player.handCount} · Deck ${player.deckCount} · Graveyard ${player.graveyardCount}`
        chrome.stats.textContent = counts
        chrome.stats.setAttribute('aria-label', `Player ${owner + 1}: ${counts}`)
        for (const [index, stack] of chrome.stacks.entries()) {
          const count = index === 0 ? player.deckCount : player.graveyardCount
          stack.textContent = `${index === 0 ? 'Deck' : 'GY'} ${count}`
          stack.dataset.empty = String(count === 0)
        }
      }
    }
    const resized = this.applySize()
    for (const row of ROWS) {
      const owner = row === 'far' ? 1 - this.actor : this.actor
      const player = game.players[owner]
      const entries = row === 'hand' ? player.handCards : player.battlefield
      for (let index = 0; index < entries.length; index++) {
        const card = entries[index]
        const instanceId = 'instanceId' in card ? card.instanceId : undefined
        const cardId = 'cardId' in card ? card.cardId : card.id
        const hit: BoardHit = {
          key: boardCardKey(cardId, owner, instanceId),
          cardId, instanceId, name: card.name, owner, zone: row === 'hand' ? 'hand' : 'battlefield',
          playable: row === 'hand' && input && game.phase === 'main' && card.name !== HIDDEN_HAND_CARD_NAME
            && (game.legal.playLandByCard[cardId]?.length ?? 0) > 0,
        }
        descriptors.push({
          hit, style, visible: true,
          x: cardSlotX(index, entries.length, this.layout),
          y: this.layout.rows[row].y,
          width: this.layout.cardWidth, height: this.layout.cardHeight,
          stackIndex: index,
          target: this.targetIds.has(instanceId ?? cardId) || this.targetIds.has(cardId),
          response: row === 'hand' && card.name !== HIDDEN_HAND_CARD_NAME
            ? response?.requiredIslandId === cardId ? 'required' : responseIds.has(cardId) ? 'discard' : null
            : null,
          shadows: this.quality.shadows,
        })
      }
    }
    if (this.drag && !this.drag.returning) {
      const desired = descriptors.find((descriptor) => descriptor.hit.key === this.drag?.source.descriptor.hit.key)
      if (!desired?.hit.playable) this.endDrag(false)
    }
    const duration = animate && !resized && this.quality.motion && !this.drag
      ? Math.min(220, durationMsForSpeed(this.view?.animationSpeed ?? 'normal')) : 0
    this.cards?.reconcile(descriptors, duration)
    this.presentPendingCard()
    if (resized || invalidateHistory) this.cards?.invalidateHistoricalAnchors()
    this.reanchorEffects()
    this.syncTargetLabels(descriptors)
    if (this.drag) this.drag.source.setOpacity(0.35)
    this.dropMaterial.opacity = this.canDrop ? 0.05 : 0.015
  }

  private clearPendingCard(): void {
    this.pendingCard?.dispose()
    this.pendingCard = null
    this.pendingCaption.hidden = true
    this.pendingCaption.textContent = ''
  }

  private presentPendingCard(): void {
    const game = this.view?.game
    const pending = game?.phase === 'respond' ? game.pendingLandPlay : null
    if (!pending || !this.cards) {
      this.clearPendingCard()
      return
    }
    const rect = pendingCardRect(this.layout, pending.actor, this.actor)
    const descriptor: CardDescriptor = {
      ...rect, hit: {
        key: boardCardKey(pending.cardId, pending.actor), cardId: pending.cardId,
        name: pending.name, owner: pending.actor, zone: 'battlefield', playable: false,
      },
      style: this.view?.cardVisualStyle ?? DEFAULT_CARD_VISUAL_STYLE,
      visible: true, target: false, shadows: this.quality.shadows, lifted: true,
    }
    if (this.pendingCard?.descriptor.hit.key !== descriptor.hit.key) this.clearPendingCard()
    if (this.pendingCard) this.pendingCard.update(descriptor)
    else this.pendingCard = this.cards.createPresentation(descriptor)
    this.pendingCard.group.name = 'pending-land-play'
    this.pendingCaption.hidden = false
    this.pendingCaption.textContent = `${pending.name} · awaiting response`
    this.pendingCaption.style.left = `${this.layout.width / 2 + rect.x}px`
    this.pendingCaption.style.top = `${this.layout.height / 2 - rect.y - rect.height / 2 + 4}px`
    this.pendingCaption.style.width = `${rect.width - 8}px`
  }

  private syncTargetLabels(descriptors: readonly CardDescriptor[]): void {
    const visible = new Set<string>()
    for (const [index, descriptor] of descriptors.entries()) {
      if (!descriptor.visible || !descriptor.target) continue
      const key = descriptor.hit.key
      visible.add(key)
      const next = descriptors[index + 1]
      const nextKey = next?.hit.owner === descriptor.hit.owner && next.hit.zone === descriptor.hit.zone
        ? next.hit.key : null
      let targetLabel = this.targetLabels.get(key)
      if (!targetLabel) {
        const label = document.createElement('span')
        label.className = 'three-board-target-label'
        label.textContent = 'Target'
        label.dataset.cardId = descriptor.hit.cardId
        label.setAttribute('aria-hidden', 'true')
        this.stage.append(label)
        targetLabel = { element: label, nextKey }
        this.targetLabels.set(key, targetLabel)
      } else {
        targetLabel.nextKey = nextKey
      }
    }
    for (const [key, targetLabel] of this.targetLabels) {
      if (!visible.has(key)) {
        targetLabel.element.remove()
        this.targetLabels.delete(key)
      }
    }
    this.positionTargetLabels()
  }

  private positionTargetLabels(): void {
    for (const [key, targetLabel] of this.targetLabels) {
      const anchor = this.cards?.get(key)?.anchor()
      if (!anchor) continue
      const nextAnchor = targetLabel.nextKey ? this.cards?.get(targetLabel.nextKey)?.anchor() : null
      const left = anchor.x - anchor.width / 2
      const right = nextAnchor && nextAnchor.owner === anchor.owner && nextAnchor.zone === anchor.zone
        ? Math.min(anchor.x + anchor.width / 2, nextAnchor.x - nextAnchor.width / 2)
        : anchor.x + anchor.width / 2
      const exposedCenter = right > left ? (left + right) / 2 : anchor.x
      const exposedWidth = Math.max(1, right - left)
      const compact = exposedWidth < 64
      targetLabel.element.dataset.compact = String(compact)
      targetLabel.element.textContent = compact ? '' : 'Target'
      targetLabel.element.style.width = compact ? `${Math.min(12, exposedWidth)}px` : ''
      targetLabel.element.style.left = `${this.layout.width / 2 + exposedCenter}px`
      targetLabel.element.style.top = `${this.layout.height / 2 - anchor.y - anchor.height / 2 + 2}px`
    }
  }

  private readonly capturePrimary = (event: PointerEvent): void => {
    if (event.button === 0 && event.isPrimary) this.pressedAction = this.primaryAction
  }
  private readonly clearPrimaryPress = (): void => { this.pressedAction = null }
  private readonly capturePrimaryKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (event.repeat) event.preventDefault()
    else this.pressedAction = this.primaryAction
  }
  private readonly activatePrimary = (): void => {
    const action = this.pressedAction ?? this.primaryAction
    this.clearPrimaryPress()
    if (!action || !this.usable() || this.primaryButton.hidden || this.primaryButton.disabled) return
    this.onResize()
    this.onPrimaryAction(action)
  }

  hitTest(clientX: number, clientY: number): BoardHit | null {
    if (!this.usable() || !clientToBoard(clientX, clientY, this.canvas.getBoundingClientRect(), this.layout, this.point)) return null
    if (this.pendingCard && pointInRect(this.point, this.pendingCard.anchor())) return null
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
    this.cards?.finishMotion()
    this.positionTargetLabels()
    this.reanchorEffects()
    const source = this.cards?.get(hit.key)
    if (!source?.descriptor.hit.playable || !source.descriptor.visible) return
    const proxy = this.cards!.createProxy(source)
    proxy.group.rotation.set(-0.06, 0.08, -0.025)
    source.setOpacity(0.35)
    this.drag = { source, proxy, returning: false, elapsed: 0, fromX: 0, fromY: 0 }
    this.invalidate()
  }

  moveDrag(clientX: number, clientY: number, touch: boolean): void {
    if (!this.drag || this.drag.returning || !this.usable()) return
    const rect = this.canvas.getBoundingClientRect()
    const inside = clientToBoard(clientX, clientY, rect, this.layout, this.point)
    this.drag.proxy.group.position.x = this.point.x
    this.drag.proxy.group.position.y = this.point.y + (touch ? 44 * this.layout.height / Math.max(1, rect.height) : 0)
    const allowed = inside && this.canDrop && pointInRect(this.point, this.layout.drop)
    this.dropMaterial.color.set(allowed ? '#94ffc9' : '#e5667d')
    this.dropMaterial.opacity = allowed ? 0.2 : 0.08
    this.instructionText.textContent = allowed ? 'Release to play' : CANCEL_INSTRUCTION
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
    this.instructionText.textContent = PLAY_INSTRUCTION
    this.invalidate()
  }

  playEffect(effect: VisualEffectDescriptor, duration: number, done: () => void): () => void {
    if (!this.usable() || !this.quality.motion || !Number.isFinite(duration) || duration <= 0 || !effectRecipe(effect.kind)) {
      done()
      return (): void => {}
    }
    if (this.effects.size >= MAX_QUEUED_EFFECTS) this.effects.values().next().value!.cancel()
    const feedback = effectFeedbackForDescriptor(effect)
    this.effectCaption.textContent = feedback.label
    this.effectCaption.hidden = false
    const source = this.cards?.anchorFor(effect.sourceInstanceId) ?? this.actorAnchor(effect.actor)
    const target = this.effectTargetAnchor(effect)
    const removed = effect.kind === 'mountain_destroy' && effect.targetInstanceId
      ? this.cards?.pinRemoved(effect.targetInstanceId) ?? null : null
    const visual = new EffectVisual(this.effectGeometry, effect, source, target, duration, this.quality.effectParticles, removed, () => {
      this.effects.delete(visual)
      this.effectDescriptors.delete(visual)
      this.effectCaption.hidden = this.effects.size === 0
      done()
      this.invalidate()
    })
    this.effects.add(visual)
    this.effectDescriptors.set(visual, effect)
    this.scene.add(visual.group)
    this.invalidate()
    return visual.cancel
  }

  retainEffectTargets(instanceIds: readonly string[]): void {
    this.cards?.retainRemovedTargets(instanceIds)
  }

  private reanchorEffects(): void {
    for (const [visual, descriptor] of this.effectDescriptors) {
      visual.reanchor(
        this.cards?.anchorFor(descriptor.sourceInstanceId) ?? this.actorAnchor(descriptor.actor),
        this.effectTargetAnchor(descriptor),
      )
    }
  }

  private actorAnchor(actor: number, hand = false): CardAnchor {
    const row: BoardRow = actor === this.actor ? hand ? 'hand' : 'near' : 'far'
    return { x: cardSlotX(0, 1, this.layout), y: this.layout.rows[row].y, width: this.layout.cardWidth, height: this.layout.cardHeight, owner: actor, zone: hand ? 'hand' : 'battlefield' }
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
    this.updateQuality()
    this.setBackground(this.view?.boardTheme ?? DEFAULT_BOARD_THEME)
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
    this.setBackground(this.view?.boardTheme ?? DEFAULT_BOARD_THEME)
    if (!this.quality.motion) for (const effect of this.effects) effect.cancel()
    this.onResize()
    this.invalidate()
  }

  private resize = (): void => {
    if (!this.usable()) return
    this.endDrag(false)
    this.onResize()
    this.present(false, true)
    this.invalidate()
  }

  private applySize(): boolean {
    const width = Math.max(1, this.stage.clientWidth || this.host.clientWidth || window.innerWidth || 1000)
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight ?? this.stage.clientHeight
    const compact = compactBoardViewport(width, viewportHeight)
    this.stage.dataset.layout = compact ? 'compact' : 'stacked'
    const columns = boardColumns(width, compact)
    const headers = { far: 0, near: 0, hand: 0 }
    for (const row of ROWS) {
      const chrome = this.chrome.get(row)!
      chrome.header.style.left = `${columns.labelLeft}px`
      chrome.header.style.width = `${columns.labelWidth}px`
      headers[row] = Math.max(chrome.header.offsetHeight, chrome.header.scrollHeight || 0)
    }
    const height = Math.max(1, this.stage.clientHeight || this.host.clientHeight || viewportHeight || 750)
    const resized = !this.sized || width !== this.layout.width || height !== this.layout.height
    const nextLayout = boardLayout(width, height, headers, compact)
    const layoutChanged = JSON.stringify(this.layout) !== JSON.stringify(nextLayout)
    this.layout = nextLayout
    this.camera.left = -width / 2
    this.camera.right = width / 2
    this.camera.top = height / 2
    this.camera.bottom = -height / 2
    this.camera.updateProjectionMatrix()
    this.updateQuality()
    if (resized) this.renderer?.setSize(width, height, false)
    this.sized = true
    this.table.scale.set(width - 4, height - 4, 24)
    this.setBackground(this.view?.boardTheme ?? DEFAULT_BOARD_THEME)
    this.drop.scale.set(this.layout.drop.width, this.layout.drop.height, 1)
    this.drop.position.x = this.layout.drop.x
    this.drop.position.y = this.layout.drop.y
    this.effectCaption.style.left = `${width / 2 + this.layout.drop.x}px`
    this.effectCaption.style.top = `${height / 2 - this.layout.rows.near.y}px`
    this.effectCaption.style.maxWidth = `${columns.cardsWidth - 12}px`
    for (const row of ROWS) {
      const chrome = this.chrome.get(row)!
      chrome.header.style.top = `${this.layout.rows[row].labelTop}px`
      chrome.header.style.maxHeight = `${this.layout.rows[row].labelHeight}px`
      const surface = this.surfaces.get(row)!
      surface.position.set(cardSlotX(0, 1, this.layout), this.layout.rows[row].y, 0)
      surface.scale.set(columns.cardsWidth, this.layout.rows[row].height + 4, 1)
      const owner = row === 'far' ? 1 - this.actor : this.actor
      surface.material.color.set(this.view?.game?.actor === owner ? '#214c3b' : '#152b3b')
      surface.material.opacity = row === 'hand' ? 0.35 : 0.68
    }
    return layoutChanged
  }

  private updateQuality(): void {
    const profile = threeQualityProfile({
      preference: this.view?.renderQualityPreference ?? 'auto',
      width: window.visualViewport?.width ?? window.innerWidth ?? this.layout.width,
      height: window.visualViewport?.height ?? window.innerHeight ?? this.layout.height,
      devicePixelRatio: window.devicePixelRatio,
      animationSpeed: this.view?.animationSpeed,
      reducedMotion: this.motionQuery?.matches ?? false,
      hidden: !this.visible || document.hidden,
    })
    if (this.quality.pixelRatio !== profile.pixelRatio) this.renderer?.setPixelRatio(profile.pixelRatio)
    this.quality = profile
    if (!profile.motion) {
      this.endDrag(false)
      this.cards?.finishMotion()
      this.positionTargetLabels()
      for (const effect of this.effects) effect.cancel()
    }
  }

  private setBackground(theme: AppViewModel['boardTheme']): void {
    const width = Math.max(1, this.layout.width - 12)
    const height = Math.max(1, this.layout.height - 12)
    this.background?.group.position.set(-width / 2, height / 2, 0)
    this.background?.sync({ theme, profile: this.quality, width, height })
  }

  private createChrome(row: BoardRow): void {
    const header = document.createElement('div')
    header.className = 'three-board-label'
    header.dataset.row = row
    const summary = document.createElement('div')
    const label = document.createElement('p')
    label.tabIndex = -1
    const stats = document.createElement('p')
    stats.className = 'three-board-stats'
    stats.hidden = row === 'hand'
    summary.append(label, stats)
    const stacks: HTMLSpanElement[] = []
    if (row !== 'hand') {
      const holder = document.createElement('div')
      holder.className = 'three-board-stacks'
      holder.setAttribute('aria-hidden', 'true')
      for (let index = 0; index < 2; index++) {
        const stack = document.createElement('span')
        stack.className = 'three-board-stack'
        holder.append(stack)
        stacks.push(stack)
      }
      summary.append(holder)
    }
    header.append(summary)
    this.stage.append(header)
    this.chrome.set(row, { header, label, stats, stacks })
  }

  private invalidate = (): void => {
    if (this.usable() && this.frame === null) this.frame = requestAnimationFrame(this.drawFrame)
  }

  private drawFrame = (now: number): void => {
    this.frame = null
    if (!this.usable()) return
    const delta = this.lastFrame === null ? 16 : Math.max(0, Math.min(64, now - this.lastFrame))
    this.lastFrame = now
    const moving = this.cards?.animating
    this.cards?.advance(delta)
    if (moving) {
      this.positionTargetLabels()
      this.reanchorEffects()
    }
    this.background?.advance(delta)
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
    if (this.effects.size || this.drag?.returning || this.cards?.animating || this.background?.animating) this.invalidate()
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
    this.primaryButton.removeEventListener('click', this.activatePrimary)
    this.primaryButton.removeEventListener('pointerdown', this.capturePrimary)
    this.primaryButton.removeEventListener('keydown', this.capturePrimaryKey)
    this.primaryButton.removeEventListener('pointercancel', this.clearPrimaryPress)
    this.primaryButton.removeEventListener('blur', this.clearPrimaryPress)
    this.primaryAction = null
    this.pressedAction = null
    window.removeEventListener('resize', this.resize)
    window.removeEventListener('orientationchange', this.resize)
    window.visualViewport?.removeEventListener('resize', this.resize)
    document.removeEventListener('visibilitychange', this.visibilityChanged)
    if (this.motionQuery?.removeEventListener) this.motionQuery.removeEventListener('change', this.motionChanged)
    else this.motionQuery?.removeListener(this.motionChanged)
    this.endDrag(false)
    for (const effect of this.effects) effect.cancel()
    this.effects.clear()
    this.effectDescriptors.clear()
    this.chrome.clear()
    this.targetLabels.clear()
    for (const surface of this.surfaces.values()) surface.material.dispose()
    this.surfaces.clear()
    this.clearPendingCard()
    this.cards?.dispose()
    this.background?.dispose()
    this.background = null
    this.assets?.dispose()
    this.effectGeometry.dispose()
    this.plane.dispose()
    this.box.dispose()
    this.tableMaterial.dispose()
    this.dropMaterial.dispose()
    this.scene.clear()
    this.renderer?.dispose()
    this.renderer?.forceContextLoss()
    this.renderer = null
    this.stage.remove()
  }
}
