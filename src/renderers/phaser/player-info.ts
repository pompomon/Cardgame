// Renders the non-active/active player info panels (name, hand count) plus
// a small deck/graveyard "physical stack" visual. Extracted from
// gameplay-presenter.ts.
import type Phaser from 'phaser'
import { resolveBoardPlayerSlots } from '../../app/board-presentation'
import type { AppViewModel } from '../../app/types'
import { DEPTH_BOARD } from './depth'
import type { SceneLayout } from './layout'
import { buildPolishedPanel } from './visual-primitives'
import {
  COLOR_BATTLEFIELD_ACTIVE_STROKE,
  COLOR_BATTLEFIELD_NON_ACTIVE_STROKE,
  COLOR_CARD_BACK_FILL,
  COLOR_CARD_BACK_INNER_FILL,
  COLOR_CARD_BACK_STROKE,
  COLOR_FELT_ACTIVE_GLOW,
  COLOR_PLAYER_PANEL_FILL,
  COLOR_STATUS_ACTIVE_FILL,
  COLOR_STATUS_NON_ACTIVE_FILL,
  STATUS_FILL_ALPHA,
  UI_THEME,
} from './theme'
import { INFO_PANEL_LINE_HEIGHT_MULTIPLIER, INFO_PANEL_VERTICAL_PADDING } from './scene-config'

export interface PlayerInfoContext {
  scene: Phaser.Scene
  getLayout: () => SceneLayout
  getRootContainer: () => Phaser.GameObjects.Container | null
}

// Draws a small offset "N-card" stack silhouette (deck or graveyard) with a
// count badge, reusing the same card-back tones as the hidden-hand card
// placeholder. An empty stack collapses to a single flat, unshadowed layer
// instead of drawing phantom cards.
function renderMiniCardStack(
  ctx: PlayerInfoContext,
  centerX: number,
  centerY: number,
  count: number,
  label: string,
): void {
  const scene = ctx.scene
  const rootContainer = ctx.getRootContainer()
  const stackWidth = 20
  const stackHeight = 27
  const layerCount = count > 0 ? 3 : 1
  const layerOffset = 2
  const container = scene.add.container(centerX, centerY)
  for (let i = 0; i < layerCount; i += 1) {
    const depth = layerCount - 1 - i
    const layer = scene.add.rectangle(
      0,
      depth * layerOffset,
      stackWidth,
      stackHeight,
      count > 0 ? COLOR_CARD_BACK_INNER_FILL : 0xffffff,
      count > 0 ? 1 : 0.06,
    )
    layer.setStrokeStyle(1, COLOR_CARD_BACK_STROKE, count > 0 ? 0.9 : 0.4)
    container.add(layer)
  }
  if (count > 0) {
    const face = scene.add.rectangle(0, 0, stackWidth, stackHeight, COLOR_CARD_BACK_FILL)
    face.setStrokeStyle(1, COLOR_CARD_BACK_STROKE)
    container.add(face)
  }
  const badge = scene.add.text(0, stackHeight / 2 + 9, `${label}: ${count}`, {
    color: UI_THEME.secondaryText,
    fontSize: ctx.getLayout().smallFontSize,
    align: 'center',
  }).setOrigin(0.5, 0)
  container.add(badge)
  container.setDepth(DEPTH_BOARD)
  rootContainer?.add(container)
}

