import type { AppViewModel, GameUiState } from '../../app/types'
import { escapeHtml, renderLandIcon } from '../dom-utils'
import { formatLogEventText, formatLogEventTile } from '../phaser/log-events'
import { MAX_RENDERED_LOG_TILES } from '../phaser/scene-config'

export function renderThreeLog(game: GameUiState, style: AppViewModel['cardVisualStyle']): string {
  const events = game.events ?? []
  const total = events.length || game.log.length
  const omitted = Math.max(0, total - MAX_RENDERED_LOG_TILES)
  const rows = events.length
    ? events.slice(-MAX_RENDERED_LOG_TILES).map((event) => {
      const tile = formatLogEventTile(event)
      const badge = tile.actor === null ? '' : `<span class="three-log-actor" data-active="${tile.actor === game.actor}">P${tile.actor + 1}</span>`
      const icon = tile.cardName === null
        ? `<span class="three-log-glyph">${escapeHtml(tile.glyph)}</span>`
        : renderLandIcon(tile.cardName, style, 32, 'three-log-art')
      return `<li class="three-log-entry"><span class="three-log-visual" aria-hidden="true">${badge}${icon}<span>${escapeHtml(tile.label)}</span></span><span class="three-sr-only">${escapeHtml(formatLogEventText(event))}</span></li>`
    }).join('')
    : game.log.slice(-MAX_RENDERED_LOG_TILES).map((line) => `<li class="three-log-entry">${escapeHtml(line)}</li>`).join('')
  return `<details data-detail-key="log"><summary>Replay Log (${Math.min(total, MAX_RENDERED_LOG_TILES)} latest)</summary>
    <div class="three-log-scroll" data-scroll-key="log" role="region" aria-label="Replay log entries" tabindex="0">
      ${omitted ? `<p>… ${omitted} older entries omitted. Export the recording for the full history.</p>` : ''}
      ${rows ? `<ol class="three-log-entries">${rows}</ol>` : '<p>No log entries yet.</p>'}
    </div><button type="button" data-action="log-latest">Follow latest</button></details>`
}
