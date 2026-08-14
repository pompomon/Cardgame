// Log tile content: the pure "which entries are visible vs. capped/omitted"
// selection logic (shared by the visual tiles and the a11y text mirror),
// plus the Phaser tile-building function itself. Extracted from
// menu overlay so the cap/legacy-fallback/empty-state rules — and the
// exact a11y mirror text they produce — can be unit tested without a
// Phaser scene. See docs/agent/phaser-renderer.md "Cap the visual log and
// the a11y mirror."
import type Phaser from 'phaser'
import type { AppViewModel, UiLogEvent } from '../../app/types'
import { isBasicLand } from '../../game/types'
import { addCardArtToContainer } from './card-factory'
import type { SceneLayout } from './layout'
import { formatLogEventText, formatLogEventTile } from './log-events'
import { COLOR_BORDER_SUBTLE, COLOR_PLAYER_ACTIVE_FILL, COLOR_PLAYER_NON_ACTIVE_FILL, UI_THEME } from './theme'
import { MAX_RENDERED_LOG_TILES } from './scene-config'

export interface LogEntrySelection<T> {
  readonly visible: readonly T[]
  readonly omittedCount: number
}

// Caps `events`/`legacyLog` to the most recent MAX_RENDERED_LOG_TILES entries
// (keeping the tail, per the repo-wide "cap arrays, keep the most recent"
// convention) so a long replay or a hostile/corrupted recording can't
// balloon the renderer with thousands of GameObjects or a11y mirror lines.
export function selectVisibleLogEvents(events: readonly UiLogEvent[]): LogEntrySelection<UiLogEvent> {
  const total = events.length
  if (total <= MAX_RENDERED_LOG_TILES) {
    return { visible: events, omittedCount: 0 }
  }
  return { visible: events.slice(total - MAX_RENDERED_LOG_TILES), omittedCount: total - MAX_RENDERED_LOG_TILES }
}

export function selectVisibleLegacyLogLines(lines: readonly string[]): LogEntrySelection<string> {
  const total = lines.length
  if (total <= MAX_RENDERED_LOG_TILES) {
    return { visible: lines, omittedCount: 0 }
  }
  return { visible: lines.slice(total - MAX_RENDERED_LOG_TILES), omittedCount: total - MAX_RENDERED_LOG_TILES }
}

// Pure derivation of the a11y mirror's exact text lines: structured events
// take priority; when the stream is empty (legacy back-filled recording)
// falls back to raw log strings; when both are empty, a fixed placeholder.
// Exported directly so this exact behavior — including the "N older entries
// omitted" prefix — is unit testable without any Phaser scene.
export function buildLogA11yLines(events: readonly UiLogEvent[], legacyLog: readonly string[]): string[] {
  const lines: string[] = []
  if (events.length > 0) {
    const { visible, omittedCount } = selectVisibleLogEvents(events)
    if (omittedCount > 0) {
      lines.push(`… ${omittedCount} older entries omitted`)
    }
    for (const event of visible) {
      lines.push(formatLogEventText(event))
    }
  } else if (legacyLog.length > 0) {
    const { visible, omittedCount } = selectVisibleLegacyLogLines(legacyLog)
    if (omittedCount > 0) {
      lines.push(`… ${omittedCount} older entries omitted`)
    }
    for (const line of visible) {
      lines.push(line)
    }
  } else {
    lines.push('No log entries yet.')
  }
  return lines
}

export interface LogTilesContent {
  container: Phaser.GameObjects.Container
  contentHeight: number
  tileCount: number
}

