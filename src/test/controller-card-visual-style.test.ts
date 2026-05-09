import { beforeEach, describe, expect, it } from 'vitest'
import { AppController } from '../app/controller'

function installMemoryStorage(): void {
  const map = new Map<string, string>()
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => {
      map.clear()
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
}

describe('controller card visual style', () => {
  beforeEach(() => {
    installMemoryStorage()
  })

  it('updates card visual style in view model', () => {
    const controller = new AppController('dom')
    expect(controller.getViewModel().cardVisualStyle).toBe('classic')
    controller.setCardVisualStyle('neon')
    expect(controller.getViewModel().cardVisualStyle).toBe('neon')
  })

  it('persists selected style for new controller instances', () => {
    const first = new AppController('dom')
    first.setCardVisualStyle('monochrome')

    const second = new AppController('dom')
    expect(second.getViewModel().cardVisualStyle).toBe('monochrome')
  })
})
