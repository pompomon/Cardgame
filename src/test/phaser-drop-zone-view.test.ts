import { describe, expect, it } from 'vitest'
import type { GameUiState } from '../app/types'
import {
  BOARD_UI_ATLAS_TEXTURE_KEY,
  DropZoneView,
} from '../renderers/phaser/drop-zone-view'
import {
  buildInteractionFeedbackModel,
  interactionFeedbackStyle,
  type InteractionFeedbackCard,
} from '../renderers/phaser/interaction-feedback'
import { buildLayout } from '../renderers/phaser/layout'

class FakeDisplayObject {
  x = 0
  y = 0
  width = 0
  height = 0
  visible = true
  active = true
  alpha = 1
  tint = 0xffffff
  fillColor = 0
  fillAlpha = 0
  strokeColor = 0
  strokeAlpha = 0
  strokeWidth = 0
  text = ''
  color = ''
  frame = ''
  destroyed = false

  setPosition(x: number, y: number): this {
    this.x = x
    this.y = y
    return this
  }

  setDisplaySize(width: number, height: number): this {
    this.width = width
    this.height = height
    return this
  }

  setSize(width: number, height: number): this {
    return this.setDisplaySize(width, height)
  }

  setVisible(visible: boolean): this {
    this.visible = visible
    return this
  }

  setActive(active: boolean): this {
    this.active = active
    return this
  }

  setAlpha(alpha: number): this {
    this.alpha = alpha
    return this
  }

  setTint(tint: number): this {
    this.tint = tint
    return this
  }

  setFillStyle(color: number, alpha: number): this {
    this.fillColor = color
    this.fillAlpha = alpha
    return this
  }

  setStrokeStyle(width: number, color: number, alpha: number): this {
    this.strokeWidth = width
    this.strokeColor = color
    this.strokeAlpha = alpha
    return this
  }

  setText(text: string): this {
    this.text = text
    return this
  }

  setColor(color: string): this {
    this.color = color
    return this
  }

  setFrame(frame: string): this {
    this.frame = frame
    return this
  }

  setOrigin(): this { return this }
  setFontSize(): this { return this }
  setWordWrapWidth(): this { return this }

  destroy(): void {
    this.destroyed = true
  }
}

class FakeContainer extends FakeDisplayObject {
  readonly children: FakeDisplayObject[] = []

  setDepth(): this { return this }

  add(children: FakeDisplayObject | FakeDisplayObject[]): this {
    this.children.push(...(Array.isArray(children) ? children : [children]))
    return this
  }

  override destroy(destroyChildren = false): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    if (destroyChildren) {
      for (const child of this.children) {
        child.destroy()
      }
    }
  }
}

interface Harness {
  readonly scene: object
  readonly created: FakeDisplayObject[]
  readonly rectangles: FakeDisplayObject[]
  readonly images: FakeDisplayObject[]
  readonly zones: FakeDisplayObject[]
}

function createHarness(atlasLoaded = false): Harness {
  const created: FakeDisplayObject[] = []
  const rectangles: FakeDisplayObject[] = []
  const images: FakeDisplayObject[] = []
  const zones: FakeDisplayObject[] = []
  const register = <T extends FakeDisplayObject>(object: T): T => {
    created.push(object)
    return object
  }
  const scene = {
    add: {
      container: (
        _x = 0,
        _y = 0,
        children: FakeDisplayObject[] = [],
      ) => register(new FakeContainer()).add(children),
      rectangle: () => {
        const object = register(new FakeDisplayObject())
        rectangles.push(object)
        return object
      },
      image: (
        _x: number,
        _y: number,
        _texture: string,
        frame: string,
      ) => {
        const object = register(new FakeDisplayObject()).setFrame(frame)
        images.push(object)
        return object
      },
      text: () => register(new FakeDisplayObject()),
      zone: () => {
        const object = register(new FakeDisplayObject())
        zones.push(object)
        return object
      },
    },
    textures: {
      exists: (key: string) => atlasLoaded && key === BOARD_UI_ATLAS_TEXTURE_KEY,
      get: () => ({
        has: (frame: string) => [
          'zone-outline',
          'target-ring',
          'selection-glow',
        ].includes(frame),
      }),
    },
  }
  return { scene, created, rectangles, images, zones }
}

const layout = buildLayout(1280, 720, 'horizontal')

