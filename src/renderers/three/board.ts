import {
  BoxGeometry, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, OrthographicCamera, PlaneGeometry, Scene, SRGBColorSpace, WebGLRenderer,
} from 'three'
import { DEFAULT_BOARD_THEME } from '../../app/board-theme'
import { cardAssetSlug, displayCardName } from '../../app/card-catalog'
import { DEFAULT_CARD_VISUAL_STYLE } from '../../app/card-visual-styles'
import { durationMsForSpeed, MAX_QUEUED_EFFECTS } from '../../app/animation-settings'
import { HIDDEN_HAND_CARD_NAME, type AppViewModel } from '../../app/types'
import type { CounterHandOptions } from '../../app/response-options'
import type { VisualEffectDescriptor } from '../../app/visual-effects'
import { BASIC_LANDS, isBasicLand, type BasicLand } from '../../game/types'
import { effectFeedbackForDescriptor } from '../shared/interaction-feedback'
import { ThreeAssets } from './assets'
import { ThreeBackground } from './background'
import { boardCardKey, ThreeCardRegistry, type CardAnchor, type CardDescriptor, type RetainedCard } from './card-registry'
import {
  DEFAULT_BOARD_PRESENTATION, NO_BOARD_SELECTION, THREE_DOCK_PROMPT_ID,
  type BoardHit, type ThreeBoardApi, type ThreeBoardPresentation, type ThreeBoardSelection,
} from './contracts'
import { EffectGeometry, EffectVisual, effectRecipe } from './effect-visual'
import { presentationBoundary } from './effects'
import type { ThreePrimaryAction } from './interface-model'
import {
  boardColumns, boardLayout, cardSlotX, clientToBoard, compactBoardViewport, NARROW_MIN_BOARD_HEIGHT, NARROW_TYPE_SLOTS, narrowBoardColumns,
  narrowBoardLayout, narrowHandPageSize, narrowHandRects, pendingCardRect, pointInRect, typeSlotX,
  type BoardLayoutMode, type BoardRow, type ThreeLayout,
} from './layout'
import { threeQualityProfile, type ThreeQualityProfile } from './quality'
import './graphics.css'

