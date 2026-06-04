import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DEPTH_BOARD,
  DEPTH_GAMEPLAY,
  DEPTH_HEADER,
  DEPTH_HEADER_STRIP,
  DEPTH_MENU_OVERLAY,
  DEPTH_REPLAY_LOG,
  DEPTH_REPLAY_LOG_HEADING,
  DEPTH_TARGET_PICKER_OVERLAY,
  SCENE_DEPTHS,
} from '../renderers/phaser/depth'

const REPO_ROOT = join(__dirname, '..', '..')

describe('phaser scene depths', () => {
  it('keeps the documented z-order from log through overlays', () => {
    expect(DEPTH_REPLAY_LOG).toBeLessThan(DEPTH_REPLAY_LOG_HEADING)
    expect(DEPTH_REPLAY_LOG_HEADING).toBeLessThan(DEPTH_BOARD)
    expect(DEPTH_BOARD).toBeLessThan(DEPTH_GAMEPLAY)
    expect(DEPTH_GAMEPLAY).toBeLessThan(DEPTH_HEADER_STRIP)
    expect(DEPTH_HEADER_STRIP).toBeLessThan(DEPTH_HEADER)
    expect(DEPTH_HEADER).toBeLessThan(DEPTH_MENU_OVERLAY)
    expect(DEPTH_MENU_OVERLAY).toBeLessThan(DEPTH_TARGET_PICKER_OVERLAY)
  })

  it('exports a complete scene depth map', () => {
    expect(SCENE_DEPTHS).toEqual({
      replayLog: DEPTH_REPLAY_LOG,
      replayLogHeading: DEPTH_REPLAY_LOG_HEADING,
      board: DEPTH_BOARD,
      gameplay: DEPTH_GAMEPLAY,
      headerStrip: DEPTH_HEADER_STRIP,
      header: DEPTH_HEADER,
      menuOverlay: DEPTH_MENU_OVERLAY,
      targetPickerOverlay: DEPTH_TARGET_PICKER_OVERLAY,
    })
  })

  it('keeps phaser/index.ts free of local or numeric depth declarations', () => {
    const source = readFileSync(join(REPO_ROOT, 'src/renderers/phaser/index.ts'), 'utf8')
    const withoutLineComments = source.replace(/\/\/.*$/gm, '')
    const withoutComments = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, '')

    expect(withoutComments).not.toMatch(/\bconst\s+Z_[A-Z_]+\s*=/)
    expect(withoutComments).not.toMatch(/\.setDepth\(\s*-?\d/)
  })
})
