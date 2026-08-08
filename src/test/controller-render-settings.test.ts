import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_BOARD_THEME } from '../app/board-theme'
import { AppController } from '../app/controller'
import { DEFAULT_RENDER_QUALITY_PREFERENCE } from '../app/render-quality'

function installMemoryStorage(): Map<string, string> {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      clear: () => { values.clear() },
    },
  })
  return values
}

function installUnavailableStorage(): void {
  const unavailable = (): never => {
    throw new Error('storage unavailable')
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: unavailable,
      setItem: unavailable,
      removeItem: unavailable,
      clear: unavailable,
    },
  })
}

describe('controller render settings', () => {
  beforeEach(() => {
    installMemoryStorage()
  })

  it('falls back safely when persisted settings are malformed', () => {
    localStorage.setItem('cardgame.board-theme', '{bad-json')
    localStorage.setItem('cardgame.render-quality', 'cinematic')

    const controller = new AppController('dom')

    expect(controller.getViewModel().boardTheme).toBe(DEFAULT_BOARD_THEME)
    expect(controller.getViewModel().renderQualityPreference).toBe(DEFAULT_RENDER_QUALITY_PREFERENCE)
  })

  it('persists valid selections for new controller instances', () => {
    const first = new AppController('dom')
    first.setBoardTheme('parchment')
    first.setRenderQualityPreference('high')

    const second = new AppController('phaser')
    expect(second.getViewModel().boardTheme).toBe('parchment')
    expect(second.getViewModel().renderQualityPreference).toBe('high')
  })

  it('starts and updates in-memory settings when storage is unavailable', () => {
    installUnavailableStorage()

    let controller: AppController | undefined
    expect(() => {
      controller = new AppController('dom')
    }).not.toThrow()
    expect(controller?.getViewModel().boardTheme).toBe(DEFAULT_BOARD_THEME)
    expect(controller?.getViewModel().renderQualityPreference).toBe(DEFAULT_RENDER_QUALITY_PREFERENCE)

    expect(() => {
      controller?.setBoardTheme('midnight')
      controller?.setRenderQualityPreference('low')
    }).not.toThrow()
    expect(controller?.getViewModel().boardTheme).toBe('midnight')
    expect(controller?.getViewModel().renderQualityPreference).toBe('low')
  })
})
