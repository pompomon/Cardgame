import { describe, expect, it, vi } from 'vitest'
import { CanvasTexture, type Mesh, type MeshBasicMaterial } from 'three'
import type { AppViewModel } from '../app/types'
import { buildCounterHandOptions, type CounterHandOptions } from '../app/response-options'
import type { ThreeAssets } from '../renderers/three/assets'
import { boardCardKey, ThreeCardRegistry, type CardDescriptor } from '../renderers/three/card-registry'
import { EffectGeometry, EffectVisual, effectRecipe } from '../renderers/three/effect-visual'
import type { VisualEffectDescriptor } from '../app/visual-effects'
import { ThreeBoard } from '../renderers/three/board'
import { boardLayout } from '../renderers/three/layout'
import { MAX_EFFECT_MS } from '../app/animation-settings'

function descriptor(cardId: string, instanceId?: string, x = 100): CardDescriptor {
  return {
    hit: { key: boardCardKey(cardId, 0, instanceId), cardId, instanceId, name: 'Mountain', owner: 0, zone: instanceId ? 'battlefield' : 'hand', playable: !instanceId },
    style: 'hd', visible: true, target: false, shadows: true, x, y: 30, width: 100, height: 140,
  }
}

function fixture(): { registry: ThreeCardRegistry; acquire: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> } {
  const release = vi.fn()
  const acquire = vi.fn(() => ({ texture: new CanvasTexture({} as HTMLCanvasElement), release }))
  return { registry: new ThreeCardRegistry({ acquireCard: acquire } as unknown as ThreeAssets), acquire, release }
}

