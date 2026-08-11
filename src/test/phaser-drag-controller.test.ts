import { describe, expect, it, vi } from 'vitest'
import type { GameUiState } from '../app/types'
import type { GameAction } from '../game/types'
import type { CardViewDragSource } from '../renderers/phaser/card-view'
import {
  DragController,
  invalidDropReturnDurationMs,
  isPointInsideDropZone,
  type DragCancelReason,
  type DragControllerContext,
} from '../renderers/phaser/drag-controller'
import { DEPTH_DRAG_PROXY } from '../renderers/phaser/depth'
import { TOUCH_DRAG_THRESHOLD_PX } from '../renderers/phaser/drag-state'

type Listener = (...args: never[]) => void

class FakeEmitter {
  readonly listeners = new Map<string, Listener[]>()

  on(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
    return this
  }

  off(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? []
    const remaining = listeners.filter((entry) => entry !== listener)
    if (remaining.length === 0) {
      this.listeners.delete(event)
    } else {
      this.listeners.set(event, remaining)
    }
    return this
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      listener(...args as never[])
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0
  }
}

class FakeContainer {
  x: number
  y: number
  depth = 0
  destroyed = false
  positionUpdates = 0

  constructor(x = 0, y = 0) {
    this.x = x
    this.y = y
  }

  setPosition(x: number, y: number): this {
    this.x = x
    this.y = y
    this.positionUpdates += 1
    return this
  }

  setDepth(depth: number): this {
    this.depth = depth
    return this
  }

  destroy(): void {
    this.destroyed = true
  }
}

interface FakePointer {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly worldX: number
  readonly worldY: number
  readonly wasCanceled: boolean
  readonly wasTouch: boolean
  readonly event: { readonly pointerType: 'mouse' | 'touch' | 'pen' }
}

interface TweenRecord {
  readonly config: {
    readonly targets: FakeContainer
    readonly x: number
    readonly y: number
    readonly duration: number
    readonly onComplete?: () => void
  }
  readonly remove: ReturnType<typeof vi.fn>
  complete: () => void
}

interface Harness {
  readonly controller: DragController
  readonly input: FakeEmitter
  readonly source: CardViewDragSource
  readonly registry: {
    sourceAvailable: boolean
    dragging: boolean
    beginDrag: ReturnType<typeof vi.fn>
    endDrag: ReturnType<typeof vi.fn>
    getDragSource: ReturnType<typeof vi.fn>
  }
  readonly proxies: FakeContainer[]
  readonly createProxy: ReturnType<typeof vi.fn>
  readonly submitted: GameAction[]
  readonly targetSelections: Array<{
    game: GameUiState
    cardId: string
    options: Array<{ effectTargetId?: string; label: string }>
  }>
  readonly statuses: string[]
  readonly feedbackEvents: string[]
  readonly tweens: TweenRecord[]
  readonly setBlocked: (blocked: boolean) => void
  readonly setGame: (game: GameUiState | null) => void
  readonly setAnimationSpeed: (speed: 'off' | 'fast' | 'normal' | 'slow') => void
}

const playAction = {
  type: 'play_land',
  actor: 0,
  cardId: 'hand-card',
} as const

function gameWithOptions(
  options: GameUiState['legal']['playLandByCard']['hand-card'] = [{
    action: playAction,
    label: 'Play Forest',
  }],
): GameUiState {
  return {
    turn: 1,
    phase: 'main',
    winnerText: '',
    actor: 0,
    actorControl: 'human',
    canInput: true,
    pendingLandName: null,
    pendingPlainsReuseName: null,
    players: [
      {
        id: 0,
        handCount: 1,
        deckCount: 10,
        graveyardCount: 0,
        handCards: [{ id: 'hand-card', name: 'Forest' }],
        graveyardCards: [],
        battlefield: [],
      },
      {
        id: 1,
        handCount: 0,
        deckCount: 10,
        graveyardCount: 0,
        handCards: [],
        graveyardCards: [],
        battlefield: [],
      },
    ],
    legal: {
      playLandByCard: options.length > 0 ? { 'hand-card': options } : {},
      counterOptions: [],
      swampDiscardOptions: [],
      plainsReuseOptions: [],
      canEndTurn: true,
      canPassResponse: false,
    },
    log: [],
    events: [],
    isReplay: false,
    revealedEnemyHandForSwamp: null,
  }
}

