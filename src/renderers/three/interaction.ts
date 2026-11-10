import { resolvePlayLandDrop } from '../../app/action-resolution'
import { shouldHideHandFromViewer } from '../../app/game-presentation'
import { HIDDEN_HAND_CARD_NAME, type AppViewModel } from '../../app/types'
import {
  DragStateMachine,
  dragPointerType,
  TOUCH_DRAG_THRESHOLD_PX,
  type DragPeekHandlers,
  type DragPointerSnapshot,
  type DragPointerType,
  type DragTimers,
} from '../shared/drag-state'
import type { BoardHit, ThreeBoardApi, ThreePeek } from './contracts'
import { threeDecisionKey } from './interface-model'

/** Long-press peek wiring. Without `canPeek`, a held press stays a tap. */
export interface ThreeInteractionOptions {
  /** Whether the interface would preview `hit` now. */
  readonly canPeek?: (hit: BoardHit) => boolean
  /** Opens a peek, or closes it with `null`. */
  readonly onPeek?: (peek: ThreePeek | null) => void
  /** The long-press timers; injectable for tests. */
  readonly timers?: DragTimers
}

interface Gesture {
  readonly pointerId: number
  readonly pointerType: DragPointerType
  readonly hit: BoardHit
  readonly context: string
  readonly playable: boolean
  readonly startX: number
  readonly startY: number
  moved: boolean
  exceededTapThreshold: boolean
  visualStarted: boolean
  ringShown: boolean
  peek: ThreePeek | null
  /** The decision the peek opened on; a new decision closes it. */
  peekDecision: string
}

function snapshot(event: PointerEvent): DragPointerSnapshot {
  return { id: event.pointerId, x: event.clientX, y: event.clientY, event }
}

function contextKey(view: AppViewModel): string {
  const game = view.game
  return [
    view.mode, view.seed, view.adventure.activeGameSeed,
    game?.turn, game?.phase, game?.actor, game?.actorControl, game?.canInput, game?.isReplay,
    view.replay.active, view.replay.step, view.replay.totalSteps, view.replay.isPlaying,
    game?.phase === 'respond' ? threeDecisionKey(view) : '',
  ].join(':')
}

function isVisibleSource(view: AppViewModel, hit: BoardHit): boolean {
  const player = view.game?.players.find((entry) => entry.id === hit.owner)
  if (!player || hit.name === HIDDEN_HAND_CARD_NAME) {
    return false
  }
  if (hit.zone === 'hand') {
    return !shouldHideHandFromViewer(view.controllers, hit.owner)
      && player.handCards.some((card) => card.id === hit.cardId && card.name === hit.name)
  }
  return player.battlefield.some((card) => (
    card.instanceId === hit.instanceId && card.cardId === hit.cardId && card.name === hit.name
  ))
}

function isPlayable(view: AppViewModel, hit: BoardHit): boolean {
  const game = view.game
  return !!game && hit.zone === 'hand' && hit.owner === game.actor
    && game.canInput && game.actorControl === 'human' && game.phase === 'main'
    && !game.isReplay && !view.replay.active
    && resolvePlayLandDrop(game, hit.cardId).kind !== 'invalid'
}

function sameSource(first: BoardHit, second: BoardHit): boolean {
  return first.key === second.key && first.cardId === second.cardId
    && first.instanceId === second.instanceId && first.owner === second.owner
    && first.zone === second.zone && first.name === second.name
}

export class ThreeInteraction {
  private readonly board: ThreeBoardApi
  private readonly getView: () => AppViewModel | null
  private readonly isBlocked: () => boolean
  private readonly playCard: (cardId: string) => void
  private readonly activate: (hit: BoardHit, pointerType: DragPointerType) => void
  private readonly onHover: (hit: BoardHit | null) => void
  private readonly canPeek: (hit: BoardHit) => boolean
  private readonly onPeek: (peek: ThreePeek | null) => void
  private readonly document: Document
  private readonly window: Window | null
  private readonly state: DragStateMachine
  private gesture: Gesture | null = null
  private hover: BoardHit | null = null
  private hoverDecision = ''
  /** The latest `pointerdown` type, for `contextmenu` events that do not carry one. */
  private lastPointerType: DragPointerType = 'mouse'
  private disposed = false

