import { describe, expect, it } from 'vitest'
import type { GameUiState } from '../app/types'
import type { CardViewDescriptor } from '../renderers/phaser/card-view'
import { DropZoneView } from '../renderers/phaser/drop-zone-view'
import type { SceneLayout } from '../renderers/phaser/layout'

class FakeObject {
  x = 0
  y = 0
  width = 0
  height = 0
  visible = true
  text = ''
  color = ''
  destroyed = false
  readonly children: FakeObject[] = []

  setPosition(x: number, y: number): this { this.x = x; this.y = y; return this }
  setSize(width: number, height: number): this { this.width = width; this.height = height; return this }
  setVisible(visible: boolean): this { this.visible = visible; return this }
  setStrokeStyle(): this { return this }
  setDepth(): this { return this }
  setOrigin(): this { return this }
  setFillStyle(): this { return this }
  setFontSize(): this { return this }
  setText(text: string): this { this.text = text; return this }
  setColor(color: string): this { this.color = color; return this }
  add(children: FakeObject | FakeObject[]): this {
    this.children.push(...(Array.isArray(children) ? children : [children]))
    return this
  }
  destroy(): void {
    this.destroyed = true
    for (const child of this.children) {
      child.destroy()
    }
  }
}

function game(overrides: Partial<GameUiState> = {}): GameUiState {
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
      { id: 0, handCount: 1, deckCount: 10, graveyardCount: 0, handCards: [], graveyardCards: [], battlefield: [] },
      { id: 1, handCount: 0, deckCount: 10, graveyardCount: 0, handCards: [], graveyardCards: [], battlefield: [] },
    ],
    legal: {
      playLandByCard: { forest: [{ action: { type: 'play_land', actor: 0, cardId: 'forest' }, label: 'Play Forest' }] },
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
    ...overrides,
  }
}

const layout = {
  boardColumnLeft: 100,
  boardColumnWidth: 600,
  activeBattlefieldY: 400,
  activeBattlefieldHeight: 180,
  smallFontSize: '14px',
} as SceneLayout

const targetCard: CardViewDescriptor = {
  cardId: 'forest',
  instanceId: 'p0-1',
  playerIndex: 0,
  zone: 'battlefield',
  name: 'Forest',
  x: 400,
  y: 480,
  width: 90,
  height: 120,
  highlight: true,
  draggable: false,
  preview: false,
  interactionKey: 'target',
}

function harness(): { view: DropZoneView; root: FakeObject; objects: FakeObject[] } {
  const objects: FakeObject[] = []
  const root = new FakeObject()
  const scene = {
    add: {
      container: () => new FakeObject(),
      rectangle: () => {
        const object = new FakeObject()
        objects.push(object)
        return object
      },
      text: (_x: number, _y: number, text: string) => {
        const object = new FakeObject()
        object.text = text
        objects.push(object)
        return object
      },
    },
  }
  return { view: new DropZoneView(scene as never, root as never), root, objects }
}

describe('DropZoneView', () => {
  it('shows valid and invalid drop feedback from app-projected legality and pointer position', () => {
    const { view, objects } = harness()
    view.sync({ game: game(), layout, cards: [], dragCardId: 'forest', dragPhase: 'dragging', effect: null })
    view.updatePointer(20, 20)
    expect(objects[0].visible).toBe(true)
    expect(objects[1]).toMatchObject({ visible: true, text: 'Drop on your battlefield' })

    view.updatePointer(400, 480)
    expect(objects[1]).toMatchObject({ visible: true, text: 'Release to play' })
  })

  it('keeps feedback in the gameplay root so later modal children occlude it', () => {
    const { root, view } = harness()

    expect(root.children).toContain(view.rootChild)
  })

  it('retains target rings and hides the drop zone during target selection', () => {
    const { view, objects } = harness()
    view.sync({ game: game(), layout, cards: [targetCard], dragCardId: null, dragPhase: 'idle', effect: null })

    expect(objects).toHaveLength(4)
    expect(objects[0].visible).toBe(false)
    expect(objects[1]).toMatchObject({ visible: true, text: 'Choose a highlighted target' })
    expect(objects[2]).toMatchObject({ visible: true, x: 400, y: 480, width: 100, height: 130 })
    expect(objects[3]).toMatchObject({ visible: true, text: 'Target' })
  })

  it('does not create Phaser objects while updating pointer feedback', () => {
    const { view, objects } = harness()
    view.sync({ game: game(), layout, cards: [targetCard], dragCardId: 'forest', dragPhase: 'dragging', effect: null })
    const count = objects.length

    for (let index = 0; index < 1_000; index += 1) {
      view.updatePointer(100 + index, 420)
    }

    expect(objects).toHaveLength(count)
  })

  it('cleans up retained feedback objects idempotently', () => {
    const { view, objects } = harness()
    view.sync({ game: game(), layout, cards: [targetCard], dragCardId: null, dragPhase: 'idle', effect: null })
    view.destroy()
    view.destroy()

    expect(objects.every((object) => object.destroyed)).toBe(true)
  })
})