describe('retained Three.js card registry', () => {
  it('updates distinct response rings in place and clears them without reallocating textures', () => {
    const { registry, acquire, release } = fixture()
    const card = { ...descriptor('island'), hit: { ...descriptor('island').hit, playable: false } }
    registry.reconcile([{ ...card, response: 'required' }])
    const retained = registry.get(card.hit.key)!
    const ring = retained.group.children[1] as Mesh
    const material = ring.material as MeshBasicMaterial
    expect(ring.visible).toBe(true)
    expect(material.color.getHexString()).toBe('80bfff')
    const requiredScale = ring.scale.x
    registry.reconcile([{ ...card, response: 'discard' }])
    expect(material.color.getHexString()).toBe('e4a0ff')
    expect(ring.scale.x).toBeGreaterThan(requiredScale)
    expect(registry.get(card.hit.key)).toBe(retained)
    registry.reconcile([card])
    expect(ring.visible).toBe(false)
    registry.reconcile([{ ...card, target: true }])
    expect(ring.visible).toBe(true)
    expect(material.color.getHexString()).toBe('ffdf7e')
    expect(acquire).toHaveBeenCalledOnce()
    registry.dispose()
    expect(release).toHaveBeenCalledOnce()
  })

  it('reuses the same mesh and face texture across unchanged notifications', () => {
    const { registry, acquire, release } = fixture()
    const card = descriptor('a', 'a:1')
    registry.reconcile([card])
    const before = registry.get(card.hit.key)
    registry.reconcile([{ ...card, x: 250, target: true }])
    expect(registry.get(card.hit.key)).toBe(before)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(before?.group.position.x).toBe(250)
    registry.dispose()
    registry.dispose()
    expect(release).toHaveBeenCalledTimes(1)
  })

  describe('Three response board presentation', () => {
    function setupBoard() {
      const { registry, acquire } = fixture()
      const handCards = [
        { id: 'island', name: 'Island' },
        { id: 'forest-1', name: 'Forest' },
        { id: 'forest-2', name: 'Forest' },
        { id: 'other-island', name: 'Island' },
      ]
      const view = {
        cardVisualStyle: 'classic', replay: { active: false },
        game: {
          actor: 0, actorControl: 'human', canInput: true, phase: 'respond',
          pendingLandName: 'Swamp', isReplay: false,
          players: [{ handCards, battlefield: [] }, { handCards: [], battlefield: [] }],
          legal: {
            playLandByCard: { island: [{ action: { type: 'play_land', actor: 0, cardId: 'island' } }] },
            counterOptions: handCards.slice(1).map((card) => ({
              action: { type: 'counter_land', actor: 0, discardCardId: card.id }, label: `Discard Island + ${card.name}`,
            })),
            canPassResponse: true,
          },
        },
      } as unknown as AppViewModel
      const response = buildCounterHandOptions(view.game!)
      const chrome = new Map(['far', 'near', 'hand'].map((row) => [row, {
        header: { dataset: {} }, label: { textContent: '', focus: vi.fn() },
        stats: { textContent: '', setAttribute: vi.fn() }, controls: { hidden: false }, count: { textContent: '' },
        stacks: [{ textContent: '', dataset: {} }, { textContent: '', dataset: {} }],
        targets: { textContent: '', hidden: true },
        previous: { disabled: false, setAttribute: vi.fn() }, next: { disabled: false, setAttribute: vi.fn() },
      }]))
      const fields = {
        view, actor: 0, response: response as CounterHandOptions | null, cards: registry, chrome,
        pages: { far: 0, near: 0, hand: 0 }, layout: { ...boardLayout(1000, 750), capacity: 2 },
        quality: { shadows: false }, targetIds: new Set(), drag: null, canDrop: false,
        instruction: { hidden: true }, instructionText: { textContent: '' }, instructionSizes: [],
        dropMaterial: { opacity: 0 },
        primaryButton: { ownerDocument: { activeElement: null }, hidden: true, disabled: true, textContent: '', dataset: {} },
        primaryAction: null,
        usable: () => true, onResize: vi.fn(), invalidate: vi.fn(), applySize: vi.fn(), syncTargetLabels: vi.fn(),
      }
      const board = Object.assign(Object.create(ThreeBoard.prototype), fields) as typeof fields & {
        present(): void
        changePage(row: string, delta: number): void
      }
      return { board, registry, acquire, view, response }
    }

    it('keeps paginated discard choices reachable and never marks response cards playable', () => {
      const { board, registry, acquire, response } = setupBoard()
      board.present()
      expect(board.canDrop).toBe(false)
      expect(board.instruction.hidden).toBe(false)
      expect(board.instructionText.textContent).toBe(`Respond to Swamp. ${response.instruction}`)
      const island = registry.get(boardCardKey('island', 0))!
      const forest = registry.get(boardCardKey('forest-2', 0))!
      expect(island.descriptor.response).toBe('required')
      expect(island.descriptor.hit.playable).toBe(false)
      expect(forest.descriptor.response).toBe('discard')
      expect(forest.descriptor.visible).toBe(false)
      expect(registry.hitTest({ x: forest.descriptor.x, y: forest.descriptor.y })?.cardId).not.toBe('forest-2')
      board.changePage('hand', 1)
      expect(board.onResize).toHaveBeenCalledOnce()
      expect(island.descriptor.visible).toBe(false)
      expect(forest.descriptor.visible).toBe(true)
      expect(registry.hitTest(forest.descriptor)?.cardId).toBe('forest-2')
      expect(board.instructionText.textContent).toBe(`Respond to Swamp. ${response.instruction}`)
      expect(registry.get(boardCardKey('other-island', 0))!.descriptor.response).toBe('discard')
      expect(acquire).toHaveBeenCalledTimes(4)
      registry.dispose()
    })

    it('clears feedback for menus, disabled input, actor changes and replay without replacing cards', () => {
      const { board, registry, view, response, acquire } = setupBoard()
      board.present()
      const card = registry.get(boardCardKey('island', 0))!
      board.response = null
      board.present()
      expect(card.descriptor.response).toBeNull()
      expect(board.instruction.hidden).toBe(true)
      board.response = response
      for (const disabled of [
        { ...view.game!, canInput: false },
        { ...view.game!, actor: 1 },
        { ...view.game!, isReplay: true },
        { ...view.game!, phase: 'swamp_target' as const },
      ]) {
        board.view = { ...view, game: disabled }
        board.present()
        expect(card.descriptor.response).toBeNull()
        expect(board.instruction.hidden).toBe(true)
      }
      expect(registry.get(boardCardKey('island', 0))).toBe(card)
      expect(acquire).toHaveBeenCalledTimes(4)
      registry.dispose()
    })
  })

  it('distinguishes same-name cards and different instances of the same card', () => {
    const { registry } = fixture()
    const first = descriptor('same-card', 'instance-1', 50)
    const second = descriptor('other-card', 'instance-2', 200)
    registry.reconcile([first, second])
    const old = registry.get(first.hit.key)
    const returned = descriptor('same-card', 'instance-3', -90)
    registry.reconcile([returned, second])
    expect(registry.get(returned.hit.key)).not.toBe(old)
    expect(registry.anchorFor('instance-1')?.x).toBe(50)
    expect(registry.anchorFor('instance-3')?.x).toBe(-90)
    expect(registry.anchorFor('unknown', 'same-card')).toBeNull()
    expect(registry.anchorFor(undefined, 'same-card')?.x).toBe(-90)
    registry.dispose()
  })

  it('makes hidden pages and removed cards inert but keeps exact removal anchors', () => {
    const { registry } = fixture()
    const first = descriptor('a', 'i')
    registry.reconcile([first])
    expect(registry.hitTest({ x: 100, y: 30 })?.instanceId).toBe('i')
    registry.reconcile([{ ...first, visible: false, x: 0 }])
    expect(registry.hitTest({ x: 100, y: 30 })).toBeNull()
    expect(registry.anchorFor('i')).toBeNull()
    registry.reconcile([first])
    registry.reconcile([])
    const pin = registry.pinRemoved('i')
    expect(registry.anchorFor('i')?.x).toBe(100)
    expect(pin?.card.group.visible).toBe(true)
    expect(registry.hitTest({ x: 100, y: 30 })).toBeNull()
    pin?.release()
    pin?.release()
    expect(pin?.card.group.visible).toBe(false)
    registry.dispose()
  })

  it('bounds inert history and releases evicted cards', () => {
    const { registry, release } = fixture()
    for (let index = 0; index < 160; index++) registry.reconcile([descriptor(`card${index}`, `i${index}`)])
    registry.reconcile([])
    expect(registry.size).toBe(0)
    expect(registry.retainedCount).toBe(12)
    expect(registry.anchorFor('i0')).toBeNull()
    expect(release).toHaveBeenCalledTimes(148)
    registry.dispose()
    expect(release).toHaveBeenCalledTimes(160)
  })

  it('creates a separate lifted proxy while leaving the original mesh intact', () => {
    const { registry, release } = fixture()
    const card = descriptor('a')
    registry.reconcile([card])
    const source = registry.get(card.hit.key)!
    const proxy = registry.createProxy(source)
    expect(proxy.group.position.z).toBeGreaterThan(source.group.position.z)
    expect(source.group.position.x).toBe(100)
    proxy.dispose()
    proxy.dispose()
    registry.dispose()
    expect(release).toHaveBeenCalledTimes(2)
  })
})

