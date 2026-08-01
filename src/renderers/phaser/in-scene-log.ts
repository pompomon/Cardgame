// Renders the in-scene "Replay Log" panel: the panel background/heading,
// the scrollable viewport (geometry mask + explicit row culling for WebGL),
// and the hidden a11y text mirror. Tile content itself (cap/legacy-fallback/
// empty-state rules and per-tile layout) lives in log-tiles.ts; this module
// owns only the panel chrome and its own scroll-offset/pinned-to-bottom
// state. Extracted from CardgameScene (see docs/agent/phaser-renderer.md
// "Log rendering rules").
import Phaser from 'phaser'
import type { AppViewModel } from '../../app/types'
import type { LogEvent } from '../../game/types'
import { DEPTH_REPLAY_LOG, DEPTH_REPLAY_LOG_HEADING } from './depth'
import type { SceneLayout } from './layout'
import { buildLogA11yLines, buildLogTiles, type LogTilesContent } from './log-tiles'
import { cullRowsToViewport } from './log-row-visibility'
import { computeLogScrollLayout } from './log-scroll'
import { bindScrollableViewport } from './scrollable-viewport'
import { buildPolishedPanel } from './visual-primitives'
import { COLOR_BORDER_SUBTLE, COLOR_LOG_PANEL_FILL, COLOR_LOG_VIEWPORT_FILL, UI_THEME } from './theme'
import { SCROLL_INDICATOR_RIGHT_OFFSET } from './scene-config'

export interface InSceneLogContext {
  scene: Phaser.Scene
  getLayout: () => SceneLayout
  getRootContainer: () => Phaser.GameObjects.Container | null
  getVisualStyle: () => AppViewModel['cardVisualStyle']
}

export class InSceneLogRenderer {
  private readonly ctx: InSceneLogContext
  private scrollOffset: number | null = null
  private pinnedToBottom = true

  constructor(ctx: InSceneLogContext) {
    this.ctx = ctx
  }

  // Reset the scroll state when the seed changes (e.g. a rematch) so the
  // next game opens with the log pinned to the newest entry instead of
  // preserving the stale offset from the previous match.
  reset(): void {
    this.scrollOffset = null
    this.pinnedToBottom = true
  }

  // Thin delegation kept so CardgameScene/menu-overlay callers don't need to
  // import log-tiles.ts directly.
  buildLogTilesContent(
    events: readonly LogEvent[],
    contentWidth: number,
    visualStyle: AppViewModel['cardVisualStyle'],
    options: { activeActor: number; legacyLog?: readonly string[] },
  ): LogTilesContent {
    return buildLogTiles(this.ctx.scene, this.ctx.getLayout(), events, contentWidth, visualStyle, options)
  }

