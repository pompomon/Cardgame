// Bootstraps the Phaser.Game instance and its canvas host element. Kept
// separate from PhaserRenderer so mounting/unmounting the Phaser runtime is
// testable in isolation from view-model rendering and DOM overlay wiring.
import Phaser from 'phaser'
import { installViewportResizeSync } from './viewport-resize'
import { BASE_HEIGHT, BASE_WIDTH } from './scene-config'
import { COLOR_APP_BACKGROUND_HEX } from './theme'

export interface SceneHost {
  canvasHost: HTMLDivElement
  game: Phaser.Game
  dispose: () => void
}

export interface CreateSceneHostOptions {
  container: HTMLElement
  scenes: Phaser.Scene[]
  onResize: (size: { width: number; height: number }) => void
}

export function createSceneHost({ container, scenes, onResize }: CreateSceneHostOptions): SceneHost {
  const canvasHost = document.createElement('div')
  canvasHost.className = 'phaser-host'
  container.appendChild(canvasHost)

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: canvasHost.clientWidth > 0 ? canvasHost.clientWidth : BASE_WIDTH,
    height: canvasHost.clientHeight > 0 ? canvasHost.clientHeight : BASE_HEIGHT,
    parent: canvasHost,
    backgroundColor: COLOR_APP_BACKGROUND_HEX,
    transparent: false,
    scene: scenes,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    input: {
      activePointers: 3,
    },
  })

  const removeViewportResizeSync = installViewportResizeSync(canvasHost, (size) => {
    onResize(size)
    game.scale.resize(size.width, size.height)
  })
  let disposed = false

  return {
    canvasHost,
    game,
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      removeViewportResizeSync()
      game.destroy(true)
    },
  }
}
