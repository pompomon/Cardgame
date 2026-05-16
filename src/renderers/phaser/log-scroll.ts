// Pure scroll-positioning math for the in-scene Replay Log (and the menu
// overlay's mirrored log viewport). Extracted from the Phaser renderer so
// the clamping/pin-to-bottom behavior is unit-testable without spinning up
// Phaser or JSDOM.
//
// Inputs describe a vertical scrollable strip:
//   - `contentTopY`: world Y where the content origin sits when scrollOffset is 0.
//   - `viewportTopY` / `viewportBottomY`: world bounds of the visible strip.
//   - `contentHeight`: total height of the rendered tile column.
//   - `requestedOffset`: caller's desired scroll offset; clamped to [0, maxScroll].
//   - `pinnedToBottom`: when true (or when requestedOffset is null), snap to
//     the most-recent entries so a freshly-appended log line is visible.
//
// Outputs a clamped offset plus the resulting `contentY` world position. The
// returned `contentY` is guaranteed to satisfy:
//   contentTopY - maxScroll <= contentY <= contentTopY
// (i.e. the content top is never above its baseline `contentTopY` and never
// scrolled past `maxScroll` below it). Callers typically set
// `contentTopY = viewportTopY + topInset` so this also keeps the rendered
// content from drifting above the viewport's interior, but the exact bounds
// are expressed relative to `contentTopY` because the helper does not assume
// the content origin equals the viewport top.
//
// The scroll behavior guarantees:
//   - tiles never drift above the viewport top when the content is shorter
//     than the viewport (`contentHeight <= viewportHeight` -> offset = 0),
//   - tiles never expose blank space below the viewport bottom (offset is
//     clamped to maxScroll),
//   - the final scrollOffset matches the position implied by `contentY`.

import { clamp } from './layout'

export interface LogScrollInput {
  contentTopY: number
  viewportTopY: number
  viewportBottomY: number
  contentHeight: number
  // Optional extra padding subtracted from the bottom of the visible strip,
  // matching the existing renderer convention of a small bottom inset so
  // tiles don't sit flush against the panel border.
  bottomPadding?: number
  requestedOffset: number | null
  pinnedToBottom: boolean
}

export interface LogScrollResult {
  // Clamped scroll offset in [0, maxScroll].
  scrollOffset: number
  // World Y to assign to the content container so it scrolls correctly.
  contentY: number
  // Maximum scroll distance allowed; 0 when content fits in the viewport.
  maxScroll: number
  // True when the resulting offset is exactly at maxScroll. Callers use this
  // to keep their pin-to-bottom state in sync across rebuilds.
  pinnedToBottom: boolean
}

export function computeLogScrollLayout(input: LogScrollInput): LogScrollResult {
  const viewportHeight = Math.max(0, input.viewportBottomY - input.viewportTopY)
  const bottomPadding = input.bottomPadding ?? 0
  // Treat content as taking its own height plus an optional bottom padding
  // band, so the very last tile isn't flush against the viewport edge.
  const effectiveContent = Math.max(0, input.contentHeight + bottomPadding)
  const maxScroll = Math.max(0, effectiveContent - viewportHeight)

  let scrollOffset: number
  if (maxScroll <= 0) {
    // Content fits entirely: pin top so tiles never drift above the viewport.
    scrollOffset = 0
  } else if (input.requestedOffset === null || input.pinnedToBottom) {
    scrollOffset = maxScroll
  } else {
    scrollOffset = clamp(input.requestedOffset, 0, maxScroll)
  }

  const contentY = input.contentTopY - scrollOffset
  return {
    scrollOffset,
    contentY,
    maxScroll,
    pinnedToBottom: scrollOffset >= maxScroll,
  }
}