  constructor(
    board: ThreeBoardApi,
    getView: () => AppViewModel | null,
    isBlocked: () => boolean,
    playCard: (cardId: string) => void,
    activate: (hit: BoardHit, pointerType: DragPointerType) => void,
    onHover: (hit: BoardHit | null) => void = () => {},
    options: ThreeInteractionOptions = {},
  ) {
    this.board = board
    this.getView = getView
    this.isBlocked = isBlocked
    this.playCard = playCard
    this.activate = activate
    this.onHover = onHover
    this.canPeek = options.canPeek ?? (() => false)
    this.onPeek = options.onPeek ?? (() => {})
    this.state = new DragStateMachine(options.timers)
    this.document = board.canvas.ownerDocument
    this.window = this.document.defaultView
    board.canvas.addEventListener('pointerdown', this.onPointerDown)
    board.canvas.addEventListener('pointermove', this.onPointerMove)
    board.canvas.addEventListener('pointerleave', this.onPointerLeave)
    board.canvas.addEventListener('pointerup', this.onPointerUp)
    board.canvas.addEventListener('pointercancel', this.onPointerLoss)
    board.canvas.addEventListener('lostpointercapture', this.onPointerLoss)
    board.canvas.addEventListener('contextmenu', this.onContextMenu)
    this.window?.addEventListener('pointerup', this.onWindowPointerUp)
    this.window?.addEventListener('pointercancel', this.onPointerLoss)
    this.window?.addEventListener('pointerout', this.onPointerOut)
    this.window?.addEventListener('blur', this.onBlur)
    this.window?.addEventListener('keydown', this.onKeyDown)
    this.document.addEventListener('visibilitychange', this.onVisibilityChange)
  }

  /** A card follows the pointer; native actions wait until it drops or returns. */
  get dragging(): boolean {
    return this.gesture?.visualStarted === true
  }

  reconcile(): void {
    const gesture = this.gesture
    if (gesture && (!this.isCurrent(gesture) || gesture.peek && !this.peekCurrent(gesture))) {
      this.cancel()
    }
    const view = this.getView()
    if (this.hover && (!view || this.document.hidden || this.isBlocked()
      || threeDecisionKey(view) !== this.hoverDecision || !isVisibleSource(view, this.hover))) this.clearHover()
  }

  cancel(): void {
    this.clearHover()
    this.finish(false)
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    const canvas = this.board.canvas
    canvas.removeEventListener('pointerdown', this.onPointerDown)
    canvas.removeEventListener('pointermove', this.onPointerMove)
    canvas.removeEventListener('pointerleave', this.onPointerLeave)
    canvas.removeEventListener('pointerup', this.onPointerUp)
    canvas.removeEventListener('pointercancel', this.onPointerLoss)
    canvas.removeEventListener('lostpointercapture', this.onPointerLoss)
    canvas.removeEventListener('contextmenu', this.onContextMenu)
    this.window?.removeEventListener('pointerup', this.onWindowPointerUp)
    this.window?.removeEventListener('pointercancel', this.onPointerLoss)
    this.window?.removeEventListener('pointerout', this.onPointerOut)
    this.window?.removeEventListener('blur', this.onBlur)
    this.window?.removeEventListener('keydown', this.onKeyDown)
    this.document.removeEventListener('visibilitychange', this.onVisibilityChange)
    this.cancel()
  }

  private isCurrent(gesture: Gesture): boolean {
    const view = this.getView()
    return !this.disposed && !this.document.hidden && !!view?.game
      && contextKey(view) === gesture.context && isVisibleSource(view, gesture.hit)
      && isPlayable(view, gesture.hit) === gesture.playable
      // A pending battlefield target blocks dragging, but must still accept taps.
      && (gesture.hit.zone === 'battlefield' || !this.isBlocked())
  }

  private peekCurrent(gesture: Gesture): boolean {
    const view = this.getView()
    return !!view && threeDecisionKey(view) === gesture.peekDecision && this.canPeek(gesture.hit)
  }

