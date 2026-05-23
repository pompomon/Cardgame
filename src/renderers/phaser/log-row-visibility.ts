// Pure visibility decision for a single log row inside the scrollable Replay
// Log viewport. Extracted from the Phaser renderer so it can be unit-tested
// without spinning up Phaser.
//
// Phaser 4's GeometryMask is a no-op under the WebGL backend, so the log
// content's mask cannot be relied on to clip rows that sit above the heading
// or below the panel border. The Phaser renderer instead toggles each row's
// `setVisible` based on this helper.
//
// `fullyContainedOnly` controls the strictness of the clip:
//   - false: a row is visible if any part of it overlaps the viewport. This is
//     used by views where partial rows at the top/bottom are acceptable.
//   - true:  a row is visible only when it is entirely inside the viewport.
//     The in-scene log uses this mode so a partially-visible top row never
//     paints over the "Replay Log" heading or the header strip above it, and
//     a partially-visible bottom row never bleeds into the player-info panel
//     directly below the log.

export interface LogRowVisibilityInput {
  rowTop: number
  rowHeight: number
  columnOriginY: number
  viewportTopY: number
  viewportBottomY: number
  fullyContainedOnly?: boolean
}

export function isLogRowVisible(input: LogRowVisibilityInput): boolean {
  const rowParentTop = input.columnOriginY + input.rowTop
  const rowParentBottom = rowParentTop + input.rowHeight
  if (input.fullyContainedOnly) {
    return rowParentTop >= input.viewportTopY && rowParentBottom <= input.viewportBottomY
  }
  return rowParentBottom > input.viewportTopY && rowParentTop < input.viewportBottomY
}
