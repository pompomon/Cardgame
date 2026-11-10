export type DragPointerType = 'mouse' | 'touch' | 'pen'

export const TOUCH_DRAG_THRESHOLD_PX = 12
/** A held touch or pen press shows its progress ring after this long, so quick taps show nothing. */
export const PEEK_RING_DELAY_MS = 150
/** A touch or pen press held this long within the drag threshold opens a peek. */
export const PEEK_HOLD_MS = 450

/** The timer the state machine schedules peeks with; injectable for tests. */
export interface DragTimers {
  setTimeout(callback: () => void, delay: number): unknown
  clearTimeout(handle: unknown): void
}

/** Resolves the global timers on each call, so fake timers installed later apply. */
const GLOBAL_TIMERS: DragTimers = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** Long-press callbacks for a touch or pen press. */
export interface DragPeekHandlers {
  /** The press has been held long enough to show its progress ring. */
  readonly ring?: () => void
  /** The hold elapsed within the threshold. Returns whether a peek opened. */
  readonly open: () => boolean
}

export interface DragPointerSnapshot {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly wasCanceled?: boolean
  readonly wasTouch?: boolean
  readonly event?: unknown
}

export type DragBeginResult = 'ignored' | 'pressed' | 'dragging'
export type DragMoveResult = 'ignored' | 'pressed' | 'peeking' | 'started' | 'dragging'
/** `peeked`: released while a peek was open, which is never a tap. */
export type DragReleaseResult = 'ignored' | 'tap' | 'peeked' | 'canceled' | 'drop'
export type DragStatePhase = 'idle' | 'pressed' | 'peeking' | 'dragging' | 'settling'

interface ActiveDragState {
  readonly pointerId: number
  readonly cardId: string
  readonly startX: number
  readonly startY: number
  readonly threshold: number
  phase: 'pressed' | 'peeking' | 'dragging'
  /** Pending ring and hold timers; empty once neither can fire. */
  readonly timers: unknown[]
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
  private readonly timers: DragTimers

  constructor(timers: DragTimers = GLOBAL_TIMERS) {
    this.timers = timers
  }

  get phase(): DragStatePhase {
    if (this.settling) {
      return 'settling'
    }
    return this.active?.phase ?? 'idle'
  }

  get activeCardId(): string | null {
    return this.active?.cardId ?? null
  }

  /**
   * Starts a gesture. A touch or pen press with `peek` handlers schedules its
   * ring and long-press peek; a mouse never peeks.
   */
  begin(pointer: DragPointerSnapshot, cardId: string, peek?: DragPeekHandlers): DragBeginResult {
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
    const phase = threshold === 0 ? 'dragging' : 'pressed'
    const active: ActiveDragState = {
      pointerId: pointer.id,
      cardId,
      startX: pointer.x,
      startY: pointer.y,
      threshold,
      phase,
      timers: [],
    }
    this.active = active
    if (phase === 'pressed' && peek) this.schedulePeek(active, peek)
    return phase
  }

  private schedulePeek(active: ActiveDragState, peek: DragPeekHandlers): void {
    const ring = peek.ring
    if (ring) {
      active.timers.push(this.timers.setTimeout(() => {
        if (this.active === active && active.phase === 'pressed') ring()
      }, PEEK_RING_DELAY_MS))
    }
    active.timers.push(this.timers.setTimeout(() => {
      if (this.active !== active || active.phase !== 'pressed') return
      this.clearTimers(active)
      active.phase = 'peeking'
      // Without a peek, the held press stays a tap.
      if (!peek.open() && this.active === active && active.phase === 'peeking') active.phase = 'pressed'
    }, PEEK_HOLD_MS))
  }

  private clearTimers(active: ActiveDragState | null): void {
    if (!active) return
    for (const handle of active.timers.splice(0)) this.timers.clearTimeout(handle)
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
      return active.phase
    }
    // Moving past the threshold closes a peek, or prevents one, and starts a drag.
    this.clearTimers(active)
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

    this.clearTimers(active)
    this.active = null
    this.settling = true
    if (pointer.wasCanceled === true) {
      return 'canceled'
    }
    return active.phase === 'dragging' ? 'drop' : active.phase === 'peeking' ? 'peeked' : 'tap'
  }

  cancel(): boolean {
    if (!this.active && !this.settling) {
      return false
    }
    this.clearTimers(this.active)
    this.active = null
    this.settling = true
    return true
  }

  complete(): void {
    this.clearTimers(this.active)
    this.active = null
    this.settling = false
  }
}
