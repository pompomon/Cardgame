import { describe, expect, it, vi } from 'vitest'
import { BOARD_THEME_OPTIONS } from '../app/board-theme'
import { RENDER_QUALITY_OPTIONS } from '../app/render-quality'
import { buildVisualSettingsA11yEntries } from '../renderers/phaser/a11y-navigation'

describe('Phaser accessibility settings', () => {
  it('mirrors board-theme and render-quality labels, selections, and actions', () => {
    const controller = {
      setAnimationSpeed: vi.fn(),
      setBoardTheme: vi.fn(),
      setCardVisualStyle: vi.fn(),
      setRenderQualityPreference: vi.fn(),
    }
    const entries = buildVisualSettingsA11yEntries({
      animationSpeed: 'normal',
      boardTheme: 'midnight',
      cardVisualStyle: 'hd',
      renderQualityPreference: 'low',
    }, controller)

    const boardEntries = entries.filter((entry) => entry.key.startsWith('settings-board-theme:'))
    expect(boardEntries.map((entry) => entry.label)).toEqual(BOARD_THEME_OPTIONS.map((option) =>
      `Set board theme: ${option.label}${option.value === 'midnight' ? ' (selected)' : ''}`,
    ))
    const qualityEntries = entries.filter((entry) => entry.key.startsWith('settings-render-quality:'))
    expect(qualityEntries.map((entry) => entry.label)).toEqual(RENDER_QUALITY_OPTIONS.map((option) =>
      `Set render quality: ${option.label}${option.value === 'low' ? ' (selected)' : ''}`,
    ))

    boardEntries.find((entry) => entry.key.endsWith(':parchment'))?.onClick()
    qualityEntries.find((entry) => entry.key.endsWith(':high'))?.onClick()
    expect(controller.setBoardTheme).toHaveBeenCalledWith('parchment')
    expect(controller.setRenderQualityPreference).toHaveBeenCalledWith('high')
  })
})
