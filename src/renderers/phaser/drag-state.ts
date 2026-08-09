export type DragPointerType = 'mouse' | 'touch' | 'pen'

export const TOUCH_DRAG_THRESHOLD_PX = 12

export interface DragPointerSnapshot {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly wasCanceled?: boolean
  readonly wasTouch?: boolean
  readonly event?: unknown
}

export type DragBeginResult = 'ignored' | 'pressed' | 'dragging'
export type DragMoveResult = 'ignored' | 'pressed' | 'started' | 'dragging'
export type DragReleaseResult = 'ignored' | 'tap' | 'canceled' | 'drop'
export type DragStatePhase = 'idle' | 'pressed' | 'dragging' | 'settling'

interface ActiveDragState {
  readonly pointerId: number
  readonly cardId: string
  readonly startX: number
  readonly startY: number
  readonly threshold: number
  phase: 'pressed' | 'dragging'
}

export function dragPointerType(
  pointer: Pick<DragPointerSnapshot, 'wasTouch' | 'event'>,
): DragPointerType {
  const event = pointer.event
  if (typeof event === 'object' && event !== null && 'pointerType' in event) {
    const pointerType = event.pointerType
    if (pointerType === 'mouse' || pointerType === 'touch' || pointerType === 'pen') {
      return pointerType
    }
  }
  return pointer.wasTouch === true ? 'touch' : 'mouse'
}

export function dragThresholdForPointer(pointerType: DragPointerType): number {
  return pointerType === 'mouse' ? 0 : TOUCH_DRAG_THRESHOLD_PX
}

export class DragStateMachine {
  private active: ActiveDragState | null = null
  private settling = false

  get phase(): DragStatePhase {
    if (this.settling) {
      return 'settling'
    }
    return this.active?.phase ?? 'idle'
  }

  get activeCardId(): string | null {
    return this.active?.cardId ?? null
  }

  begin(pointer: DragPointerSnapshot, cardId: string): DragBeginResult {
    if (
      this.active
      || this.settling
      || !Number.isInteger(pointer.id)
      || pointer.id < 0
      || !Number.isFinite(pointer.x)
      || !Number.isFinite(pointer.y)
      || cardId.length === 0
    ) {
      return 'ignored'
    }

    const threshold = dragThresholdForPointer(dragPointerType(pointer))
    this.active = {
      pointerId: pointer.id,
      cardId,
      startX: pointer.x,
      startY: pointer.y,
      threshold,
      phase: threshold === 0 ? 'dragging' : 'pressed',
    }
    return this.active.phase
  }

  move(pointer: Pick<DragPointerSnapshot, 'id' | 'x' | 'y'>): DragMoveResult {
    const active = this.active
    if (
      !active
      || active.pointerId !== pointer.id
      || !Number.isFinite(pointer.x)
      || !Number.isFinite(pointer.y)
    ) {
      return 'ignored'
    }
    if (active.phase === 'dragging') {
      return 'dragging'
    }

    const distance = Math.hypot(pointer.x - active.startX, pointer.y - active.startY)
    if (distance < active.threshold) {
      return 'pressed'
    }
    active.phase = 'dragging'
    return 'started'
  }

  release(
    pointer: Pick<DragPointerSnapshot, 'id' | 'wasCanceled'>,
  ): DragReleaseResult {
    const active = this.active
    if (!active || active.pointerId !== pointer.id) {
      return 'ignored'
    }

    this.active = null
    this.settling = true
    if (pointer.wasCanceled === true) {
      return 'canceled'
    }
    return active.phase === 'dragging' ? 'drop' : 'tap'
  }

  cancel(): boolean {
    if (!this.active && !this.settling) {
      return false
    }
    this.active = null
    this.settling = true
    return true
  }

  complete(): void {
    this.active = null
    this.settling = false
  }
}
