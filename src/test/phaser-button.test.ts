import { describe, expect, it, vi } from 'vitest'
import { buildButton } from '../renderers/phaser/button'

type Listener = (pointer: { id?: number; wasCanceled?: boolean; wasTouch?: boolean }) => void

class FakeDisplayObject {
  private readonly listeners = new Map<string, Listener[]>()
  readonly scales: number[] = []

  add(): this { return this }
  fillRoundedRect(): this { return this }
  fillStyle(): this { return this }
  lineStyle(): this { return this }
  setInteractive(): this { return this }
  setOrigin(): this { return this }
  setScale(scale: number): this {
    this.scales.push(scale)
    return this
  }
  setSize(): this { return this }
  strokeRoundedRect(): this { return this }

  on(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
    return this
  }

  emit(event: string, pointer: Parameters<Listener>[0]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(pointer)
    }
  }
}

function createScene(): {
  add: {
    container: () => FakeDisplayObject
    graphics: () => FakeDisplayObject
    text: () => FakeDisplayObject
  }
} {
  return {
    add: {
      container: () => new FakeDisplayObject(),
      graphics: () => new FakeDisplayObject(),
      text: () => new FakeDisplayObject(),
    },
  }
}

describe('Phaser button pointer ownership', () => {
  it('suppresses hover and pressed scaling when quality effects are disabled', () => {
    const button = buildButton(
      createScene() as never,
      'End Turn',
      0,
      0,
      '16px',
      120,
      44,
      vi.fn(),
      { fill: 0, stroke: 0, text: '#fff' },
      { enableShadows: false, enableHoverEffects: false },
    ) as unknown as FakeDisplayObject

    button.emit('pointerover', { id: 1 })
    button.emit('pointerdown', { id: 1 })
    button.emit('pointerup', { id: 1 })
    button.emit('pointerout', { id: 1 })

    expect(button.scales.every((scale) => scale === 1)).toBe(true)
  })

  it('submits only a matching, non-cancelled pointer release', () => {
    const onClick = vi.fn()
    const button = buildButton(
      createScene() as never,
      'End Turn',
      0,
      0,
      '16px',
      120,
      44,
      onClick,
      { fill: 0, stroke: 0, text: '#fff' },
    ) as unknown as FakeDisplayObject

    button.emit('pointerup', { id: 1 })
    button.emit('pointerdown', { id: 1 })
    button.emit('pointerup', { id: 2 })
    button.emit('pointerdown', { id: 1 })
    button.emit('pointerup', { id: 1, wasCanceled: true })
    button.emit('pointerdown', { id: 1 })
    button.emit('pointerout', { id: 1 })
    button.emit('pointerup', { id: 1 })
    expect(onClick).not.toHaveBeenCalled()

    button.emit('pointerdown', { id: 7 })
    button.emit('pointerup', { id: 7 })
    expect(onClick).toHaveBeenCalledOnce()
  })
})
