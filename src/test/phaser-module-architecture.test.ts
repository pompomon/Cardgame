import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(__dirname, '..', '..')
const PHASER_DIR = join(REPO_ROOT, 'src/renderers/phaser')

// Guards the phaser renderer module map documented in
// docs/agent/architecture.md. If a future refactor renames/merges/removes
// one of these, update this list AND the architecture doc together so they
// never silently drift apart. Grouped by the concern each module owns.
const REQUIRED_MODULES: Array<{ file: string; concern: string }> = [
  // Composition root + shared plumbing
  { file: 'index.ts', concern: 'PhaserRenderer composition root' },
  { file: 'renderer-host.ts', concern: 'PhaserRendererHost interface (breaks scene -> root import cycle)' },
  { file: 'scene-host.ts', concern: 'Phaser.Game bootstrap' },
  { file: 'theme.ts', concern: 'color palette / CardStyle' },
  { file: 'scene-config.ts', concern: 'scene-wide numeric constants + scene keys' },

  // Card art
  { file: 'card-art-loader.ts', concern: 'card art texture preloading' },
  { file: 'card-factory.ts', concern: 'card GameObject factory' },
  { file: 'asset-manifest.ts', concern: 'board background / atlas texture manifests' },
  { file: 'texture-loader.ts', concern: 'tiered board texture loading / failure suppression' },
  { file: 'board-background.ts', concern: 'retained board background / adaptive ambience' },

  // Lobby
  { file: 'lobby-scene.ts', concern: 'lobby scene' },
  { file: 'lobby-actions.ts', concern: 'lobby action models/predicates' },

  // Cardgame scene + gameplay presentation
  { file: 'cardgame-scene.ts', concern: 'cardgame scene orchestrator' },
  { file: 'gameplay-presenter.ts', concern: 'gameplay render-pass composer' },
  { file: 'game-header.ts', concern: 'header strip renderer' },
  { file: 'player-info.ts', concern: 'player info panels renderer' },
  { file: 'battlefield-view.ts', concern: 'battlefield renderer' },
  { file: 'hand-controls.ts', concern: 'hand + phase controls renderer' },

  // Log
  { file: 'log-tiles.ts', concern: 'log tile cap/legacy/empty/a11y content' },

  // Target selection
  { file: 'battlefield-targets.ts', concern: 'battlefield target pure state/a11y' },
  { file: 'target-picker.ts', concern: 'target picker popup UI' },

  // Effects
  { file: 'effect-controller.ts', concern: 'effect queue + card position registries' },

  // P2P / a11y / recording utilities
  { file: 'p2p-overlay.ts', concern: 'P2P manual signaling overlay' },
  { file: 'a11y-navigation.ts', concern: 'accessibility navigation mirror' },
  { file: 'recording-file-actions.ts', concern: 'recording file input/download' },
]

describe('phaser renderer module architecture', () => {
  it.each(REQUIRED_MODULES)('$file exists (owns: $concern)', ({ file }) => {
    expect(existsSync(join(PHASER_DIR, file))).toBe(true)
  })

  it('keeps index.ts as a lean composition root (no scene class bodies)', () => {
    const source = readFileSync(join(PHASER_DIR, 'index.ts'), 'utf8')
    expect(source).not.toMatch(/class\s+LobbyScene/)
    expect(source).not.toMatch(/class\s+CardgameScene/)
    expect(source).toMatch(/class\s+PhaserRenderer/)
  })

  it('does not resurrect the removed target-selection.ts monolith', () => {
    expect(existsSync(join(PHASER_DIR, 'target-selection.ts'))).toBe(false)
  })

  it('renames P2P/a11y/recording utilities to their canonical names', () => {
    expect(existsSync(join(PHASER_DIR, 'a11y-nav.ts'))).toBe(false)
    expect(existsSync(join(PHASER_DIR, 'recording-controls.ts'))).toBe(false)
  })

  it('wires board asset preload and the retained background into CardgameScene', () => {
    const source = readFileSync(join(PHASER_DIR, 'cardgame-scene.ts'), 'utf8')
    expect(source).toMatch(/preloadPhaserBoardAssets\(/)
    expect(source).toMatch(/new BoardBackgroundView\(/)
    expect(source).toMatch(/boardBackground\?\.sync\(/)
  })
})
