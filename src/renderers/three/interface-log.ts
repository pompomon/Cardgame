import {
  MAX_RENDERED_LOG_TILES,
  presentLegacyLogLine,
  presentLogEvent,
  type PresentedLogEntry,
} from '../../app/log-presentation'
import type { AppViewModel, ControllerKind, GameUiState } from '../../app/types'
import { escapeHtml, renderLandIcon } from './native-html'

function renderLogEntry(
  entry: PresentedLogEntry,
  game: GameUiState,
  style: AppViewModel['cardVisualStyle'],
): string {
  const badge = entry.actor === null
    ? ''
    : `<span class="three-log-actor" data-active="${entry.actor === game.actor}">P${entry.actor + 1}</span>`
  const icon = entry.card === null
    ? `<span class="three-log-glyph">${escapeHtml(entry.glyph)}</span>`
    : renderLandIcon(entry.card.serializedKey, style, 32, 'three-log-art')
  return `<li class="three-log-entry"><span class="three-log-visual" aria-hidden="true">${badge}${icon}<span>${escapeHtml(entry.label)}</span></span><span class="three-sr-only">${escapeHtml(entry.text)}</span></li>`
}

export function renderThreeLog(
  game: GameUiState,
  style: AppViewModel['cardVisualStyle'],
  controllers: readonly [ControllerKind, ControllerKind],
): string {
  const events = game.events ?? []
  const total = events.length || game.log.length
  const omitted = Math.max(0, total - MAX_RENDERED_LOG_TILES)
  const viewer = { controllers }
  const rows = events.length
    ? events
        .slice(-MAX_RENDERED_LOG_TILES)
        .map((event) => renderLogEntry(presentLogEvent(event, viewer), game, style))
        .join('')
    : game.log
        .slice(-MAX_RENDERED_LOG_TILES)
        .map((line) => renderLogEntry(presentLegacyLogLine(line, viewer), game, style))
        .join('')
  return `<details data-detail-key="log"><summary>Replay Log (${Math.min(total, MAX_RENDERED_LOG_TILES)} latest)</summary>
    <div class="three-log-scroll" data-scroll-key="log" role="region" aria-label="Replay log entries" tabindex="0">
      ${omitted ? `<p>… ${omitted} older entries omitted. Export the recording for the full history.</p>` : ''}
      ${rows ? `<ol class="three-log-entries">${rows}</ol>` : '<p>No log entries yet.</p>'}
    </div><button type="button" data-action="log-latest">Follow latest</button></details>`
}
