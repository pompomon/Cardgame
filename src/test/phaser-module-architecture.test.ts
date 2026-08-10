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
  { file: 'card-view.ts', concern: 'retained card display object owner' },
  { file: 'card-view-pool.ts', concern: 'reset card view pool' },
  { file: 'card-view-registry.ts', concern: 'stable card-id reconciliation' },
  { file: 'drag-state.ts', concern: 'pointer-type-aware drag state machine' },
  { file: 'drag-controller.ts', concern: 'drag proxy, cancellation, and action submission owner' },
  { file: 'drop-zone-view.ts', concern: 'retained legal drop and target feedback owner' },
  { file: 'interaction-feedback.ts', concern: 'pure interaction/effect feedback semantics' },
  { file: 'asset-manifest.ts', concern: 'board background / atlas texture manifests' },
  { file: 'texture-loader.ts', concern: 'tiered board texture loading / failure suppression' },
  { file: 'board-background.ts', concern: 'retained board background / ambience owner' },

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

  it('routes retained cards through the dedicated drag controller', () => {
    const battlefieldSource = readFileSync(join(PHASER_DIR, 'battlefield-view.ts'), 'utf8')
    const handSource = readFileSync(join(PHASER_DIR, 'hand-controls.ts'), 'utf8')
    const presenterSource = readFileSync(join(PHASER_DIR, 'gameplay-presenter.ts'), 'utf8')
    const sceneSource = readFileSync(join(PHASER_DIR, 'cardgame-scene.ts'), 'utf8')
    const dragControllerSource = readFileSync(join(PHASER_DIR, 'drag-controller.ts'), 'utf8')
    const cardViewSource = readFileSync(join(PHASER_DIR, 'card-view.ts'), 'utf8')

    expect(battlefieldSource).not.toContain('renderStaticCard')
    expect(handSource).not.toContain('renderStaticCard')
    expect(presenterSource).toContain('ctx.syncCardViews')
    expect(presenterSource.indexOf('ctx.syncCardViews')).toBeLessThan(
      presenterSource.indexOf('renderHandAndControls(ctx'),
    )
    expect(sceneSource).toContain('child !== cardLayer')
    expect(sceneSource).toContain('new DragController({')
    expect(sceneSource).toContain('isInteractionBlocked: () => this.menuOpen\n        || this.battlefieldTargets.getPendingPlayLandTargetSelection() !== null')
    expect(sceneSource).toContain("this.dragController?.cancel('resize')")
    expect(sceneSource).toContain("this.dragController?.cancel('visibility')")
    expect(sceneSource).toContain("this.dragController?.cancel('menu')")
    expect(sceneSource).not.toMatch(/this\.input\.on\(['"](?:dragstart|drag|dragend|drop)/)
    expect(dragControllerSource).toContain('resolvePlayLandDrop(game, source.cardId)')
    expect(dragControllerSource).toContain('this.ctx.submitAction(action)')
    expect(cardViewSource).not.toContain('setDraggable(')
    expect(sceneSource).not.toContain('this.cardViews?.detach()')
    expect(sceneSource).not.toContain('this.rootContainer?.removeAll(true)')
  })
})