interface RowChrome {
  readonly header: HTMLDivElement
  /** Hidden worst-case copy whose height reserves the header's space. */
  readonly sizer: HTMLDivElement
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
const SUMMON_INSTRUCTION = 'Drag a highlighted creature onto your board to summon it'
const CANCEL_INSTRUCTION = 'Move onto your board · release elsewhere to cancel'
const RELEASE_INSTRUCTION = 'Release to summon'
const MAX_INSTRUCTION_WIDTH = 544
const OVERLAY_GAP = 4
const EFFECT_ANNOUNCEMENT_MS = 350
// Header sizers hold the longest copy each live header can show.
const SIZER_LABELS: Readonly<Record<BoardRow, string>> = {
  far: 'Player 2 · Board · ACTIVE', near: 'Player 2 · Board · ACTIVE', hand: 'Player 2 · Hand · ACTIVE',
}
const SIZER_STATS = 'Hand 99 · Deck 99 · Discard pile 99'
const SIZER_STACKS = ['Deck 99', 'Discard 99'] as const
const PRIMARY_LABELS = ['End Turn', 'Let It Through'] as const
const NARROW_TARGET_LABEL_MIN = 46
const TARGET_LABEL_MIN = 64

/** Presentation-only grouping: unknown cards share the first slot. */
function typeSlot(card: { readonly name: string; readonly serializedKey?: BasicLand }): number {
  const key = card.serializedKey ?? (isBasicLand(card.name) ? card.name : null)
  return key ? Math.max(0, BASIC_LANDS.indexOf(key)) : 0
}

interface NarrowPlacement {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly stackIndex: number
  /** Uppermost card of its type stack. */
  readonly top: boolean
}

function cardIdentity(
  card: { readonly name: string; readonly serializedKey?: BasicLand; readonly displayName?: string },
): Pick<BoardHit, 'serializedKey' | 'displayName' | 'assetSlug'> {
  if (card.name === HIDDEN_HAND_CARD_NAME) return {}
  const serializedKey = card.serializedKey ?? (isBasicLand(card.name) ? card.name : null)
  return serializedKey
    ? {
        serializedKey,
        displayName: card.displayName ?? displayCardName(serializedKey),
        assetSlug: cardAssetSlug(serializedKey),
      }
    : {}
}

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
  private readonly handPagination = document.createElement('div')
  private readonly handPrevious = document.createElement('button')
  private readonly handNext = document.createElement('button')
  private readonly handPageLabel = document.createElement('span')
  private handPage = 0
  private primaryAction: ThreePrimaryAction | null = null
  private pressedAction: ThreePrimaryAction | null = null
  private readonly point = { x: 0, y: 0 }
  private readonly onFailure: (message: string) => void
  private readonly onResize: () => void
  private readonly onPrimaryAction: (action: ThreePrimaryAction) => void
  private readonly dockSlot: HTMLElement | null
  private readonly presentation: () => ThreeBoardPresentation
  private readonly ghostMaterial = new MeshBasicMaterial({ color: '#b9d3e0', opacity: 0.12, transparent: true, depthWrite: false })
  private readonly ghosts: Mesh<PlaneGeometry, MeshBasicMaterial>[] = []
  private readonly countBadges = new Map<string, HTMLSpanElement>()
  private typeSlotsShown = false
  private primaryDocked = false
  private narrow = false
  private selection: ThreeBoardSelection = NO_BOARD_SELECTION
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
  private effectCardSequence = 0
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
    dockSlot: HTMLElement | null = null,
    presentation: () => ThreeBoardPresentation = () => DEFAULT_BOARD_PRESENTATION,
  ) {
    this.host = host
    this.onFailure = onFailure
    this.onResize = onResize
    this.onPrimaryAction = onPrimaryAction
    this.dockSlot = dockSlot
    this.presentation = presentation
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'three-board-canvas'
    this.canvas.setAttribute('aria-label', 'Urban Creatures board. Use the adjacent card controls for keyboard interaction.')
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
      // Empty type slots in the narrow profile keep a faint placeholder so a
      // newly summoned creature lands where the player expects it.
      for (let index = 0; index < NARROW_TYPE_SLOTS * 2; index++) {
        const ghost = new Mesh(this.plane, this.ghostMaterial)
        ghost.name = 'three-type-slot'
        ghost.visible = false
        ghost.position.z = 0.05
        this.ghosts.push(ghost)
        this.scene.add(ghost)
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
      // Reserve every drag prompt's wrapped height so feedback does not make
      // the overlay jump during a gesture.
      for (const text of [SUMMON_INSTRUCTION, CANCEL_INSTRUCTION, RELEASE_INSTRUCTION]) {
        const size = document.createElement('span')
        size.className = 'three-board-instruction-size'
        size.setAttribute('aria-hidden', 'true')
        size.textContent = text
        this.instruction.append(size)
        this.instructionSizes.push(size)
      }
      this.primaryButton.setAttribute('aria-describedby', this.instruction.id)
      this.chrome.get('near')!.header.append(this.primaryButton)
      this.handPagination.className = 'three-board-pagination'
      this.handPagination.hidden = true
      this.handPrevious.type = this.handNext.type = 'button'
      this.handPrevious.textContent = '‹'
      this.handNext.textContent = '›'
      this.handPrevious.setAttribute('aria-label', 'Previous hand page')
      this.handNext.setAttribute('aria-label', 'Next hand page')
      this.handPageLabel.setAttribute('aria-live', 'polite')
      this.handPrevious.addEventListener('click', this.previousHandPage)
      this.handNext.addEventListener('click', this.nextHandPage)
      this.handPagination.append(this.handPrevious, this.handPageLabel, this.handNext)
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
        // Sizers, not live headers: content changes inside a header can never
        // resize the rows, so they cannot cancel a gesture.
        for (const chrome of this.chrome.values()) this.observer.observe(chrome.sizer)
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
      this.handPage = 0
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
    const presentation = this.presentation()
    const narrow = presentation.narrow === true
    if (narrow !== this.narrow) {
      // Switching profiles moves every card, so no gesture can survive it.
      this.endDrag(false)
      this.handPage = 0
      this.onResize()
      if (narrow) this.chrome.get('hand')!.header.append(this.handPagination)
      else this.handPagination.remove()
    }
    this.narrow = narrow
    this.selection = narrow ? presentation.selection : NO_BOARD_SELECTION
    this.placePrimaryButton()
    this.updateQuality()
    this.setBackground(view.boardTheme ?? DEFAULT_BOARD_THEME)
    this.present(!reoriented, reoriented)
    this.invalidate()
  }

  /** The narrow profile docks the primary action beside the action prompt. */
  private placePrimaryButton(): void {
    const docked = this.narrow && this.dockSlot !== null
    if (docked === this.primaryDocked) return
    const focused = this.primaryButton.ownerDocument.activeElement === this.primaryButton
    const host = docked && this.dockSlot ? this.dockSlot : this.chrome.get('near')!.header
    host.append(this.primaryButton)
    this.primaryButton.setAttribute('aria-describedby', docked ? THREE_DOCK_PROMPT_ID : this.instruction.id)
    this.primaryDocked = docked
    if (focused && !this.primaryButton.hidden && !this.primaryButton.disabled) {
      this.primaryButton.focus({ preventScroll: true })
    }
  }

  private present(animate = true, invalidateHistory = false): void {
    const game = this.view?.game
    if (!game) {
      this.canDrop = false
      this.clearPendingCard()
      this.cards?.reconcile([])
      this.syncTargetLabels([])
      this.syncTypeSlots(null)
      this.effectCaption.hidden = true
      this.instruction.hidden = true
      this.primaryButton.hidden = true
      this.handPagination.hidden = true
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
    // The narrow dock carries the instructions; the overlay only returns to
    // give live feedback while a card is being dragged.
    this.instruction.hidden = this.narrow ? !this.drag || this.drag.returning : !this.canDrop && !response
    for (const size of this.instructionSizes) size.hidden = !this.canDrop
    this.instructionText.textContent = response
      ? primary?.prompt || (response.choices.length
        ? response.instruction
        : `No legal card combination can intercept the summon of ${game.pendingLandDisplayName ?? 'this creature'}. Choose Let It Through.`)
      : SUMMON_INSTRUCTION
    for (const row of ROWS) {
      const owner = row === 'far' ? 1 - this.actor : this.actor
      const player = game.players[owner]
      const chrome = this.chrome.get(row)!
      const label = row === 'hand' ? `Player ${owner + 1} · Hand` : `Player ${owner + 1} · Board`
      chrome.label.textContent = `${label}${game.actor === owner ? ' · ACTIVE' : ''}`
      chrome.header.dataset.active = String(game.actor === owner)
      if (row !== 'hand') {
        const counts = `Hand ${player.handCount} · Deck ${player.deckCount} · Discard pile ${player.graveyardCount}`
        chrome.stats.textContent = counts
        chrome.stats.setAttribute('aria-label', `Player ${owner + 1}: ${counts}`)
        for (const [index, stack] of chrome.stacks.entries()) {
          const count = index === 0 ? player.deckCount : player.graveyardCount
          stack.textContent = `${index === 0 ? 'Deck' : 'Discard'} ${count}`
          stack.dataset.empty = String(count === 0)
        }
      }
    }
    const resized = this.applySize()
    const pageSize = narrowHandPageSize(this.layout)
    const hand = game.players[this.actor].handCards
    const pages = Math.max(1, Math.ceil(hand.length / pageSize))
    this.handPage = Math.min(this.handPage, pages - 1)
    this.handPagination.hidden = !this.narrow || pages === 1
    this.handPrevious.disabled = this.handPage === 0
    this.handNext.disabled = this.handPage === pages - 1
    this.handPageLabel.textContent = `${this.handPage + 1}/${pages}`
    const selection = this.narrow ? this.selection : NO_BOARD_SELECTION
    // Hand selections only exist while this player may act on them.
    const handSelection = input ? selection : NO_BOARD_SELECTION
    const slotCounts: number[][] = []
    for (const row of ROWS) {
      const owner = row === 'far' ? 1 - this.actor : this.actor
      const player = game.players[owner]
      const entries = row === 'hand'
        ? this.narrow ? player.handCards.slice(this.handPage * pageSize, (this.handPage + 1) * pageSize) : player.handCards
        : player.battlefield
      const placements = this.narrow ? this.narrowPlacements(row, entries, row === 'hand' ? handSelection : selection) : null
      if (placements && row !== 'hand') slotCounts.push(placements.counts)
      for (let index = 0; index < entries.length; index++) {
        const card = entries[index]
        const instanceId = 'instanceId' in card ? card.instanceId : undefined
        const cardId = 'cardId' in card ? card.cardId : card.id
        const hit: BoardHit = {
          key: boardCardKey(cardId, owner, instanceId),
          cardId, instanceId, name: card.name, owner, zone: row === 'hand' ? 'hand' : 'battlefield',
          ...cardIdentity(card),
          playable: row === 'hand' && input && game.phase === 'main' && card.name !== HIDDEN_HAND_CARD_NAME
            && (game.legal.playLandByCard[cardId]?.length ?? 0) > 0,
        }
        const target = this.targetIds.has(instanceId ?? cardId) || this.targetIds.has(cardId)
        const placement = placements?.cards[index]
        const selected = row === 'hand'
          ? cardId === handSelection.cardId || cardId === handSelection.discardId
          : target && instanceId !== undefined && instanceId === selection.targetId
        descriptors.push({
          hit, style, visible: true,
          x: placement?.x ?? cardSlotX(index, entries.length, this.layout),
          y: placement?.y ?? this.layout.rows[row].y,
          width: placement?.width ?? this.layout.cardWidth,
          height: placement?.height ?? this.layout.cardHeight,
          stackIndex: placement?.stackIndex ?? index,
          // Only the uppermost card of a narrow stack advertises targeting.
          target: target && (placement?.top ?? true),
          selected: selected || undefined,
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
    this.syncTypeSlots(this.narrow ? slotCounts : null)
    if (this.drag) this.drag.source.setOpacity(0.35)
    this.dropMaterial.opacity = this.canDrop ? 0.05 : 0.015
  }

  private previousHandPage = (): void => { this.changeHandPage(-1) }
  private nextHandPage = (): void => { this.changeHandPage(1) }

  private changeHandPage(delta: number): void {
    if (!this.usable() || this.handPagination.hidden
      || (delta < 0 ? this.handPrevious.disabled : this.handNext.disabled)) return
    this.endDrag(false)
    this.onResize()
    this.handPage += delta
    this.present(false, true)
    this.invalidate()
  }

  /**
   * Narrow placement: battlefield creatures share one fixed slot per type,
   * stacked with targets and the selection on top; the hand wraps onto lines.
   */
  private narrowPlacements(
    row: BoardRow,
    entries: readonly { readonly name: string; readonly serializedKey?: BasicLand; readonly id?: string; readonly instanceId?: string; readonly cardId?: string }[],
    selection: ThreeBoardSelection,
  ): { cards: NarrowPlacement[]; counts: number[] } {
    const layout = this.layout
    if (row === 'hand') {
      const rects = narrowHandRects(entries.length, layout)
      const cards = entries.map((card, index): NarrowPlacement => {
        const rect = rects[index]
        const cardId = card.id ?? card.cardId
        const lifted = cardId !== undefined && (cardId === selection.cardId || cardId === selection.discardId)
        return {
          x: rect.x, y: rect.y + (lifted ? Math.min(8, rect.height * 0.06) : 0),
          width: rect.width, height: rect.height,
          stackIndex: lifted ? 1000 : index, top: true,
        }
      })
      return { cards, counts: [] }
    }
    const groups: number[][] = Array.from({ length: NARROW_TYPE_SLOTS }, () => [])
    for (const [index, card] of entries.entries()) groups[typeSlot(card)].push(index)
    const cards: NarrowPlacement[] = []
    const rank = (index: number): number => {
      const card = entries[index]
      const instanceId = card.instanceId ?? card.cardId ?? ''
      if (instanceId !== '' && instanceId === selection.targetId) return 2
      return this.targetIds.has(instanceId) || (card.cardId !== undefined && this.targetIds.has(card.cardId)) ? 1 : 0
    }
    for (const [slot, members] of groups.entries()) {
      const ordered = [...members].sort((left, right) => rank(left) - rank(right) || left - right)
      for (const [position, index] of ordered.entries()) {
        cards[index] = {
          x: typeSlotX(slot, layout), y: layout.rows[row].y,
          width: layout.cardWidth, height: layout.cardHeight,
          stackIndex: position, top: position === ordered.length - 1,
        }
      }
    }
    return { cards, counts: groups.map((members) => members.length) }
  }

  /** Ghost placeholders mark empty narrow slots; badges count stacked copies. */
  private syncTypeSlots(counts: readonly (readonly number[])[] | null): void {
    if (!counts && !this.typeSlotsShown) return
    this.typeSlotsShown = counts !== null
    const live = new Set<string>()
    for (const [rowIndex, row] of (['far', 'near'] as const).entries()) {
      const rowCounts = counts?.[rowIndex] ?? []
      for (let slot = 0; slot < NARROW_TYPE_SLOTS; slot++) {
        const count = rowCounts[slot] ?? 0
        const ghost = this.ghosts[rowIndex * NARROW_TYPE_SLOTS + slot]
        if (ghost) {
          ghost.visible = counts !== null && count === 0
          ghost.position.set(typeSlotX(slot, this.layout), this.layout.rows[row].y, 0.05)
          ghost.scale.set(this.layout.cardWidth, this.layout.cardHeight, 1)
        }
        if (count < 2) continue
        const key = `${row}:${slot}`
        live.add(key)
        let badge = this.countBadges.get(key)
        if (!badge) {
          badge = document.createElement('span')
          badge.className = 'three-board-count'
          badge.setAttribute('aria-hidden', 'true')
          this.stage.append(badge)
          this.countBadges.set(key, badge)
        }
        badge.textContent = `×${count}`
        const x = typeSlotX(slot, this.layout) + this.layout.cardWidth / 2
        const y = this.layout.rows[row].y + this.layout.cardHeight / 2
        badge.style.left = `${this.layout.width / 2 + x}px`
        badge.style.top = `${this.layout.height / 2 - y}px`
      }
    }
    for (const [key, badge] of this.countBadges) {
      if (live.has(key)) continue
      badge.remove()
      this.countBadges.delete(key)
    }
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
        ...cardIdentity(pending),
      },
      style: this.view?.cardVisualStyle ?? DEFAULT_CARD_VISUAL_STYLE,
      visible: true, target: false, shadows: this.quality.shadows, lifted: true,
    }
    if (this.pendingCard?.descriptor.hit.key !== descriptor.hit.key) this.clearPendingCard()
    if (this.pendingCard) this.pendingCard.update(descriptor)
    else this.pendingCard = this.cards.createPresentation(descriptor)
    this.pendingCard.group.name = 'pending-land-play'
    this.pendingCaption.hidden = false
    this.pendingCaption.textContent = `${pending.displayName ?? displayCardName(pending.name)} · awaiting interception`
    this.pendingCaption.style.left = `${this.layout.width / 2 + rect.x}px`
    this.pendingCaption.style.top = `${this.layout.height / 2 - rect.y - rect.height / 2 + 4}px`
    this.pendingCaption.style.width = this.narrow
      ? `${Math.min(160, this.layout.columns.cardsWidth - 8)}px`
      : `${rect.width - 8}px`
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
      const compact = exposedWidth < (this.narrow ? NARROW_TARGET_LABEL_MIN : TARGET_LABEL_MIN)
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
    // The overlay's height is reserved, so showing it cannot resize anything.
    if (this.narrow) this.instruction.hidden = false
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
    this.instructionText.textContent = allowed ? RELEASE_INSTRUCTION : CANCEL_INSTRUCTION
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
    this.instructionText.textContent = SUMMON_INSTRUCTION
    if (this.narrow) this.instruction.hidden = true
    this.invalidate()
  }

  private showEffectCaption(effect: VisualEffectDescriptor): void {
    const feedback = effectFeedbackForDescriptor(effect)
    if (this.effectCaption.textContent !== feedback.label) this.effectCaption.textContent = feedback.label
    const announcement = effect.kind === 'mountain_destroy'
      ? `Banish: ${effect.targetDisplayName ?? 'the creature'} goes to its owner's discard pile.`
      : feedback.label
    if (this.effectCaption.getAttribute('aria-label') !== announcement) {
      this.effectCaption.setAttribute('aria-label', announcement)
    }
    this.effectCaption.hidden = false
  }

  announceEffect(effect: VisualEffectDescriptor, done: () => void): () => void {
    this.showEffectCaption(effect)
    let completed = false
    const finish = (): void => {
      if (completed) return
      completed = true
      clearTimeout(timer)
      this.effectCaption.hidden = true
      done()
      this.invalidate()
    }
    const timer = setTimeout(finish, EFFECT_ANNOUNCEMENT_MS)
    return finish
  }

  playEffect(effect: VisualEffectDescriptor, duration: number, done: () => void): () => void {
    this.showEffectCaption(effect)
    if (!this.usable() || !this.quality.motion || !Number.isFinite(duration) || duration <= 0 || !effectRecipe(effect.kind)) {
      done()
      return (): void => {}
    }
    if (this.effects.size >= MAX_QUEUED_EFFECTS) this.effects.values().next().value!.cancel()
    const source = this.cards?.anchorFor(effect.sourceInstanceId) ?? this.actorAnchor(effect.actor)
    const target = this.effectTargetAnchor(effect)
    const counterCards = this.createCounterCards(effect, source)
    const removed = effect.kind === 'mountain_destroy' && effect.targetInstanceId
      ? this.cards?.pinRemoved(effect.targetInstanceId) ?? null : null
    const visual = new EffectVisual(this.effectGeometry, effect, source, target, duration, this.quality.effectParticles, removed, () => {
      this.effects.delete(visual)
      this.effectDescriptors.delete(visual)
      this.effectCaption.hidden = this.effects.size === 0
      done()
      this.invalidate()
    }, counterCards)
    this.effects.add(visual)
    this.effectDescriptors.set(visual, effect)
    this.scene.add(visual.group)
    this.invalidate()
    return visual.cancel
  }

  private createCounterCards(effect: VisualEffectDescriptor, anchor: CardAnchor): RetainedCard[] {
    if (effect.kind !== 'counter_resolved' || !effect.counterCards || !this.cards) return []
    const sequence = ++this.effectCardSequence
    return effect.counterCards.map((name, index) => {
      const cardId = `counter-cost-${sequence}-${index}`
      const identity = cardIdentity({ name, serializedKey: name, displayName: displayCardName(name) })
      const card = this.cards!.createPresentation({
        x: anchor.x,
        y: anchor.y,
        width: anchor.width,
        height: anchor.height,
        hit: {
          key: boardCardKey(cardId, effect.actor),
          cardId,
          name,
          ...identity,
          owner: effect.actor,
          zone: 'battlefield',
          playable: false,
        },
        style: effect.visualStyle,
        visible: true,
        target: false,
        response: null,
        shadows: this.quality.shadows,
        lifted: true,
      })
      card.group.name = index === 0 ? 'counter-cost-island' : 'counter-cost-discard'
      return card
    })
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
    this.relayout(false)
  }

  /**
   * Viewport and observer callbacks only interrupt gestures when the layout
   * really changed; otherwise overlays are re-anchored in place.
   */
  private relayout(force: boolean): void {
    if (!this.usable()) return
    const changed = this.applySize()
    if (!changed && !force) {
      this.positionTargetLabels()
      this.invalidate()
      return
    }
    this.endDrag(false)
    this.onResize()
    this.present(false, true)
    this.invalidate()
  }

  private applySize(): boolean {
    const width = Math.max(1, this.stage.clientWidth || this.host.clientWidth || window.innerWidth || 1000)
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight ?? this.stage.clientHeight
    const compact = compactBoardViewport(width, viewportHeight)
    const mode: BoardLayoutMode = this.narrow ? 'narrow' : compact ? 'compact' : 'stacked'
    // Set before measuring: the sizers' copy depends on the mode's styles.
    this.stage.dataset.layout = mode
    const columns = this.narrow ? narrowBoardColumns(width) : boardColumns(width, compact)
    const headers = { far: 0, near: 0, hand: 0 }
    for (const row of ROWS) {
      const chrome = this.chrome.get(row)!
      for (const element of [chrome.header, chrome.sizer]) {
        element.style.left = `${columns.labelLeft}px`
        element.style.width = `${columns.labelWidth}px`
      }
      headers[row] = Math.max(chrome.sizer.offsetHeight, chrome.sizer.scrollHeight || 0)
      if (this.narrow && row === 'hand') headers[row] = Math.max(50, headers[row])
    }
    const height = Math.max(this.narrow ? NARROW_MIN_BOARD_HEIGHT : 1,
      this.stage.clientHeight || this.host.clientHeight || viewportHeight || 750)
    this.canvas.style.height = this.narrow ? `${height}px` : ''
    const scrollable = this.narrow && height > this.stage.clientHeight
    this.stage.dataset.scrollable = String(scrollable)
    for (const chrome of this.chrome.values()) {
      chrome.header.title = scrollable ? 'Swipe this player header to scroll the board' : ''
    }
    const resized = !this.sized || width !== this.layout.width || height !== this.layout.height
    const nextLayout = this.narrow ? narrowBoardLayout(width, height, headers) : boardLayout(width, height, headers, compact)
    const layoutChanged = !this.sized || JSON.stringify(this.layout) !== JSON.stringify(nextLayout)
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
    const nearRow = this.layout.rows.near
    const nearRowCenter = height / 2 - nearRow.y
    const nearRowTop = nearRowCenter - nearRow.height / 2
    const instructionTop = nearRowTop + OVERLAY_GAP
    this.instruction.style.left = `${columns.cardsLeft + columns.cardsWidth / 2}px`
    this.instruction.style.top = `${instructionTop}px`
    this.instruction.style.width = `${Math.min(MAX_INSTRUCTION_WIDTH, Math.max(1, columns.cardsWidth - 24))}px`
    const instructionHeight = this.instruction.hidden
      ? 0 : Math.max(this.instruction.offsetHeight, this.instruction.scrollHeight || 0)
    this.effectCaption.style.left = `${width / 2 + this.layout.drop.x}px`
    this.effectCaption.style.top = `${instructionTop + instructionHeight + (instructionHeight ? OVERLAY_GAP : 0)}px`
    this.effectCaption.style.maxWidth = `${columns.cardsWidth - 12}px`
    for (const row of ROWS) {
      const chrome = this.chrome.get(row)!
      // Live headers are pinned to their reserved height, so a changing
      // label, count, or primary action never moves the rows below.
      chrome.header.style.top = `${this.layout.rows[row].labelTop}px`
      chrome.header.style.height = `${this.layout.rows[row].labelHeight}px`
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
    this.chrome.set(row, { header, sizer: this.createSizer(row), label, stats, stacks })
  }

  /**
   * An invisible header carrying the longest copy and both primary labels.
   * Its height is the row's reserved header height in every state.
   */
  private createSizer(row: BoardRow): HTMLDivElement {
    const sizer = document.createElement('div')
    sizer.className = 'three-board-label three-board-sizer'
    sizer.dataset.row = row
    sizer.setAttribute('aria-hidden', 'true')
    sizer.inert = true
    const summary = document.createElement('div')
    const label = document.createElement('p')
    label.textContent = SIZER_LABELS[row]
    const stats = document.createElement('p')
    stats.className = 'three-board-stats'
    stats.textContent = SIZER_STATS
    stats.hidden = row === 'hand'
    summary.append(label, stats)
    if (row !== 'hand') {
      const holder = document.createElement('div')
      holder.className = 'three-board-stacks'
      for (const text of SIZER_STACKS) {
        const stack = document.createElement('span')
        stack.className = 'three-board-stack'
        stack.textContent = text
        holder.append(stack)
      }
      summary.append(holder)
    }
    sizer.append(summary)
    if (row === 'near') {
      const primary = document.createElement('button')
      primary.type = 'button'
      primary.className = 'three-board-primary three-board-primary-size'
      primary.disabled = true
      primary.tabIndex = -1
      for (const text of PRIMARY_LABELS) {
        const option = document.createElement('span')
        option.textContent = text
        primary.append(option)
      }
      sizer.append(primary)
    }
    this.stage.append(sizer)
    return sizer
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
      this.fail('Three.js rendering failed.')
      return
    }
    if (this.effects.size || this.drag?.returning || this.cards?.animating || this.background?.animating) this.invalidate()
    else this.lastFrame = null
  }

  private contextLost = (event: Event): void => {
    event.preventDefault()
    this.fail('The WebGL context was lost.')
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
    this.handPrevious.removeEventListener('click', this.previousHandPage)
    this.handNext.removeEventListener('click', this.nextHandPage)
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
    this.countBadges.clear()
    for (const surface of this.surfaces.values()) surface.material.dispose()
    this.surfaces.clear()
    this.ghosts.length = 0
    this.ghostMaterial.dispose()
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
    // A docked primary button lives outside the stage.
    this.primaryButton.remove()
    this.stage.remove()
  }
}