function game(playableCardId: string | null = 'forest'): GameUiState {
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
        handCards: [{ id: 'forest', name: 'Forest' }],
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
      playLandByCard: playableCardId
        ? {
            [playableCardId]: [{
              action: {
                type: 'play_land',
                actor: 0,
                cardId: playableCardId,
              },
              label: 'Play Forest',
            }],
          }
        : {},
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

function card(
  cardId = 'forest',
  overrides: Partial<InteractionFeedbackCard> = {},
): InteractionFeedbackCard {
  return {
    cardId,
    instanceId: null,
    zone: 'hand',
    x: 360,
    y: layout.handCardsY,
    width: layout.handCardWidth,
    height: layout.handCardHeight,
    highlight: false,
    draggable: true,
    ...overrides,
  }
}

function model(
  playableCardId: string | null = 'forest',
  cards: readonly InteractionFeedbackCard[] = [card()],
) {
  return buildInteractionFeedbackModel({
    game: game(playableCardId),
    cards,
    layout,
    presentedActor: 0,
  })
}

describe('retained Phaser drop-zone view', () => {
  it('keeps area, hit-zone, label, and marker identities across unchanged syncs', () => {
    const harness = createHarness(true)
    const view = new DropZoneView({ scene: harness.scene as never })
    const initialObjects = harness.created.length

    view.sync(model(), layout)
    const objectsAfterFirstSync = harness.created.length
    const marker = view.getMarkerContainer('hand:forest')
    view.sync(model(), layout)

    expect(harness.created.length).toBe(objectsAfterFirstSync)
    expect(objectsAfterFirstSync).toBeGreaterThan(initialObjects)
    expect(view.getMarkerContainer('hand:forest')).toBe(marker)
    expect(view.activeMarkerCount).toBe(1)
    expect(harness.zones).toHaveLength(1)
    expect(harness.images.map((image) => image.frame)).toEqual(
      expect.arrayContaining(['zone-outline', 'selection-glow']),
    )
  })

  it('pools removed marker visuals and reuses them for new legal cards', () => {
    const harness = createHarness()
    const view = new DropZoneView({ scene: harness.scene as never })
    view.sync(model(), layout)
    const marker = view.getMarkerContainer('hand:forest')
    const allocated = harness.created.length

    view.sync(model(null, [card('forest', { draggable: false })]), layout)
    expect(view.activeMarkerCount).toBe(0)
    expect(view.pooledMarkerCount).toBe(1)

    view.sync(model('island', [card('island')]), layout)
    expect(harness.created.length).toBe(allocated)
    expect(view.getMarkerContainer('hand:island')).toBe(marker)
    expect(view.pooledMarkerCount).toBe(0)
  })

  it('shows valid, hover, selected, invalid, and disabled feedback states', () => {
    const harness = createHarness()
    const view = new DropZoneView({ scene: harness.scene as never })
    view.sync(model(), layout)
    const battlefieldFill = harness.rectangles[0]
    const handFill = harness.rectangles[1]
    const center = model().battlefield.bounds

    expect(battlefieldFill.strokeColor).toBe(
      interactionFeedbackStyle('valid').strokeColor,
    )
    view.updateDrag('pressed', 'forest', 360, layout.handCardsY)
    expect(handFill.strokeColor).toBe(
      interactionFeedbackStyle('selected').strokeColor,
    )
    view.updateDrag('dragging', 'forest', center.x, center.y)
    expect(battlefieldFill.strokeColor).toBe(
      interactionFeedbackStyle('hover').strokeColor,
    )
    view.updateDrag('settling', 'forest', 0, 0)
    expect(battlefieldFill.strokeColor).toBe(
      interactionFeedbackStyle('invalid').strokeColor,
    )

    view.updateDrag('idle', null, 0, 0)
    view.sync(model(null, [card('forest', { draggable: false })]), layout)
    expect(battlefieldFill.strokeColor).toBe(
      interactionFeedbackStyle('disabled').strokeColor,
    )
  })

  it('allocates no Phaser display objects across repeated pointer updates', () => {
    const harness = createHarness(true)
    const view = new DropZoneView({ scene: harness.scene as never })
    view.sync(model(), layout)
    const allocations = harness.created.length

    for (let index = 0; index < 1_000; index += 1) {
      view.updateDrag('dragging', 'forest', 100 + index, 300)
    }

    expect(harness.created.length).toBe(allocations)
    expect(view.activeMarkerCount).toBe(1)
  })

  it('blocks hit testing and visuals behind modal interaction, then restores them', () => {
    const harness = createHarness()
    const view = new DropZoneView({ scene: harness.scene as never })
    view.sync(model(), layout)
    const zone = harness.zones[0]

    expect(zone.active).toBe(true)
    expect((view.layer as unknown as FakeContainer).visible).toBe(true)
    view.setBlocked(true)
    expect(zone.active).toBe(false)
    expect((view.layer as unknown as FakeContainer).visible).toBe(false)
    view.setBlocked(false)
    expect(zone.active).toBe(true)
    expect((view.layer as unknown as FakeContainer).visible).toBe(true)
  })

  it('destroys all retained and pooled objects idempotently', () => {
    const harness = createHarness()
    const view = new DropZoneView({ scene: harness.scene as never })
    view.sync(model(), layout)
    view.sync(model(null, [card('forest', { draggable: false })]), layout)

    view.destroy()
    view.destroy()

    expect((view.layer as unknown as FakeContainer).destroyed).toBe(true)
    expect(harness.created.every((object) => object.destroyed)).toBe(true)
  })
})