  private inWindow(event: PointerEvent): boolean {
    return Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
      && event.clientX >= 0 && event.clientY >= 0
      && (!this.window || (
        event.clientX < this.window.innerWidth && event.clientY < this.window.innerHeight
      ))
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const pointer = snapshot(event)
    const pointerType = dragPointerType(pointer)
    this.lastPointerType = pointerType
    this.clearHover()
    // Any touch or pen contact may start a gesture; a mouse only as the primary pointer.
    if (this.disposed || event.button !== 0 || (pointerType === 'mouse' && event.isPrimary === false)
      || this.document.hidden || !this.inWindow(event)) {
      return
    }
    const current = this.gesture
    if (current) {
      // A drag keeps its pointer. A new pointer replaces a stationary press or peek.
      if (current.pointerId === event.pointerId || this.state.phase === 'dragging') {
        return
      }
      this.cancel()
    }
    const view = this.getView()
    const hit = this.board.hitTest(event.clientX, event.clientY)
    if (!view?.game || !hit || !isVisibleSource(view, hit)
      || (hit.zone !== 'battlefield' && this.isBlocked())) {
      return
    }
    const gesture: Gesture = {
      pointerId: event.pointerId,
      pointerType,
      hit: { ...hit },
      context: contextKey(view),
      playable: isPlayable(view, hit),
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      exceededTapThreshold: false,
      visualStarted: false,
      ringShown: false,
      peek: null,
      peekDecision: '',
    }
    const peek: DragPeekHandlers | undefined = pointerType !== 'mouse' && this.canPeek(hit)
      && this.board.peekPlacement(hit, event.clientX, event.clientY) !== null
      ? { ring: () => this.ringPeek(gesture), open: () => this.openPeek(gesture) }
      : undefined
    const result = this.state.begin(pointer, hit.cardId, peek)
    if (result === 'ignored') {
      return
    }
    this.gesture = gesture
    try {
      this.board.canvas.setPointerCapture(event.pointerId)
    } catch {
      this.cancel()
      return
    }
    if (this.gesture === gesture && gesture.playable && result === 'dragging') {
      this.moveVisual(gesture, event)
    }
  }