function renderInfoPanel(
  ctx: PlayerInfoContext,
  isActive: boolean,
  x: number,
  y: number,
  width: number,
  height: number,
  lines: string[],
  deckCount: number,
  graveyardCount: number,
  textWidth = width,
): void {
  if (width <= 0 || height <= 0) {
    return
  }
  const scene = ctx.scene
  const layout = ctx.getLayout()
  const rootContainer = ctx.getRootContainer()
  const safeWidth = width
  const safeHeight = height
  const strokeColor = isActive ? COLOR_BATTLEFIELD_ACTIVE_STROKE : COLOR_BATTLEFIELD_NON_ACTIVE_STROKE
  const bg = buildPolishedPanel(scene, x + safeWidth / 2, y + safeHeight / 2, {
    fill: COLOR_PLAYER_PANEL_FILL,
    stroke: strokeColor,
    width: safeWidth,
    height: safeHeight,
    radius: 10,
    strokeWidth: isActive ? 2 : 1,
    shadow: true,
    shadowAlpha: 0.18,
    shadowOffset: 3,
    tint: {
      color: isActive ? COLOR_STATUS_ACTIVE_FILL : COLOR_STATUS_NON_ACTIVE_FILL,
      alpha: STATUS_FILL_ALPHA,
    },
  })
  bg.setDepth(DEPTH_BOARD)
  rootContainer?.add(bg)
  // Restrained active-player lighting supplements the shared low-alpha tint.
  if (isActive) {
    const glow = scene.add.graphics()
    glow.lineStyle(6, COLOR_FELT_ACTIVE_GLOW, 0.16)
    glow.strokeRoundedRect(x - 2, y - 2, safeWidth + 4, safeHeight + 4, 12)
    glow.setDepth(DEPTH_BOARD)
    rootContainer?.add(glow)
  }
  // Physical deck/graveyard stacks, anchored to the right edge of the panel
  // so they never collide with the name/hand-count text on the left.
  const stackAreaWidth = Math.min(120, safeWidth * 0.3)
  if (stackAreaWidth >= 60 && safeHeight >= 44) {
    const stacksY = y + safeHeight / 2
    const deckX = x + safeWidth - stackAreaWidth * 0.72
    const graveyardX = x + safeWidth - stackAreaWidth * 0.28
    renderMiniCardStack(ctx, deckX, stacksY, deckCount, 'Deck')
    renderMiniCardStack(ctx, graveyardX, stacksY, graveyardCount, 'GY')
  }
  if (lines.length === 0) {
    return
  }
  const text = scene.add.text(x + 10, y + 6, lines.join('\n'), {
    color: UI_THEME.primaryText,
    fontSize: layout.bodyFontSize,
    wordWrap: { width: Math.max(40, textWidth - (stackAreaWidth >= 60 ? stackAreaWidth : 0) - 20) },
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

  const slots = resolveBoardPlayerSlots(presentedActor, game.actor)
  const nearPlayer = game.players[slots.nearIndex]
  const farPlayer = game.players[slots.farIndex]

  const farLines = [
    `Player ${slots.farIndex + 1} (${view.controllers[slots.farIndex]})${slots.farIsActive ? ' — Active' : ''}`,
    `Hand: ${farPlayer.handCount}`,
  ]
  const infoLineHeight = Math.ceil(parseFloat(layout.bodyFontSize) * INFO_PANEL_LINE_HEIGHT_MULTIPLIER)
  const maxNonActiveLines = Math.max(0, Math.floor((layout.nonActiveInfoHeight - INFO_PANEL_VERTICAL_PADDING) / Math.max(1, infoLineHeight)))
  const visibleFarLines = farLines.slice(0, maxNonActiveLines)
  renderInfoPanel(
    ctx,
    slots.farIsActive,
    layout.boardColumnLeft,
    layout.nonActiveInfoY,
    layout.boardColumnWidth,
    layout.nonActiveInfoHeight,
    visibleFarLines,
    farPlayer.deckCount,
    farPlayer.graveyardCount,
  )

  const nearLines = [
    `Player ${slots.nearIndex + 1} (${view.controllers[slots.nearIndex]})${slots.nearIsActive ? ' — Active' : ''}`,
    `Hand: ${nearPlayer.handCount}`,
  ]
  // On tight viewports the layout limits how many lines of active-info text
  // fit above the controls band (End Turn / response buttons). Render only
  // that many lines so the text does not spill into the controls band or
  // the hand strip on short split layouts (e.g. 720x360 horizontal).
  // During response/plains-target phases we show a dedicated prompt above the
  // controls, so hide the active-info summary lines to avoid text overlap on
  // short split layouts.
  const allowedActiveLines = slots.nearIsActive
    && (game.phase === 'respond' || game.phase === 'plains_target' || game.phase === 'swamp_target')
    ? 0
    : Math.max(0, Math.min(nearLines.length, layout.activeInfoTextLines))
  const visibleNearLines = allowedActiveLines === 0 ? [] : nearLines.slice(0, allowedActiveLines)
  renderInfoPanel(
    ctx,
    slots.nearIsActive,
    layout.boardColumnLeft,
    layout.activeInfoY,
    layout.boardColumnWidth,
    layout.activeInfoHeight,
    visibleNearLines,
    nearPlayer.deckCount,
    nearPlayer.graveyardCount,
    layout.orientation === 'horizontal'
      ? Math.max(40, layout.handColumnLeft - layout.boardColumnLeft)
      : layout.boardColumnWidth,
  )
}
