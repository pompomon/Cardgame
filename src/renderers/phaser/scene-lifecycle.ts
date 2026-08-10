import Phaser from 'phaser'

export interface SceneLifecycleEmitter {
  once(event: string, listener: () => void): unknown
  off(event: string, listener: () => void): unknown
}

export function installSceneCleanup(
  events: SceneLifecycleEmitter,
  cleanup: () => void,
): () => void {
  let active = true
  const run = (): void => {
    if (!active) {
      return
    }
    active = false
    events.off(Phaser.Scenes.Events.SHUTDOWN, run)
    events.off(Phaser.Scenes.Events.DESTROY, run)
    cleanup()
  }
  events.once(Phaser.Scenes.Events.SHUTDOWN, run)
  events.once(Phaser.Scenes.Events.DESTROY, run)
  return run
}