// Builds a vertical column of structured log "tiles" (actor pill + glyph/art
// + label) inside a container positioned at (0, 0), or plain text rows when
// falling back to a legacy string log. Returns the total content height in
// pixels so callers can drive scrolling.
export function buildLogTiles(
  scene: Phaser.Scene,
  layout: SceneLayout,
  events: readonly UiLogEvent[],
  contentWidth: number,
  visualStyle: AppViewModel['cardVisualStyle'],
  options: { activeActor: number; legacyLog?: readonly string[] },
): LogTilesContent {
  const container = scene.add.container(0, 0)
  const fontSize = parseFloat(layout.smallFontSize) || 12
  const tileSpacing = 4
  const tilePadding = 4
  const iconSize = Math.max(14, Math.round(fontSize * 1.4))
  const pillWidth = Math.max(22, Math.round(fontSize * 2.2))
  const tileHeight = Math.max(iconSize + tilePadding * 2, Math.round(fontSize * 2))
  const activeActor = options.activeActor

  // Legacy fallback: when the structured event stream is missing (e.g.
  // back-filled to [] for a pre-LogEvent recording) but we still have raw
  // log strings, render each string as a plain text row so users don't see
  // an empty panel for content that does exist.
  if (events.length === 0 && options.legacyLog && options.legacyLog.length > 0) {
    let cursorY = 0
    const { visible: visibleLines, omittedCount } = selectVisibleLegacyLogLines(options.legacyLog)
    if (omittedCount > 0) {
      const note = scene.add.text(0, cursorY + tilePadding, `… ${omittedCount} older entries omitted`, {
        color: UI_THEME.secondaryText,
        fontSize: layout.smallFontSize,
        wordWrap: { width: Math.max(20, contentWidth) },
      }).setOrigin(0, 0)
      const noteRowHeight = Math.max(tileHeight, note.height + tilePadding * 2)
      note.setData('rowTop', cursorY)
      note.setData('rowHeight', noteRowHeight)
      container.add(note)
      cursorY += noteRowHeight + tileSpacing
    }
    for (const line of visibleLines) {
      const labelText = scene.add.text(0, 0, line, {
        color: UI_THEME.secondaryText,
        fontSize: layout.smallFontSize,
        wordWrap: { width: Math.max(20, contentWidth) },
        maxLines: 2,
      }).setOrigin(0, 0)
      labelText.y = cursorY + tilePadding
      const rowHeight = Math.max(tileHeight, labelText.height + tilePadding * 2)
      labelText.setData('rowTop', cursorY)
      labelText.setData('rowHeight', rowHeight)
      container.add(labelText)
      cursorY += rowHeight + tileSpacing
    }
    const contentHeight = Math.max(0, cursorY - tileSpacing)
    return { container, contentHeight, tileCount: visibleLines.length }
  }

  if (events.length === 0) {
    const empty = scene.add.text(0, 0, 'No log entries yet.', {
      color: UI_THEME.secondaryText,
      fontSize: layout.smallFontSize,
      wordWrap: { width: Math.max(40, contentWidth) },
    }).setOrigin(0, 0)
    empty.setData('rowTop', 0)
    empty.setData('rowHeight', empty.height)
    container.add(empty)
    return { container, contentHeight: empty.height, tileCount: 0 }
  }

  let cursorY = 0
  // Cap the number of materialized tiles regardless of `events.length` so a
  // long replay or imported recording doesn't freeze the renderer with
  // thousands of GameObjects. Render the most recent slice and prepend a
  // single notice row indicating how many older entries were omitted.
  const { visible: visibleEvents, omittedCount } = selectVisibleLogEvents(events)
  if (omittedCount > 0) {
    const note = scene.add.text(0, cursorY + tilePadding, `… ${omittedCount} older entries omitted`, {
      color: UI_THEME.secondaryText,
      fontSize: layout.smallFontSize,
      wordWrap: { width: Math.max(20, contentWidth) },
    }).setOrigin(0, 0)
    const noteRowHeight = Math.max(tileHeight, note.height + tilePadding * 2)
    note.setData('rowTop', cursorY)
    note.setData('rowHeight', noteRowHeight)
    container.add(note)
    cursorY += noteRowHeight + tileSpacing
  }
  for (const event of visibleEvents) {
    const tile = formatLogEventTile(event)

    // Layout strategy: create the label first (it's the variable-height
    // element due to word-wrap), measure it, then derive `rowHeight` so
    // pill / icon / label can all be vertically centered against the same
    // axis. This avoids the previous overlap where a wrapped label could
    // extend above the row baseline and clip into the previous tile.
    let contentX = 0
    const hasPill = tile.actor !== null
    if (hasPill) {
      contentX += pillWidth + 6
    }
    contentX += iconSize + 6
    const labelWidth = Math.max(20, contentWidth - contentX)
    const labelText = scene.add.text(0, 0, tile.label, {
      color: UI_THEME.secondaryText,
      fontSize: layout.smallFontSize,
      wordWrap: { width: labelWidth },
      maxLines: 2,
    }).setOrigin(0, 0)

    const rowHeight = Math.max(tileHeight, labelText.height + tilePadding * 2)
    const verticalCenter = rowHeight / 2
    const row = scene.add.container(0, cursorY)

    if (hasPill && tile.actor !== null) {
      // Active vs non-active palette colors track the actor flagged as
      // currently acting, not a fixed P1/P2 mapping. This matches the
      // player info panels at COLOR_PLAYER_(NON_)ACTIVE_FILL usages.
      const isActive = tile.actor === activeActor
      const fill = isActive ? COLOR_PLAYER_ACTIVE_FILL : COLOR_PLAYER_NON_ACTIVE_FILL
      const pillBg = scene.add.rectangle(0, verticalCenter, pillWidth, tileHeight - 2, fill, 0.85)
        .setStrokeStyle(1, COLOR_BORDER_SUBTLE)
        .setOrigin(0, 0.5)
      const pillText = scene.add.text(pillWidth / 2, verticalCenter, `P${tile.actor + 1}`, {
        color: UI_THEME.primaryText,
        fontSize: layout.smallFontSize,
      }).setOrigin(0.5, 0.5)
      row.add(pillBg)
      row.add(pillText)
    }

    const iconX = (hasPill ? pillWidth + 6 : 0) + iconSize / 2
    if (tile.cardName !== null && isBasicLand(tile.cardName)) {
      addCardArtToContainer(scene, tile.cardName, visualStyle, iconX, verticalCenter, iconSize, row)
    } else {
      const glyph = scene.add.text(iconX, verticalCenter, tile.glyph, {
        color: UI_THEME.secondaryText,
        fontSize: layout.smallFontSize,
      }).setOrigin(0.5, 0.5)
      row.add(glyph)
    }

    labelText.x = contentX
    labelText.y = verticalCenter
    labelText.setOrigin(0, 0.5)
    row.add(labelText)

    row.setData('rowTop', cursorY)
    row.setData('rowHeight', rowHeight)
    container.add(row)
    cursorY += rowHeight + tileSpacing
  }
  const contentHeight = Math.max(0, cursorY - tileSpacing)
  return { container, contentHeight, tileCount: visibleEvents.length }
}
