import { describe, expect, it } from 'vitest'

import { shouldRenderInSceneReplayLog } from '../renderers/phaser/in-scene-log-policy'

describe('phaser in-scene replay log policy', () => {
  it('keeps replay log visible during respond phase while counter dialog can be open', () => {
    expect(shouldRenderInSceneReplayLog({
      menuOpen: false,
      game: {
        canInput: true,
        phase: 'respond',
      },
    })).toBe(true)
  })

  it('keeps replay log visible during plains_target phase', () => {
    expect(shouldRenderInSceneReplayLog({
      menuOpen: false,
      game: {
        canInput: true,
        phase: 'plains_target',
      },
    })).toBe(true)
  })

  it('hides replay log only when the menu modal is open', () => {
    expect(shouldRenderInSceneReplayLog({
      menuOpen: true,
      game: {
        canInput: false,
        phase: 'main',
      },
    })).toBe(false)
  })
})
