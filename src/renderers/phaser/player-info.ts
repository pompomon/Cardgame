// Renders the non-active/active player info panels (name, hand/deck/
// graveyard counts). Extracted from gameplay-presenter.ts.
import type Phaser from 'phaser'
import type { AppViewModel } from '../../app/types'
import { DEPTH_BOARD } from './depth'
import type { SceneLayout } from './layout'
import { buildPolishedPanel } from './visual-primitives'
import { COLOR_BORDER_SUBTLE, COLOR_PLAYER_ACTIVE_FILL, COLOR_PLAYER_NON_ACTIVE_FILL, UI_THEME } from './theme'
import { INFO_PANEL_LINE_HEIGHT_MULTIPLIER, INFO_PANEL_VERTICAL_PADDING } from './scene-config'

export interface PlayerInfoContext {
  scene: Phaser.Scene
  getLayout: () => SceneLayout
  getRootContainer: () => Phaser.GameObjects.Container | null
}

function renderInfoPanel(
  ctx: PlayerInfoContext,
  bgColor: number,
  x: number,
  y: number,
  width: number,
  height: number,
  lines: string[],
): void {
  if (width <= 0 || height <= 0) {
    return
  }
  const scene = ctx.scene
  const layout = ctx.getLayout()
  const rootContainer = ctx.getRootContainer()
  const safeWidth = width
  const safeHeight = height
  const bg = buildPolishedPanel(scene, x + safeWidth / 2, y + safeHeight / 2, {
    fill: bgColor,
    stroke: COLOR_BORDER_SUBTLE,
    width: safeWidth,
    height: safeHeight,
    radius: 10,
    shadow: true,
    shadowAlpha: 0.18,
    shadowOffset: 3,
  })
  bg.setDepth(DEPTH_BOARD)
  rootContainer?.add(bg)
  if (lines.length === 0) {
    return
  }
  const text = scene.add.text(x + 10, y + 6, lines.join('\n'), {
    color: UI_THEME.primaryText,
    fontSize: layout.bodyFontSize,
    wordWrap: { width: Math.max(40, safeWidth - 20) },
  })
  text.setDepth(DEPTH_BOARD)
  rootContainer?.add(text)
}

export function renderPlayerInfoBlocks(ctx: PlayerInfoContext, view: AppViewModel, presentedActor = view.game?.actor ?? 0): void {
  const game = view.game
  if (!game) {
    return
  }
  const layout = ctx.getLayout()

  const activeIndex = presentedActor
  const nonActiveIndex = activeIndex === 0 ? 1 : 0
  const activePlayer = game.players[activeIndex]
  const nonActivePlayer = game.players[nonActiveIndex]

  const nonActiveLines = [
    `Player ${nonActiveIndex + 1} (${view.controllers[nonActiveIndex]})`,
    `Hand: ${nonActivePlayer.handCount} • Deck: ${nonActivePlayer.deckCount} • Graveyard: ${nonActivePlayer.graveyardCount}`,
  ]
  const infoLineHeight = Math.ceil(parseFloat(layout.bodyFontSize) * INFO_PANEL_LINE_HEIGHT_MULTIPLIER)
  const maxNonActiveLines = Math.max(0, Math.floor((layout.nonActiveInfoHeight - INFO_PANEL_VERTICAL_PADDING) / Math.max(1, infoLineHeight)))
  const visibleNonActiveLines = nonActiveLines.slice(0, maxNonActiveLines)
  renderInfoPanel(
    ctx,
    COLOR_PLAYER_NON_ACTIVE_FILL,
    layout.boardColumnLeft,
    layout.nonActiveInfoY,
    layout.boardColumnWidth,
    layout.nonActiveInfoHeight,
    visibleNonActiveLines,
  )

  const activeLines = [
    `Player ${activeIndex + 1} (${view.controllers[activeIndex]}) — Active`,
    `Hand: ${activePlayer.handCount} • Deck: ${activePlayer.deckCount} • Graveyard: ${activePlayer.graveyardCount}`,
  ]
  // On tight viewports the layout limits how many lines of active-info text
  // fit above the controls band (End Turn / response buttons). Render only
  // that many lines so the text does not spill into the controls band or
  // the hand strip on short split layouts (e.g. 720x360 horizontal).
  // During response/plains-target phases we show a dedicated prompt above the
  // controls, so hide the active-info summary lines to avoid text overlap on
  // short split layouts.
  const allowedActiveLines = game.phase === 'respond' || game.phase === 'plains_target' || game.phase === 'swamp_target'
    ? 0
    : Math.max(0, Math.min(activeLines.length, layout.activeInfoTextLines))
  const visibleActiveLines = allowedActiveLines === 0 ? [] : activeLines.slice(0, allowedActiveLines)
  renderInfoPanel(
    ctx,
    COLOR_PLAYER_ACTIVE_FILL,
    layout.boardColumnLeft,
    layout.activeInfoY,
    layout.boardColumnWidth,
    layout.activeInfoHeight,
    visibleActiveLines,
  )
}