  render(events: readonly LogEvent[], legacyLog: readonly string[], activeActor: number): void {
    const scene = this.ctx.scene
    const layout = this.ctx.getLayout()
    const rootContainer = this.ctx.getRootContainer()
    const x = layout.logColumnLeft
    const y = layout.logColumnTop
    const width = layout.logColumnWidth
    const height = layout.logColumnHeight
    if (width <= 0 || height <= 0) {
      return
    }

    const panelBg = buildPolishedPanel(
      scene,
      x + width / 2,
      y + height / 2,
      {
        fill: COLOR_LOG_PANEL_FILL,
        stroke: COLOR_BORDER_SUBTLE,
        width,
        height,
        radius: 12,
        shadow: true,
        shadowAlpha: 0.18,
        shadowOffset: 4,
      },
    )
    panelBg.setDepth(DEPTH_REPLAY_LOG)
    rootContainer?.add(panelBg)

    const padding = 10
    const headingTop = y + 6
    const heading = scene.add.text(x + padding, headingTop, 'Replay Log', {
      color: UI_THEME.primaryText,
      fontSize: layout.subtitleFontSize,
    })
    // Heading sits above the scrollable log content (drawn at
    // DEPTH_REPLAY_LOG), so it stays readable even if a row-cull regression
    // lets a partial row overlap the heading's Y band. Keep this just above
    // the log layer so it remains above log rows but below gameplay UI at
    // default depth 0.
    heading.setDepth(DEPTH_REPLAY_LOG_HEADING)
    rootContainer?.add(heading)

    // Hidden screen-reader / accessibility mirror: keep a flat text version of
    // the log so any tooling that scans Phaser text still sees the same
    // information that the DOM renderer's <ul>-based log shows. Delegates the
    // exact line selection (cap/legacy-fallback/empty-state) to the pure,
    // unit-tested `buildLogA11yLines` in log-tiles.ts.
    const a11yMirror = scene.add.text(x + padding, headingTop, buildLogA11yLines(events, legacyLog).join('\n'), {
      color: '#000000',
      fontSize: layout.smallFontSize,
    }).setVisible(false)
    a11yMirror.setData('log-a11y-mirror', true)
    rootContainer?.add(a11yMirror)

    const viewportTop = heading.y + heading.height + 6
    const viewportBottom = y + height - padding
    const viewportHeight = viewportBottom - viewportTop
    const viewportLeft = x + padding
    const viewportWidth = width - padding * 2
    if (viewportHeight <= 0 || viewportWidth <= 0) {
      panelBg.destroy()
      heading.destroy()
      a11yMirror.destroy()
      return
    }

    const viewportBg = scene.add.rectangle(
      viewportLeft + viewportWidth / 2,
      viewportTop + viewportHeight / 2,
      viewportWidth,
      viewportHeight,
      COLOR_LOG_VIEWPORT_FILL,
      0.6,
    ).setStrokeStyle(1, COLOR_BORDER_SUBTLE)
    viewportBg.setInteractive()
    viewportBg.setDepth(DEPTH_REPLAY_LOG)
    rootContainer?.add(viewportBg)

    const visualStyle = this.ctx.getVisualStyle()
    const tileColumnWidth = Math.max(40, viewportWidth - 12)
    const { container: tilesColumn, contentHeight } = this.buildLogTilesContent(events, tileColumnWidth, visualStyle, { activeActor, legacyLog })
    const contentTopY = viewportTop + 6
    const logContent = scene.add.container(viewportLeft + 6, contentTopY, [tilesColumn])
    logContent.setDepth(DEPTH_REPLAY_LOG)
    rootContainer?.add(logContent)

    // Bitmap masks were dropped in Phaser 4, and GeometryMask is documented to
    // only clip in the Canvas renderer (in WebGL it silently no-ops). We keep
    // the geometry mask for the Canvas backend and additionally cull every
    // tile row whose world Y falls outside the viewport rect, so log content
    // never paints over the header strip / player-info container even on
    // WebGL where the mask is a no-op. See `cullRowsToViewport`.
    const logMask = scene.add.graphics()
    logMask.setVisible(false)
    logMask.fillStyle(0xffffff)
    logMask.fillRect(viewportLeft, viewportTop, viewportWidth, viewportHeight)
    logContent.setMask(logMask.createGeometryMask())
    // Track the mask graphic on the content container so it is destroyed
    // when `clearRoot()` removes the content (Phaser only auto-destroys the
    // mask source when it's a child of the masked object's display list).
    logContent.setData('log-mask-graphic', logMask)
    logContent.once(Phaser.GameObjects.Events.DESTROY, () => {
      logMask.destroy()
    })

    const scroll = computeLogScrollLayout({
      contentTopY,
      viewportTopY: viewportTop,
      viewportBottomY: viewportBottom,
      contentHeight,
      bottomPadding: 12,
      requestedOffset: this.scrollOffset,
      pinnedToBottom: this.pinnedToBottom,
    })
    this.scrollOffset = scroll.scrollOffset
    this.pinnedToBottom = scroll.pinnedToBottom
    logContent.y = scroll.contentY
    cullRowsToViewport({
      rowsContainer: tilesColumn,
      columnOriginY: logContent.y,
      viewportTopY: viewportTop,
      viewportBottomY: viewportBottom,
      mode: 'contained',
    })

    if (scroll.maxScroll > 0) {
      let scrollOffset = scroll.scrollOffset
      const maxScroll = scroll.maxScroll
      const applyScroll = (deltaY: number): void => {
        scrollOffset = Phaser.Math.Clamp(scrollOffset + deltaY, 0, maxScroll)
        this.scrollOffset = scrollOffset
        this.pinnedToBottom = scrollOffset >= maxScroll
        logContent.y = contentTopY - scrollOffset
        cullRowsToViewport({
          rowsContainer: tilesColumn,
          columnOriginY: logContent.y,
          viewportTopY: viewportTop,
          viewportBottomY: viewportBottom,
          mode: 'contained',
        })
      }
      bindScrollableViewport(
        scene,
        viewportBg,
        applyScroll,
      )
      // Scroll affordance: a small unobtrusive hint anchored to the top-right
      // of the viewport that signals older entries are reachable by scrolling.
      // The previous overflow visually misled users into thinking the log
      // was bleeding into the header — making scroll discoverable mitigates
      // that even when the mask is working as intended.
      const scrollHint = scene.add.text(
        viewportLeft + viewportWidth - SCROLL_INDICATOR_RIGHT_OFFSET,
        viewportTop + 2,
        '▲ scroll',
        {
          color: UI_THEME.secondaryText,
          fontSize: layout.smallFontSize,
        },
      ).setOrigin(1, 0)
      scrollHint.setDepth(DEPTH_REPLAY_LOG)
      rootContainer?.add(scrollHint)
    }
  }
}
