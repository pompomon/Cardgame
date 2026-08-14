import { durationMsForSpeed } from '../../app/animation-settings'
import { resolvePlayLandDrop } from '../../app/action-resolution'
import type { AnimationSpeed, GameUiState } from '../../app/types'
import type { GameAction } from '../../game/types'
import type Phaser from 'phaser'
import type { CardViewDragSource } from './card-view'
import { DEPTH_DRAG_PROXY } from './depth'
import {
  DragStateMachine,
  type DragPointerSnapshot,
  type DragStatePhase,
} from './drag-state'

const GAMEOBJECT_DOWN_EVENT = 'gameobjectdown'
const POINTER_MOVE_EVENT = 'pointermove'
const POINTER_UP_EVENT = 'pointerup'
const POINTER_UP_OUTSIDE_EVENT = 'pointerupoutside'
const GAME_OUT_EVENT = 'gameout'
const MAX_INVALID_DROP_RETURN_MS = 250

export type DragCancelReason =
  | 'game-change'
  | 'menu'
  | 'pointer-loss'
  | 'resize'
  | 'scene-shutdown'
  | 'source-invalid'
  | 'visibility'

export interface DragCardViewRegistry {
  getDragSource(object: Phaser.GameObjects.GameObject): CardViewDragSource | null
  beginDrag(container: Phaser.GameObjects.Container): boolean
  endDrag(container: Phaser.GameObjects.Container, animateToTarget: boolean): void
}

export interface DragControllerContext {
  readonly scene: Phaser.Scene
  readonly getCardViews: () => DragCardViewRegistry | null
  readonly getGame: () => GameUiState | null
  readonly getDropZone: () => Phaser.GameObjects.Zone | null
  readonly getAnimationSpeed: () => AnimationSpeed
  readonly shouldAnimate?: () => boolean
  readonly isInteractionBlocked: () => boolean
  readonly createProxy: (source: CardViewDragSource) => Phaser.GameObjects.Container | null
  readonly submitAction: (action: Extract<GameAction, { type: 'play_land' }>) => void
  readonly beginTargetSelection: (
    game: GameUiState,
    cardId: string,
    options: Array<{ effectTargetId?: string; label: string }>,
  ) => void
  readonly setStatus: (message: string) => void
  readonly onPointerMove?: (x: number, y: number) => void
  readonly onDragStateChange?: (cardId: string | null, phase: DragStatePhase) => void
}

function pointerSnapshot(pointer: Phaser.Input.Pointer): DragPointerSnapshot {
  return {
    id: pointer.id,
    x: Number.isFinite(pointer.worldX) ? pointer.worldX : pointer.x,
    y: Number.isFinite(pointer.worldY) ? pointer.worldY : pointer.y,
    wasCanceled: pointer.wasCanceled,
    wasTouch: pointer.wasTouch,
    event: pointer.event,
  }
}

export function invalidDropReturnDurationMs(speed: AnimationSpeed): number {
  return Math.min(durationMsForSpeed(speed), MAX_INVALID_DROP_RETURN_MS)
}

export function isPointInsideDropZone(
  zone: Pick<Phaser.GameObjects.Zone, 'active' | 'getBounds'> | null,
  x: number,
  y: number,
): boolean {
  if (!zone || zone.active === false || !Number.isFinite(x) || !Number.isFinite(y)) {
    return false
  }
  const bounds = zone.getBounds()
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
}

export class DragController {
  private readonly ctx: DragControllerContext
  private readonly state = new DragStateMachine()
  private source: CardViewDragSource | null = null
  private proxy: Phaser.GameObjects.Container | null = null
  private returnTween: Phaser.Tweens.Tween | null = null
  private pointerOffsetX = 0
  private pointerOffsetY = 0
  private destroyed = false

  constructor(ctx: DragControllerContext) {
    this.ctx = ctx
    ctx.scene.input.on(GAMEOBJECT_DOWN_EVENT, this.handlePointerDown)
    ctx.scene.input.on(POINTER_MOVE_EVENT, this.handlePointerMove)
    ctx.scene.input.on(POINTER_UP_EVENT, this.handlePointerUp)
    ctx.scene.input.on(POINTER_UP_OUTSIDE_EVENT, this.handlePointerUp)
    ctx.scene.input.on(GAME_OUT_EVENT, this.handleGameOut)
  }

  get phase(): DragStatePhase {
    return this.state.phase
  }

  get activeCardId(): string | null {
    return this.state.activeCardId
  }

  cancel(_reason: DragCancelReason): boolean {
    if (!this.state.cancel() && !this.source && !this.proxy && !this.returnTween) {
      return false
    }
    this.finishImmediately()
    return true
  }