function pointer(
  id: number,
  x: number,
  y: number,
  pointerType: 'mouse' | 'touch' | 'pen' = 'mouse',
  wasCanceled = false,
): FakePointer {
  return {
    id,
    x,
    y,
    worldX: x,
    worldY: y,
    wasCanceled,
    wasTouch: pointerType === 'touch',
    event: { pointerType },
  }
}

function createHarness(): Harness {
  const input = new FakeEmitter()
  const sourceContainer = new FakeContainer(80, 600)
  const source: CardViewDragSource = {
    cardId: 'hand-card',
    name: 'Forest',
    width: 80,
    height: 112,
    container: sourceContainer as never,
  }
  const registry = {
    sourceAvailable: true,
    dragging: false,
    beginDrag: vi.fn(() => {
      registry.dragging = true
      return true
    }),
    endDrag: vi.fn(() => {
      registry.dragging = false
    }),
    getDragSource: vi.fn((object: unknown) => (
      registry.sourceAvailable && object === sourceContainer ? source : null
    )),
  }
  const proxies: FakeContainer[] = []
  const createProxy = vi.fn(() => {
    const proxy = new FakeContainer()
    proxies.push(proxy)
    return proxy
  })
  const submitted: GameAction[] = []
  const targetSelections: Harness['targetSelections'] = []
  const statuses: string[] = []
  const feedbackEvents: string[] = []
  const tweens: TweenRecord[] = []
  let blocked = false
  let game: GameUiState | null = gameWithOptions()
  let animationSpeed: 'off' | 'fast' | 'normal' | 'slow' = 'normal'
  const scene = {
    input,
    tweens: {
      add: (config: TweenRecord['config']) => {
        const record: TweenRecord = {
          config,
          remove: vi.fn(),
          complete: () => {
            config.targets.setPosition(config.x, config.y)
            config.onComplete?.()
          },
        }
        tweens.push(record)
        return record
      },
    },
  }
  const context: DragControllerContext = {
    scene: scene as never,
    getCardViews: () => registry as never,
    getGame: () => game,
    getDropZone: () => ({
      active: true,
      getBounds: () => ({ left: 300, right: 600, top: 100, bottom: 450 }),
    }) as never,
    getAnimationSpeed: () => animationSpeed,
    isInteractionBlocked: () => blocked,
    createProxy: createProxy as never,
    submitAction: (action) => {
      submitted.push(action)
    },
    beginTargetSelection: (selectionGame, cardId, options) => {
      targetSelections.push({ game: selectionGame, cardId, options })
    },
    setStatus: (status) => {
      statuses.push(status)
    },
    onPointerMove: (x, y) => {
      feedbackEvents.push(`pointer:${x},${y}`)
    },
    onDragStateChange: () => {
      feedbackEvents.push('drag')
    },
  }
  return {
    controller: new DragController(context),
    input,
    source,
    registry,
    proxies,
    createProxy,
    submitted,
    targetSelections,
    statuses,
    feedbackEvents,
    tweens,
    setBlocked: (value) => {
      blocked = value
    },
    setGame: (value) => {
      game = value
    },
    setAnimationSpeed: (value) => {
      animationSpeed = value
    },
  }
}

function start(
  harness: Harness,
  inputPointer = pointer(1, 80, 600),
): void {
  harness.input.emit('gameobjectdown', inputPointer, harness.source.container)
}

