import { beforeEach, describe, expect, it, vi } from 'vitest'
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
    const controller = new AppController()
    expect(controller.getViewModel().cardVisualStyle).toBe('anime')
    controller.setCardVisualStyle('anime')
    expect(controller.getViewModel().cardVisualStyle).toBe('anime')
  })

  it('persists selected style for new controller instances', () => {
    const first = new AppController()
    first.setCardVisualStyle('anime')
    first.setMonochromeCards(true)

    const second = new AppController()
    expect(second.getViewModel().cardVisualStyle).toBe('anime')
    expect(second.getViewModel().monochromeCards).toBe(true)
  })

  it("migrates old HD and Monochrome styles to Anime and the checkbox setting", () => {
    for (const style of ['hd', 'neon']) {
      localStorage.setItem('cardgame.card-visual-style', style)
      expect(new AppController().getViewModel().cardVisualStyle).toBe('anime')
    }
    localStorage.setItem('cardgame.card-visual-style', 'monochrome')
    const monochromeController = new AppController()
    expect(monochromeController.getViewModel().cardVisualStyle).toBe('anime')
    expect(monochromeController.getViewModel().monochromeCards).toBe(true)
    expect(localStorage.getItem('cardgame.card-visual-style')).toBe('anime')
  })

  it('keeps the legacy Monochrome marker when the checkbox cannot be saved', () => {
    localStorage.setItem('cardgame.card-visual-style', 'monochrome')
    const setItem = localStorage.setItem.bind(localStorage)
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
      if (key === 'cardgame.monochrome-cards') throw new Error('quota')
      setItem(key, value)
    })
    expect(new AppController().getViewModel().monochromeCards).toBe(true)
    expect(localStorage.getItem('cardgame.card-visual-style')).toBe('monochrome')
    spy.mockRestore()
    expect(new AppController().getViewModel().monochromeCards).toBe(true)
    expect(localStorage.getItem('cardgame.card-visual-style')).toBe('anime')
    expect(localStorage.getItem('cardgame.monochrome-cards')).toBe('true')
  })
})
