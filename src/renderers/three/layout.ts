export type BoardRow = 'far' | 'near' | 'hand'

export interface Point {
  x: number
  y: number
}

export interface BoardRect extends Point {
  width: number
  height: number
}

export interface RowLayout {
  readonly y: number
  readonly labelTop: number
  readonly controlsTop: number
}

export interface ThreeLayout {
  readonly width: number
  readonly height: number
  readonly cardWidth: number
  readonly cardHeight: number
  readonly capacity: number
  readonly gap: number
  readonly rows: Readonly<Record<BoardRow, RowLayout>>
  readonly drop: BoardRect
}

export interface PageWindow {
  readonly page: number
  readonly pages: number
  readonly start: number
  readonly end: number
  readonly count: number
}

export function boardLayout(width: number, height: number): ThreeLayout {
  const w = Number.isFinite(width) && width > 0 ? width : 1
  const h = Number.isFinite(height) && height > 0 ? height : 1
  const rowHeight = h / 3
  const cardHeight = Math.max(1, Math.min(204, rowHeight - 112))
  const cardWidth = Math.max(1, Math.min(cardHeight * 0.73, w - 32))
  const gap = 12
  const capacity = Math.max(1, Math.min(16, Math.floor((w - 24 + gap) / (cardWidth + gap))))
  const row = (index: number): RowLayout => ({
    y: h / 2 - (index + 0.5) * rowHeight,
    labelTop: index * rowHeight + 5,
    controlsTop: (index + 1) * rowHeight - 46,
  })
  return {
    width: w,
    height: h,
    cardWidth,
    cardHeight,
    capacity,
    gap,
    rows: { far: row(0), near: row(1), hand: row(2) },
    drop: { x: 0, y: 0, width: Math.max(1, w - 24), height: Math.max(1, rowHeight - 54) },
  }
}

export function pageWindow(count: number, requested: number, capacity: number): PageWindow {
  const total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  const size = Number.isFinite(capacity) ? Math.max(1, Math.floor(capacity)) : 1
  const pages = Math.max(1, Math.ceil(total / size))
  const page = Math.min(pages - 1, Math.max(0, Number.isFinite(requested) ? Math.floor(requested) : 0))
  const start = page * size
  return { page, pages, start, end: Math.min(total, start + size), count: total }
}

export function cardSlotX(slot: number, visibleCount: number, layout: ThreeLayout): number {
  return (slot - (visibleCount - 1) / 2) * (layout.cardWidth + layout.gap)
}

/** The camera uses CSS pixels, never the canvas's DPR-scaled backing store. */
export function clientToBoard(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  layout: Pick<ThreeLayout, 'width' | 'height'>,
  out: Point,
): boolean {
  if (rect.width <= 0 || rect.height <= 0 || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return false
  }
  out.x = (clientX - rect.left) / rect.width * layout.width - layout.width / 2
  out.y = layout.height / 2 - (clientY - rect.top) / rect.height * layout.height
  return clientX >= rect.left && clientX <= rect.left + rect.width
    && clientY >= rect.top && clientY <= rect.top + rect.height
}

export function pointInRect(point: Point, rect: BoardRect): boolean {
  return Math.abs(point.x - rect.x) <= rect.width / 2
    && Math.abs(point.y - rect.y) <= rect.height / 2
}
