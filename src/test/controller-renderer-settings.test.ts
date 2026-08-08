import { beforeEach, describe, expect, it } from 'vitest'
import { AppController } from '../app/controller'

function installMemoryStorage(): void {
  const map = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value) },
      removeItem: (key: string) => { map.delete(key) },
      clear: () => { map.clear() },
    },
  })
}

describe('controller renderer settings', () => {
  beforeEach(() => {
    installMemoryStorage()
  })

  it('starts with defaults when persisted board/quality values are invalid', () => {
    localStorage.setItem('cardgame.board-theme', 'bad-theme')
    localStorage.setItem('cardgame.render-quality', 'bad-quality')

    const controller = new AppController('dom')
    const view = controller.getViewModel()
    expect(view.boardTheme).toBe('classic')
    expect(view.renderQualityPreference).toBe('auto')
  })

  it('persists selected board theme and render quality between controller instances', () => {
    const first = new AppController('dom')
    first.setBoardTheme('verdant')
    first.setRenderQualityPreference('balanced')

    const second = new AppController('dom')
    const view = second.getViewModel()
    expect(view.boardTheme).toBe('verdant')
    expect(view.renderQualityPreference).toBe('balanced')
  })

  it('does not throw when storage is unavailable during startup', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => { throw new Error('storage unavailable') },
        setItem: () => { throw new Error('storage unavailable') },
        removeItem: () => { throw new Error('storage unavailable') },
        clear: () => { throw new Error('storage unavailable') },
      },
    })

    expect(() => new AppController('dom')).not.toThrow()
  })
})
