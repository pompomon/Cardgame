// Pure visibility and culling helpers for rows inside scrollable Phaser
// viewports. Extracted from the Phaser renderer so the behavior can be
// unit-tested without spinning up Phaser.
//
// Phaser 4's GeometryMask is a no-op under the WebGL backend, so the log
// content's mask cannot be relied on to clip rows that sit above the heading
// or below the panel border. The Phaser renderer instead toggles each row's
// `setVisible` based on this helper.
//
// `mode` controls the strictness of the clip:
//   - 'overlap': a row is visible if any part of it overlaps the viewport.
//   - 'contained': a row is visible only when it is entirely inside the
//     viewport. The replay log uses this mode so a partially-visible top row
//     never paints over the "Replay Log" heading or the header strip above it,
//     and a partially-visible bottom row never bleeds into adjacent panels.

export type ViewportRowCullMode = 'overlap' | 'contained'

export interface LogRowVisibilityInput {
  rowTop: number
  rowHeight: number
  columnOriginY: number
  viewportTopY: number
  viewportBottomY: number
  mode?: ViewportRowCullMode
}

export function isLogRowVisible(input: LogRowVisibilityInput): boolean {
  const rowParentTop = input.columnOriginY + input.rowTop
  const rowParentBottom = rowParentTop + input.rowHeight
  if (input.mode === 'contained') {
    return rowParentTop >= input.viewportTopY && rowParentBottom <= input.viewportBottomY
  }
  return rowParentBottom > input.viewportTopY && rowParentTop < input.viewportBottomY
}

export interface CullableViewportRows {
  list: readonly unknown[]
}

export interface CullRowsToViewportInput {
  rowsContainer: CullableViewportRows
  columnOriginY: number
  viewportTopY: number
  viewportBottomY: number
  mode?: ViewportRowCullMode
}

export function cullRowsToViewport(input: CullRowsToViewportInput): void {
  for (const child of input.rowsContainer.list) {
    const row = child as {
      getData?: (key: string) => unknown
      setVisible?: (visible: boolean) => unknown
      y?: number
      height?: number
    }
    if (typeof row.setVisible !== 'function') {
      continue
    }
    const rowTop = typeof row.getData === 'function'
      ? (row.getData('rowTop') as number | undefined) ?? (row.y ?? 0)
      : (row.y ?? 0)
    const rowHeight = typeof row.getData === 'function'
      ? (row.getData('rowHeight') as number | undefined) ?? (row.height ?? 0)
      : (row.height ?? 0)
    row.setVisible(isLogRowVisible({
      rowTop,
      rowHeight,
      columnOriginY: input.columnOriginY,
      viewportTopY: input.viewportTopY,
      viewportBottomY: input.viewportBottomY,
      mode: input.mode,
    }))
  }
}
