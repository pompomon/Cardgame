// Renders the cardgame scene's header strip: the ☰ Menu button and the
// turn/phase (or winner) label. Extracted from gameplay-presenter.ts so the
// header concern has its own focused module.
import type Phaser from 'phaser'
import type { AppViewModel, GameUiState } from '../../app/types'
import { DEPTH_HEADER, DEPTH_HEADER_STRIP } from './depth'
import { computeHeaderLabel } from './header-label'
import type { SceneLayout } from './layout'
import { COLOR_APP_BACKGROUND, COLOR_WINNER_TEXT, UI_THEME } from './theme'

export interface GameHeaderContext {
  scene: Phaser.Scene
  getLayout: () => SceneLayout
  getRootContainer: () => Phaser.GameObjects.Container | null
  createButton: (label: string, x: number, y: number, onClick: () => void, width?: number, height?: number, fontSize?: string) => Phaser.GameObjects.Container
  openMenuOverlay: (view: AppViewModel) => void
}

export function renderGameHeader(ctx: GameHeaderContext, game: GameUiState, view: AppViewModel): void {
  const layout = ctx.getLayout()
  const rootContainer = ctx.getRootContainer()
  const scene = ctx.scene

  const left = layout.safeAreaLeft + layout.margin

  // Header strip background keeps the Menu button and turn/phase label
  // readable above gameplay elements.
  const headerStripHeight = Math.max(layout.headerHeight, layout.actionButtonHeight + 4)
  const headerStrip = scene.add.rectangle(
    layout.safeAreaCenterX,
    layout.headerTop + headerStripHeight / 2,
    layout.safeAreaWidth,
    headerStripHeight,
    COLOR_APP_BACKGROUND,
    1,
  )
  headerStrip.setDepth(DEPTH_HEADER_STRIP)
  rootContainer?.add(headerStrip)

  // Header: Menu button on the left, then turn/phase label. No Rematch in the
  // header — Rematch lives under the Menu (mirrors DOM PR #13 menu-section 1).
  const menuButtonWidth = Math.min(layout.actionButtonWidth, 180)
  const menuButton = ctx.createButton('☰ Menu', left + menuButtonWidth / 2, layout.headerTop + layout.actionButtonHeight / 2, () => {
    ctx.openMenuOverlay(view)
  }, menuButtonWidth, layout.actionButtonHeight)
  menuButton.setDepth(DEPTH_HEADER)
  rootContainer?.add(menuButton)

  const headerTextX = left + menuButtonWidth + 16
  const headerTextRight = layout.safeAreaLeft + layout.safeAreaWidth - layout.margin
  const headerTextWidth = Math.max(40, headerTextRight - headerTextX)
  // Header label: once the game ends, show ONLY the winner (most important
  // information). Otherwise show the turn/phase string. Inlining both into
  // a single header row caused phone-width viewports to wrap+truncate the
  // winner mid-word, leaving "Winner:" with no player shown. See
  // computeHeaderLabel for the derivation and rationale.
  const headerLabel = computeHeaderLabel({
    winnerText: game.winnerText,
    turn: game.turn,
    phase: game.phase,
  })
  // Cap the header text to a single line so the inlined winner banner can
  // never wrap onto a second row and spill into bodyTop / overlap the log
  // and board area on collapsed phone-sized layouts. Phaser truncates the
  // text at the line boundary when maxLines is set, which is preferable to
  // overflowing the reserved single-row header strip.
  const headerText = scene.add.text(headerTextX, layout.headerTop + layout.actionButtonHeight / 2, headerLabel, {
    color: game.winnerText ? COLOR_WINNER_TEXT : UI_THEME.primaryText,
    fontSize: layout.titleFontSize,
    wordWrap: { width: headerTextWidth },
    maxLines: 1,
  }).setOrigin(0, 0.5)
  headerText.setDepth(DEPTH_HEADER)
  rootContainer?.add(headerText)
}
