import Phaser from 'phaser'

import { clamp } from './layout'
import { buildPolishedPanel } from './visual-primitives'

export const BUTTON_TEXT_HORIZONTAL_PADDING = 24
const BUTTON_TEXT_HEIGHT_RATIO = 0.42
const BUTTON_TEXT_NARROW_WIDTH_THRESHOLD = 180
const BUTTON_TEXT_NARROW_WIDTH_SCALE = 0.92
export const BUTTON_TEXT_MAX_LINES = 2
// Keep renderer-side clamping aligned with layout button typography limits.
const MIN_BUTTON_FONT_PX = 12
const MAX_BUTTON_FONT_PX = 20

export interface ButtonTheme {
  fill: number
  stroke: number
  text: string
}

export function buildButton(
  scene: Phaser.Scene,
  label: string,
  x: number,
  y: number,
  fontSize: string,
  width: number,
  height: number,
  onClick: () => void,
  theme: ButtonTheme,
): Phaser.GameObjects.Container {
  const requestedPx = Number.parseFloat(fontSize)
  const derivedPx = clamp(height * BUTTON_TEXT_HEIGHT_RATIO, MIN_BUTTON_FONT_PX, MAX_BUTTON_FONT_PX)
  const widthScale = width < BUTTON_TEXT_NARROW_WIDTH_THRESHOLD ? BUTTON_TEXT_NARROW_WIDTH_SCALE : 1
  const resolvedPx = clamp(
    Math.min(Number.isFinite(requestedPx) ? requestedPx : derivedPx, derivedPx * 1.08) * widthScale,
    MIN_BUTTON_FONT_PX,
    MAX_BUTTON_FONT_PX,
  )
  const background = buildPolishedPanel(scene, 0, 0, {
    fill: theme.fill,
    stroke: theme.stroke,
    width,
    height,
    radius: 10,
    strokeWidth: 1,
    shadow: true,
    shadowAlpha: 0.2,
    shadowOffset: 3,
  })
  const text = scene.add.text(0, 0, label, {
    color: theme.text,
    fontSize: `${Math.round(resolvedPx)}px`,
    align: 'center',
    wordWrap: { width: Math.max(8, width - BUTTON_TEXT_HORIZONTAL_PADDING) },
    maxLines: BUTTON_TEXT_MAX_LINES,
  }).setOrigin(0.5)
  const button = scene.add.container(x, y, [background, text])
  button.setSize(width, height)
  button.setInteractive({ useHandCursor: true })
  button.on('pointerover', () => {
    button.setScale(1.015)
  })
  button.on('pointerout', () => {
    button.setScale(1)
  })
  button.on('pointerdown', () => {
    button.setScale(0.985)
  })
  button.on('pointerup', () => {
    button.setScale(1.015)
  })
  button.on('pointerup', onClick)
  return button
}
