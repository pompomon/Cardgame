import { describe, expect, it, vi } from 'vitest'
import type { GameUiState } from '../app/types'
import { BattlefieldView } from '../renderers/phaser/battlefield-view'
import { buildLayout } from '../renderers/phaser/layout'

class FakeDisplayObject {
  parentContainer: FakeContainer | null = null
  visible = true
  destroyed = false

  setVisible(visible: boolean): this {
    this.visible = visible
    return this
  }

  setPosition(): this { return this }
  setSize(): this { return this }
  setFontSize(): this { return this }
  setText(): this { return this }
  setRectangleDropZone(): this { return this }
  fillStyle(): this { return this }
  fillRoundedRect(): this { return this }
  lineStyle(): this { return this }
  strokeRoundedRect(): this { return this }

  destroy(): void {
    this.destroyed = true
    this.parentContainer?.remove(this, false)
  }
}

class FakeContainer extends FakeDisplayObject {
  readonly children: FakeDisplayObject[] = []

  add(children: FakeDisplayObject | FakeDisplayObject[]): this {
    for (const child of Array.isArray(children) ? children : [children]) {
      child.parentContainer?.remove(child, false)
      child.parentContainer = this
      this.children.push(child)
    }
    return this
  }

  addAt(child: FakeDisplayObject, index: number): this {
    child.parentContainer?.remove(child, false)
    child.parentContainer = this
    this.children.splice(index, 0, child)
    return this
  }

  remove(child: FakeDisplayObject, destroyChild = false): this {
    const index = this.children.indexOf(child)
    if (index >= 0) this.children.splice(index, 1)
    child.parentContainer = null
    if (destroyChild) child.destroy()
    return this
  }

  override destroy(destroyChildren?: boolean): void {
    if (destroyChildren) {
      for (const child of [...this.children]) child.destroy()
    }
    super.destroy()
  }
}

function gameState(): GameUiState {
  return {
    actor: 0,
    phase: 'main',
    players: [
      {
        battlefield: [{ cardId: 'p0-forest', instanceId: 'p0-1', name: 'Forest' }],
      },
      {
        battlefield: [{ cardId: 'p1-island', instanceId: 'p1-1', name: 'Island' }],
      },
    ],
  } as unknown as GameUiState
}

describe('Phaser retained battlefield view', () => {
  it('reuses battlefield chrome and the drop zone across unchanged syncs', () => {
    const containers: FakeContainer[] = []
    const graphics: FakeDisplayObject[] = []
    const texts: FakeDisplayObject[] = []
    const zones: FakeDisplayObject[] = []
    const scene = {
      add: {
        container: () => {
          const container = new FakeContainer()
          containers.push(container)
          return container
        },
        graphics: () => {
          const graphic = new FakeDisplayObject()
          graphics.push(graphic)
          return graphic
        },
        text: () => {
          const text = new FakeDisplayObject()
          texts.push(text)
          return text
        },
        zone: () => {
          const zone = new FakeDisplayObject()
          zones.push(zone)
          return zone
        },
      },
    }
    const root = new FakeContainer()
    const effectController = {
      beginBattlefieldRenderPass: vi.fn(),
      recordCardPosition: vi.fn(),
    }
    const battlefieldTargets = {
      findBattlefieldTargetEntry: vi.fn(() => null),
      getPendingPlayLandTargetSelection: vi.fn(() => null),
    }
    const setBattlefieldDropZone = vi.fn()
    const view = new BattlefieldView({
      scene: scene as never,
      getLayout: () => buildLayout(1280, 720, 'horizontal'),
      getRootContainer: () => root as never,
      effectController: effectController as never,
      battlefieldTargets: battlefieldTargets as never,
      setBattlefieldDropZone,
    })

    const firstCards = view.sync(gameState(), 0, true)
    const creationCounts = {
      containers: containers.length,
      graphics: graphics.length,
      texts: texts.length,
      zones: zones.length,
    }
    const dropZone = setBattlefieldDropZone.mock.calls.at(-1)?.[0]

    const secondCards = view.sync(gameState(), 0, true)

    expect(secondCards).toEqual(firstCards)
    expect({
      containers: containers.length,
      graphics: graphics.length,
      texts: texts.length,
      zones: zones.length,
    }).toEqual(creationCounts)
    expect(setBattlefieldDropZone.mock.calls.at(-1)?.[0]).toBe(dropZone)
    expect(effectController.beginBattlefieldRenderPass).toHaveBeenCalledTimes(2)
    expect(effectController.recordCardPosition).toHaveBeenCalledTimes(4)

    view.reset()
    expect(view.rootChild.visible).toBe(false)
    expect(setBattlefieldDropZone).toHaveBeenLastCalledWith(null)

    view.destroy()
    expect((view.rootChild as unknown as FakeDisplayObject).destroyed).toBe(true)
  })
})