  private trackMovement(gesture: Gesture, event: PointerEvent): void {
    const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY)
    gesture.moved ||= distance > 0
    gesture.exceededTapThreshold ||= distance >= TOUCH_DRAG_THRESHOLD_PX
    const result = this.state.move(snapshot(event))
    if (result === 'started') {
      // Leaving the threshold closes a peek, or its ring, before any drag starts.
      this.closePeek(gesture)
      if (this.gesture !== gesture) {
        return
      }
    }
    if (gesture.playable && (result === 'started' || result === 'dragging')) {
      this.moveVisual(gesture, event)
    }
  }

  private ringPeek(gesture: Gesture): void {
    if (this.gesture !== gesture || !this.isCurrent(gesture) || !this.canPeek(gesture.hit)) {
      return
    }
    gesture.ringShown = true
    this.board.showPeekRing(gesture.startX, gesture.startY)
  }

  /** Opens the peek once the press is held; refusing it keeps the press a tap. */
  private openPeek(gesture: Gesture): boolean {
    const view = this.getView()
    const placement = view && this.gesture === gesture && this.isCurrent(gesture) && this.canPeek(gesture.hit)
      ? this.board.peekPlacement(gesture.hit, gesture.startX, gesture.startY)
      : null
    if (!view || !placement) {
      this.closePeek(gesture)
      return false
    }
    const peek: ThreePeek = { hit: { ...gesture.hit }, placement: { ...placement } }
    gesture.peek = peek
    gesture.peekDecision = threeDecisionKey(view)
    this.onPeek(peek)
    return this.gesture === gesture && gesture.peek === peek
  }

  private closePeek(gesture: Gesture): void {
    if (gesture.ringShown) {
      gesture.ringShown = false
      this.board.hidePeekRing()
    }
    if (gesture.peek) {
      gesture.peek = null
      gesture.peekDecision = ''
      this.onPeek(null)
    }
  }

  private moveVisual(gesture: Gesture, event: PointerEvent): void {
    if (!gesture.visualStarted) {
      gesture.visualStarted = true
      this.board.beginDrag(gesture.hit)
    }
    if (this.gesture === gesture) {
      this.board.moveDrag(event.clientX, event.clientY, gesture.pointerType !== 'mouse')
    }
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const gesture = this.gesture
    if (!gesture) {
      this.updateHover(event)
      return
    }
    if (event.pointerId !== gesture.pointerId) {
      return
    }
    if ((event.buttons & 1) === 0 || !this.inWindow(event) || !this.isCurrent(gesture)) {
      this.cancel()
      return
    }
    this.trackMovement(gesture, event)
  }

  private updateHover(event: PointerEvent): void {
    const view = this.getView()
    if (this.disposed || this.document.hidden || !view?.game || event.pointerType !== 'mouse'
      || event.buttons !== 0 || event.isPrimary === false || !this.inWindow(event) || this.isBlocked()) {
      this.clearHover()
      return
    }
    const hit = this.board.hitTest(event.clientX, event.clientY)
    if (!hit || !isVisibleSource(view, hit)) {
      this.clearHover()
      return
    }
    const decision = threeDecisionKey(view)
    if (this.hover && sameSource(hit, this.hover) && this.hoverDecision === decision) return
    this.hover = { ...hit }
    this.hoverDecision = decision
    this.onHover(this.hover)
  }

  private clearHover(): void {
    if (!this.hover) return
    this.hover = null
    this.hoverDecision = ''
    this.onHover(null)
  }

  private readonly onPointerLeave = (): void => {
    this.clearHover()
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    const gesture = this.gesture
    if (!gesture || event.pointerId !== gesture.pointerId || event.button !== 0) {
      return
    }
    if (!this.inWindow(event) || !this.isCurrent(gesture)) {
      this.cancel()
      return
    }
    // Account for the final coordinates even if the browser coalesced every move.
    this.trackMovement(gesture, event)
    if (this.gesture !== gesture) {
      return
    }
    const result = this.state.release({ id: event.pointerId })
    if (result === 'peeked') {
      // Releasing a peek only closes it: it never taps, selects, or submits.
      this.finish(false)
      return
    }
    const tap = gesture.playable
      ? result === 'tap' || (gesture.pointerType === 'mouse' && !gesture.moved)
      : !gesture.exceededTapThreshold
    // The same predicate, slop included, as the drag highlight.
    const drop = !tap && gesture.playable
      && this.board.containsDrop(event.clientX, event.clientY, gesture.pointerType !== 'mouse')

    // Restore the source before hit-testing a mouse tap or invoking re-entrant UI.
    this.finish(!tap && !drop)
    if (!this.isCurrent(gesture)) {
      return
    }
    if (drop) {
      this.playCard(gesture.hit.cardId)
    } else if (tap) {
      const hit = this.board.hitTest(event.clientX, event.clientY)
      if (hit && sameSource(hit, gesture.hit)) {
        this.activate(hit, gesture.pointerType)
      }
    }
  }

  private readonly onPointerLoss = (event: PointerEvent): void => {
    if (event.pointerId === this.gesture?.pointerId) {
      this.cancel()
    }
  }

  private readonly onWindowPointerUp = (event: PointerEvent): void => {
    if (event.button === 0 && event.target !== this.board.canvas) {
      this.onPointerLoss(event)
    }
  }

  private readonly onPointerOut = (event: PointerEvent): void => {
    if (event.relatedTarget === null) {
      this.clearHover()
      this.onPointerLoss(event)
    }
  }

  /**
   * A long press on the board never opens the system menu for touch or pen.
   * The latest press decides too, in case a browser reports its synthesized
   * menu event as a mouse one; a real right-click presses the mouse first.
   */
  private readonly onContextMenu = (event: Event): void => {
    const reported = 'pointerType' in event ? event.pointerType : ''
    if (reported === 'touch' || reported === 'pen' || this.lastPointerType !== 'mouse') {
      event.preventDefault()
    }
  }

  private readonly onBlur = (): void => {
    this.cancel()
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.cancel()
    }
  }

  private readonly onVisibilityChange = (): void => {
    if (this.document.hidden) {
      this.cancel()
    }
  }

  private finish(animateReturn: boolean): void {
    const gesture = this.gesture
    this.gesture = null
    this.state.complete()
    if (!gesture) {
      return
    }
    this.closePeek(gesture)
    // releasePointerCapture may synchronously emit lostpointercapture.
    try {
      if (this.board.canvas.hasPointerCapture(gesture.pointerId)) {
        this.board.canvas.releasePointerCapture(gesture.pointerId)
      }
    } catch {
      // The browser may already have released capture or detached the canvas.
    }
    if (gesture.visualStarted) {
      this.board.endDrag(animateReturn)
    }
  }
}
