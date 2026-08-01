import Phaser from 'phaser'
import type { SceneLayout } from './layout'
import type { CounterHandOptions } from './response-options'

interface ResponseControlsOptions {
  scene: Phaser.Scene
  root: Phaser.GameObjects.Container
  layout: SceneLayout
  response: CounterHandOptions
  textColor: string
  createButton: (
    label: string,
    x: number,
    y: number,
    onClick: () => void,
    width: number,
    height: number,
    fontSize?: string,
  ) => Phaser.GameObjects.Container
  onPass: () => void
}

export function renderResponseControls(options: ResponseControlsOptions): void {
  const { layout, response } = options
  const passWidth = Math.min(140, Math.max(72, layout.boardColumnWidth * 0.24))
  const passHeight = Math.min(layout.actionButtonHeight, Math.max(20, layout.activeInfoControlsHeight))
  const controlsLeft = layout.boardColumnLeft + 4
  const controlsRight = layout.boardColumnLeft + layout.boardColumnWidth - 4
  const instructionWidth = Math.max(40, controlsRight - controlsLeft - (response.canPass ? passWidth + 8 : 0))
  options.root.add(options.scene.add.text(controlsLeft, layout.controlsStartY, response.instruction, {
    color: options.textColor,
    fontSize: layout.smallFontSize,
    wordWrap: { width: instructionWidth },
  }).setOrigin(0, 0.5))
  if (response.canPass) {
    options.root.add(options.createButton(
      'Pass',
      controlsRight - passWidth / 2,
      layout.controlsStartY,
      options.onPass,
      passWidth,
      passHeight,
      layout.actionButtonFontSize,
    ))
  }
}