describe('DragController', () => {
  it('submits one app-projected action after a mouse release outside the source', () => {
    const harness = createHarness()
    start(harness)
    expect(harness.controller.phase).toBe('dragging')
    expect(harness.registry.beginDrag).toHaveBeenCalledOnce()
    expect(harness.proxies[0]).toMatchObject({ depth: DEPTH_DRAG_PROXY })

    harness.input.emit('pointermove', pointer(1, 420, 220))
    harness.input.emit('pointerup', pointer(1, 420, 220))
    harness.input.emit('pointerup', pointer(1, 420, 220))

    expect(harness.submitted).toEqual([playAction])
    expect(harness.submitted[0]).toBe(playAction)
    expect(harness.registry.endDrag).toHaveBeenCalledOnce()
    expect(harness.proxies[0].destroyed).toBe(true)
    expect(harness.controller.phase).toBe('idle')
  })

  it('seeds pointer feedback before reporting an immediately-started mouse drag', () => {
    const harness = createHarness()

    start(harness, pointer(1, 420, 220))

    expect(harness.feedbackEvents).toEqual(['pointer:420,220', 'drag'])
  })

  it('keeps touch taps below threshold and starts touch drags above it', () => {
    const harness = createHarness()
    start(harness, pointer(3, 80, 600, 'touch'))
    harness.input.emit(
      'pointermove',
      pointer(3, 80 + TOUCH_DRAG_THRESHOLD_PX - 1, 600, 'touch'),
    )
    expect(harness.controller.phase).toBe('pressed')
    expect(harness.createProxy).not.toHaveBeenCalled()
    harness.input.emit('pointerup', pointer(3, 85, 600, 'touch'))
    expect(harness.submitted).toEqual([])

    start(harness, pointer(4, 80, 600, 'touch'))
    harness.input.emit('pointermove', pointer(4, 420, 220, 'touch'))
    expect(harness.registry.beginDrag).toHaveBeenCalledOnce()
    expect(harness.createProxy).toHaveBeenCalledOnce()
    harness.input.emit('pointerup', pointer(4, 420, 220, 'touch'))
    expect(harness.submitted).toEqual([playAction])
  })

  it('ignores overlapping pointers until the active pointer completes', () => {
    const harness = createHarness()
    start(harness, pointer(1, 80, 600, 'touch'))
    harness.input.emit('pointermove', pointer(1, 100, 600, 'touch'))
    start(harness, pointer(2, 80, 600, 'touch'))
    harness.input.emit('pointermove', pointer(2, 420, 220, 'touch'))
    harness.input.emit('pointerup', pointer(2, 420, 220, 'touch'))

    expect(harness.createProxy).toHaveBeenCalledOnce()
    expect(harness.submitted).toEqual([])

    harness.input.emit('pointermove', pointer(1, 420, 220, 'touch'))
    harness.input.emit('pointerup', pointer(1, 420, 220, 'touch'))
    expect(harness.submitted).toEqual([playAction])
  })

  it('returns invalid drops with a bounded tween and blocks overlapping drags', () => {
    const harness = createHarness()
    start(harness)
    harness.input.emit('pointermove', pointer(1, 200, 500))
    harness.input.emit('pointerupoutside', pointer(1, 200, 500))

    expect(harness.controller.phase).toBe('settling')
    expect(harness.tweens).toHaveLength(1)
    expect(harness.tweens[0].config).toMatchObject({
      x: 80,
      y: 600,
      duration: 250,
    })
    expect(harness.registry.dragging).toBe(true)
    start(harness, pointer(2, 80, 600))
    expect(harness.createProxy).toHaveBeenCalledOnce()

    harness.tweens[0].complete()
    expect(harness.proxies[0].destroyed).toBe(true)
    expect(harness.registry.dragging).toBe(false)
    expect(harness.controller.phase).toBe('idle')
    expect(harness.submitted).toEqual([])
  })

  it('cleans up canceled pointers before a later pointer-up can submit', () => {
    const harness = createHarness()
    start(harness)
    harness.input.emit('pointerup', pointer(1, 420, 220, 'touch', true))
    harness.input.emit('pointerup', pointer(1, 420, 220))

    expect(harness.submitted).toEqual([])
    expect(harness.tweens).toEqual([])
    expect(harness.registry.endDrag).toHaveBeenCalledOnce()
    expect(harness.proxies[0].destroyed).toBe(true)
  })

  it('routes multi-option legal drops to existing target selection without submitting', () => {
    const harness = createHarness()
    const options: GameUiState['legal']['playLandByCard']['hand-card'] = [
      {
        action: { ...playAction, effectTargetId: 'target-1' },
        label: 'Target 1',
      },
      {
        action: { ...playAction, effectTargetId: 'target-2' },
        label: 'Target 2',
      },
    ]
    const game = gameWithOptions(options)
    harness.setGame(game)
    start(harness)
    harness.input.emit('pointerup', pointer(1, 420, 220))

    expect(harness.submitted).toEqual([])
    expect(harness.targetSelections).toEqual([{
      game,
      cardId: 'hand-card',
      options: [
        { effectTargetId: 'target-1', label: 'Target 1' },
        { effectTargetId: 'target-2', label: 'Target 2' },
      ],
    }])
  })

  it('rejects stale legal state and restores the source', () => {
    const harness = createHarness()
    harness.setGame(gameWithOptions([]))
    start(harness)
    harness.input.emit('pointerup', pointer(1, 420, 220))

    expect(harness.submitted).toEqual([])
    expect(harness.statuses).toEqual(['Invalid drop. Choose a playable card.'])
    expect(harness.tweens).toHaveLength(1)
    harness.tweens[0].complete()
    expect(harness.registry.endDrag).toHaveBeenCalledOnce()
  })

  it('cancels on lifecycle boundaries and pointer loss', () => {
    const harness = createHarness()
    const reasons: DragCancelReason[] = ['resize', 'visibility', 'menu', 'game-change']
    for (let index = 0; index < reasons.length; index += 1) {
      const activePointer = pointer(index + 1, 80, 600)
      start(harness, activePointer)
      expect(harness.controller.cancel(reasons[index])).toBe(true)
      harness.input.emit('pointerup', pointer(activePointer.id, 420, 220))
      expect(harness.controller.phase).toBe('idle')
    }
    start(harness, pointer(20, 80, 600))
    harness.input.emit('gameout')
    harness.input.emit('pointerup', pointer(20, 420, 220))

    expect(harness.controller.phase).toBe('idle')
    expect(harness.submitted).toEqual([])
    expect(harness.registry.endDrag).toHaveBeenCalledTimes(reasons.length + 1)
    expect(harness.proxies.every((proxy) => proxy.destroyed)).toBe(true)
  })

  it('cancels when reconciliation finds a removed or non-draggable source', () => {
    const harness = createHarness()
    start(harness)
    harness.registry.sourceAvailable = false
    harness.controller.reconcile()

    expect(harness.controller.phase).toBe('idle')
    expect(harness.registry.endDrag).toHaveBeenCalledOnce()
    expect(harness.proxies[0].destroyed).toBe(true)
  })

  it('updates one retained proxy across repeated pointer moves', () => {
    const harness = createHarness()
    start(harness)
    for (let index = 0; index < 1_000; index += 1) {
      harness.input.emit('pointermove', pointer(1, 100 + index, 500))
    }

    expect(harness.createProxy).toHaveBeenCalledOnce()
    expect(harness.proxies).toHaveLength(1)
    expect(harness.proxies[0].positionUpdates).toBe(1_001)
    harness.controller.cancel('resize')
  })

  it('removes every input listener and active object idempotently on destroy', () => {
    const harness = createHarness()
    start(harness)
    expect([
      'gameobjectdown',
      'pointermove',
      'pointerup',
      'pointerupoutside',
      'gameout',
    ].map((event) => harness.input.listenerCount(event))).toEqual([1, 1, 1, 1, 1])

    harness.controller.destroy()
    harness.controller.destroy()

    expect([
      'gameobjectdown',
      'pointermove',
      'pointerup',
      'pointerupoutside',
      'gameout',
    ].map((event) => harness.input.listenerCount(event))).toEqual([0, 0, 0, 0, 0])
    expect(harness.proxies[0].destroyed).toBe(true)
    expect(harness.registry.endDrag).toHaveBeenCalledOnce()
  })
})

describe('drag controller helpers', () => {
  it('bounds invalid-drop return duration and respects disabled animation', () => {
    expect(invalidDropReturnDurationMs('off')).toBe(0)
    expect(invalidDropReturnDurationMs('fast')).toBe(150)
    expect(invalidDropReturnDurationMs('normal')).toBe(250)
    expect(invalidDropReturnDurationMs('slow')).toBe(250)
  })

  it('uses explicit bounds without relying on renderer masks', () => {
    const zone = {
      active: true,
      getBounds: () => ({ left: 10, right: 20, top: 30, bottom: 40 }),
    }
    expect(isPointInsideDropZone(zone as never, 10, 30)).toBe(true)
    expect(isPointInsideDropZone(zone as never, 20, 40)).toBe(true)
    expect(isPointInsideDropZone(zone as never, 9, 30)).toBe(false)
    expect(isPointInsideDropZone({ ...zone, active: false } as never, 15, 35)).toBe(false)
  })
})
