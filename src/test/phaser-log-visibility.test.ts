import { describe, expect, it } from 'vitest'

import { shouldRenderInSceneReplayLog } from '../renderers/phaser/in-scene-log-policy'

describe('phaser in-scene replay log policy', () => {
  it('renders replay log when menu is closed', () => {
    expect(shouldRenderInSceneReplayLog({
      menuOpen: false,
    })).toBe(true)
  })

  it('hides replay log only when the menu modal is open', () => {
    expect(shouldRenderInSceneReplayLog({
      menuOpen: true,
    })).toBe(false)
  })
})