  reconcile(): void {
    if (this.source && !this.isCurrentSource(this.source)) {
      this.cancel('source-invalid')
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    this.ctx.scene.input.off(GAMEOBJECT_DOWN_EVENT, this.handlePointerDown)
    this.ctx.scene.input.off(POINTER_MOVE_EVENT, this.handlePointerMove)
    this.ctx.scene.input.off(POINTER_UP_EVENT, this.handlePointerUp)
    this.ctx.scene.input.off(POINTER_UP_OUTSIDE_EVENT, this.handlePointerUp)
    this.ctx.scene.input.off(GAME_OUT_EVENT, this.handleGameOut)
    this.cancel('scene-shutdown')
  }

  private readonly handlePointerDown = (
    pointer: Phaser.Input.Pointer,
    object: Phaser.GameObjects.GameObject,
  ): void => {
    if (this.destroyed || this.ctx.isInteractionBlocked()) {
      return
    }
    const source = this.ctx.getCardViews()?.getDragSource(object) ?? null
    if (!source) {
      return
    }
    const snapshot = pointerSnapshot(pointer)
    const result = this.state.begin(snapshot, source.cardId)
    if (result === 'ignored') {
      return
    }

    this.source = source
    this.pointerOffsetX = source.container.x - snapshot.x
    this.pointerOffsetY = source.container.y - snapshot.y
    if (result === 'dragging') {
      this.activateDrag(snapshot)
    }
  }

  private readonly handlePointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (this.destroyed) {
      return
    }
    const snapshot = pointerSnapshot(pointer)
    const result = this.state.move(snapshot)
    if (result === 'ignored' || result === 'pressed') {
      return
    }
    if (!this.source) {
      this.cancel('source-invalid')
      return
    }
    if (result === 'started') {
      if (!this.isCurrentSource(this.source) || !this.activateDrag(snapshot)) {
        return
      }
    }
    this.proxy?.setPosition(
      snapshot.x + this.pointerOffsetX,
      snapshot.y + this.pointerOffsetY,
    )
    this.ctx.onPointerMove?.(snapshot.x, snapshot.y)
  }

  private readonly handlePointerUp = (pointer: Phaser.Input.Pointer): void => {
    if (this.destroyed) {
      return
    }
    const snapshot = pointerSnapshot(pointer)
    const result = this.state.release(snapshot)
    if (result === 'ignored') {
      return
    }
    if (result === 'tap') {
      this.source = null
      this.state.complete()
      return
    }
    if (
      result === 'canceled'
      || this.ctx.isInteractionBlocked()
      || !this.source
      || !this.isCurrentSource(this.source)
    ) {
      this.finishImmediately()
      return
    }

    const zone = this.ctx.getDropZone()
    if (!isPointInsideDropZone(zone, snapshot.x, snapshot.y)) {
      this.returnInvalidDrop()
      return
    }
    const game = this.ctx.getGame()
    if (!game) {
      this.returnInvalidDrop()
      return
    }

    const source = this.source
    const resolution = resolvePlayLandDrop(game, source.cardId)
    if (resolution.kind === 'invalid') {
      this.ctx.setStatus('Invalid drop. Choose a playable card.')
      this.returnInvalidDrop()
      return
    }
    if (resolution.kind === 'single') {
      const action = resolution.action
      this.finishImmediately()
      this.ctx.submitAction(action)
      return
    }

    const options = resolution.options
    this.finishImmediately()
    this.ctx.beginTargetSelection(game, source.cardId, options)
  }

  private readonly handleGameOut = (): void => {
    this.cancel('pointer-loss')
  }

  private activateDrag(pointer: DragPointerSnapshot): boolean {
    const source = this.source
    const cardViews = this.ctx.getCardViews()
    if (
      !source
      || !cardViews
      || !this.isCurrentSource(source)
      || !cardViews.beginDrag(source.container)
    ) {
      this.cancel('source-invalid')
      return false
    }
    const proxy = this.ctx.createProxy(source)
    if (!proxy) {
      this.cancel('source-invalid')
      return false
    }
    this.proxy = proxy
    proxy
      .setDepth(DEPTH_DRAG_PROXY)
      .setPosition(
        pointer.x + this.pointerOffsetX,
        pointer.y + this.pointerOffsetY,
      )
    this.ctx.onPointerMove?.(pointer.x, pointer.y)
    this.notifyDragStateChange()
    return true
  }

  private isCurrentSource(source: CardViewDragSource): boolean {
    const current = this.ctx.getCardViews()?.getDragSource(source.container) ?? null
    return current?.cardId === source.cardId
  }

  private returnInvalidDrop(): void {
    const proxy = this.proxy
    const source = this.source
    const duration = this.ctx.shouldAnimate?.() === false
      ? 0
      : invalidDropReturnDurationMs(this.ctx.getAnimationSpeed())
    if (!proxy || !source || duration === 0 || !this.isCurrentSource(source)) {
      this.finishImmediately()
      return
    }

    this.returnTween?.remove()
    const tween = this.ctx.scene.tweens.add({
      targets: proxy,
      x: source.container.x,
      y: source.container.y,
      duration,
      ease: 'Cubic.Out',
      onComplete: () => {
        if (this.returnTween !== tween) {
          return
        }
        this.returnTween = null
        this.finishImmediately()
      },
    })
    this.returnTween = tween
  }

  private finishImmediately(): void {
    this.returnTween?.remove()
    this.returnTween = null
    this.proxy?.destroy(true)
    this.proxy = null
    if (this.source) {
      this.ctx.getCardViews()?.endDrag(this.source.container, false)
    }
    this.source = null
    this.pointerOffsetX = 0
    this.pointerOffsetY = 0
    this.state.complete()
    this.notifyDragStateChange()
  }

  private notifyDragStateChange(): void {
    this.ctx.onDragStateChange?.(this.state.activeCardId, this.state.phase)
  }
}
