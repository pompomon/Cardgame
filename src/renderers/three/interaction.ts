import { resolvePlayLandDrop } from '../../app/action-resolution'
import { shouldHideHandFromViewer } from '../../app/game-presentation'
import { HIDDEN_HAND_CARD_NAME, type AppViewModel } from '../../app/types'
import {
  DragStateMachine,
  dragPointerType,
  TOUCH_DRAG_THRESHOLD_PX,
  type DragPointerSnapshot,
  type DragPointerType,
} from '../shared/drag-state'
import type { BoardHit, ThreeBoardApi } from './contracts'
import { threeDecisionKey } from './interface-model'

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
  private readonly activate: (hit: BoardHit) => void
  private readonly onHover: (hit: BoardHit | null) => void
  private readonly document: Document
  private readonly window: Window | null
  private readonly state = new DragStateMachine()
  private gesture: Gesture | null = null
  private hover: BoardHit | null = null
  private hoverDecision = ''
  private disposed = false

  constructor(
    board: ThreeBoardApi,
    getView: () => AppViewModel | null,
    isBlocked: () => boolean,
    playCard: (cardId: string) => void,
    activate: (hit: BoardHit) => void,
    onHover: (hit: BoardHit | null) => void = () => {},
  ) {
    this.board = board
    this.getView = getView
    this.isBlocked = isBlocked
    this.playCard = playCard
    this.activate = activate
    this.onHover = onHover
    this.document = board.canvas.ownerDocument
    this.window = this.document.defaultView
    board.canvas.addEventListener('pointerdown', this.onPointerDown)
    board.canvas.addEventListener('pointermove', this.onPointerMove)
    board.canvas.addEventListener('pointerleave', this.onPointerLeave)
    board.canvas.addEventListener('pointerup', this.onPointerUp)
    board.canvas.addEventListener('pointercancel', this.onPointerLoss)
    board.canvas.addEventListener('lostpointercapture', this.onPointerLoss)
    this.window?.addEventListener('pointerup', this.onWindowPointerUp)
    this.window?.addEventListener('pointercancel', this.onPointerLoss)
    this.window?.addEventListener('pointerout', this.onPointerOut)
    this.window?.addEventListener('blur', this.onBlur)
    this.window?.addEventListener('keydown', this.onKeyDown)
    this.document.addEventListener('visibilitychange', this.onVisibilityChange)
  }

  reconcile(): void {
    if (this.gesture && !this.isCurrent(this.gesture)) {
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

  private inWindow(event: PointerEvent): boolean {
    return Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
      && event.clientX >= 0 && event.clientY >= 0
      && (!this.window || (
        event.clientX < this.window.innerWidth && event.clientY < this.window.innerHeight
      ))
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.clearHover()
    if (this.disposed || this.gesture || event.button !== 0
      || event.isPrimary === false || this.document.hidden || !this.inWindow(event)) {
      return
    }
    const view = this.getView()
    const hit = this.board.hitTest(event.clientX, event.clientY)
    if (!view?.game || !hit || !isVisibleSource(view, hit)
      || (hit.zone !== 'battlefield' && this.isBlocked())) {
      return
    }
    const pointer = snapshot(event)
    const result = this.state.begin(pointer, hit.cardId)
    if (result === 'ignored') {
      return
    }
    const gesture: Gesture = {
      pointerId: event.pointerId,
      pointerType: dragPointerType(pointer),
      hit: { ...hit },
      context: contextKey(view),
      playable: isPlayable(view, hit),
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      exceededTapThreshold: false,
      visualStarted: false,
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
    if (gesture.playable && (result === 'started' || result === 'dragging')) {
      this.moveVisual(gesture, event)
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
    const tap = gesture.playable
      ? result === 'tap' || (gesture.pointerType === 'mouse' && !gesture.moved)
      : !gesture.exceededTapThreshold
    const drop = !tap && gesture.playable
      && this.board.containsDrop(event.clientX, event.clientY)

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
        this.activate(hit)
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