describe('bounded cosmetic Three.js effects', () => {
  it('targets the opponent hand for Swamp without using a stale card anchor', () => {
    const historical = { x: 300, y: 30, width: 100, height: 140, owner: 0, zone: 'hand' as const }
    const opponentHand = { ...historical, x: 0, y: 400, owner: 1 }
    const anchorFor = vi.fn(() => historical)
    const actorAnchor = vi.fn(() => opponentHand)
    const board = Object.assign(Object.create(ThreeBoard.prototype), {
      actorAnchor,
      cards: { anchorFor },
    }) as unknown as {
      effectTargetAnchor(effect: VisualEffectDescriptor): typeof opponentHand
    }
    const target = board.effectTargetAnchor({
      kind: 'swamp_discard', actor: 0, targetActor: 1, targetCardId: 'discarded',
      land: 'Swamp', visualStyle: 'classic',
      palette: { primary: '#000', secondary: '#111', glow: '#222' },
    })
    expect(target).toBe(opponentHand)
    expect(actorAnchor).toHaveBeenCalledWith(1, true)
    expect(anchorFor).not.toHaveBeenCalled()

    expect(board.effectTargetAnchor({
      kind: 'forest_return', actor: 0, targetCardId: 'returned',
      land: 'Forest', visualStyle: 'classic',
      palette: { primary: '#000', secondary: '#111', glow: '#222' },
    })).toBe(historical)
    expect(anchorFor).toHaveBeenCalledWith(undefined, 'returned')
  })

  it('animates the exact removed Mountain target and completes cancellation only once', () => {
    const { registry } = fixture()
    registry.reconcile([descriptor('destroyed', 'removed', 123)])
    registry.reconcile([])
    const removed = registry.pinRemoved('removed')!
    const geometry = new EffectGeometry()
    const done = vi.fn()
    const anchor = registry.anchorFor('removed')!
    const effect: VisualEffectDescriptor = {
      kind: 'mountain_destroy', actor: 0, land: 'Mountain', visualStyle: 'hd',
      targetInstanceId: 'removed', palette: { primary: '#ff8800', secondary: '#a30000', glow: '#ffcc66' },
    }
    const visual = new EffectVisual(geometry, effect, { ...anchor, x: -50 }, anchor, 300, 8, removed, done)
    const objects = [...visual.group.children]
    visual.advance(150)
    expect(removed.card.group.scale.x).toBeLessThan(1)
    expect(visual.group.children).toEqual(objects)
    visual.cancel()
    visual.cancel()
    visual.advance(1000)
    expect(done).toHaveBeenCalledTimes(1)
    expect(removed.card.group.visible).toBe(false)
    registry.dispose()
    geometry.dispose()
  })

  describe('Three.js board visibility', () => {
    it('does not repeat visibility work when the value is unchanged', () => {
      const visibilityChanged = vi.fn()
      const resize = vi.fn()
      const stage = { hidden: false }
      const board = Object.assign(Object.create(ThreeBoard.prototype), {
        disposed: false,
        visible: true,
        stage,
        visibilityChanged,
        resize,
      }) as unknown as ThreeBoard

      board.setVisible(true)
      expect(visibilityChanged).not.toHaveBeenCalled()
      expect(resize).not.toHaveBeenCalled()

      board.setVisible(false)
      expect(stage.hidden).toBe(true)
      expect(visibilityChanged).toHaveBeenCalledOnce()
      expect(resize).not.toHaveBeenCalled()

      board.setVisible(true)
      expect(stage.hidden).toBe(false)
      expect(visibilityChanged).toHaveBeenCalledTimes(2)
      expect(resize).toHaveBeenCalledOnce()
      board.setVisible(true)
      expect(resize).toHaveBeenCalledOnce()
    })
  })

  it('finishes long caller durations within the bounded lifetime and rejects unknown kinds', () => {
    const geometry = new EffectGeometry()
    const done = vi.fn()
    const anchor = { x: 0, y: 0, width: 100, height: 140, owner: 0, zone: 'battlefield' as const }
    const effect: VisualEffectDescriptor = {
      kind: 'plains_reuse', actor: 0, land: 'Plains', visualStyle: 'classic',
      palette: { primary: '#ffffff', secondary: '#cccccc', glow: '#eeeeee' },
    }
    const visual = new EffectVisual(geometry, effect, anchor, anchor, 100000, 200, null, done)
    expect(visual.group.children).toHaveLength(11)
    visual.advance(MAX_EFFECT_MS - 1)
    expect(done).not.toHaveBeenCalled()
    visual.advance(1)
    expect(done).toHaveBeenCalledTimes(1)
    expect(effectRecipe('unknown' as VisualEffectDescriptor['kind'])).toBeNull()
    geometry.dispose()
  })
})
