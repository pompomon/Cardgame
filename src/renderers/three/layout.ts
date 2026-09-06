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

export function boardLayout(
  width: number,
  height: number,
  headers: Readonly<Record<BoardRow, number>> = { far: 48, near: 96, hand: 28 },
  controls: Readonly<Record<BoardRow, number>> = { far: 44, near: 44, hand: 44 },
): ThreeLayout {
  const w = Number.isFinite(width) && width > 0 ? width : 1
  const rows = ['far', 'near', 'hand'] as const
  const safeHeight = (value: number, minimum: number): number =>
    Number.isFinite(value) ? Math.max(minimum, value) : minimum
  const overhead = rows.reduce((sum, row) => sum + safeHeight(headers[row], 28) + safeHeight(controls[row], 44) + 30, 0)
  // Grow the table on short screens instead of squeezing cards under its HTML controls.
  const h = Math.max(safeHeight(height, 1), overhead + 3 * 104)
  const cardSpace = (h - overhead) / 3
  const cardHeight = Math.min(204, cardSpace)
  const cardWidth = Math.max(1, Math.min(cardHeight * 0.73, w - 32))
  const gap = 12
  const capacity = Math.max(1, Math.min(16, Math.floor((w - 24 + gap) / (cardWidth + gap))))
  let top = 0
  const row = (name: BoardRow): RowLayout => {
    const labelTop = top + 6
    const cardsTop = labelTop + safeHeight(headers[name], 28) + 8
    const controlsTop = cardsTop + cardSpace + 8
    top = controlsTop + safeHeight(controls[name], 44) + 8
    return { y: h / 2 - cardsTop - cardSpace / 2, labelTop, controlsTop }
  }
  const positions = { far: row('far'), near: row('near'), hand: row('hand') }
  return {
    width: w,
    height: h,
    cardWidth,
    cardHeight,
    capacity,
    gap,
    rows: positions,
    drop: { x: 0, y: positions.near.y, width: Math.max(1, w - 24), height: cardSpace },
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
