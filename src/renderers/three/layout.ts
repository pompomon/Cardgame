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
  readonly labelHeight: number
  readonly height: number
}

export interface BoardColumns {
  readonly labelLeft: number
  readonly labelWidth: number
  readonly cardsLeft: number
  readonly cardsWidth: number
}

export interface ThreeLayout {
  readonly width: number
  readonly height: number
  readonly cardWidth: number
  readonly cardHeight: number
  readonly gap: number
  readonly compact: boolean
  readonly columns: BoardColumns
  readonly rows: Readonly<Record<BoardRow, RowLayout>>
  readonly drop: BoardRect
}

export function compactBoardViewport(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height)
    && width >= 760 && height > 0 && width > height && height <= 740
}

export function boardColumns(width: number, compact: boolean): BoardColumns {
  const w = Number.isFinite(width) && width > 0 ? width : 1
  const labelWidth = compact ? Math.min(240, w * 0.26) : Math.max(1, w - 24)
  const cardsLeft = compact ? labelWidth + 24 : 12
  return {
    labelLeft: 12, labelWidth, cardsLeft,
    cardsWidth: Math.max(1, compact ? w - cardsLeft - 12 : w - 24),
  }
}

function fitToBudget(sizes: readonly number[], minima: readonly number[], budget: number): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0)
  if (total <= budget) return [...sizes]
  const minimum = minima.reduce((sum, size) => sum + size, 0)
  if (minimum >= budget) return [...minima]
  const extra = total - minimum
  const available = budget - minimum
  return sizes.map((size, index) => minima[index] + (size - minima[index]) * available / extra)
}

export function boardLayout(
  width: number,
  height: number,
  headers: Readonly<Record<BoardRow, number>> = { far: 48, near: 96, hand: 28 },
  compact = false,
): ThreeLayout {
  const w = Number.isFinite(width) && width > 0 ? width : 1
  compact = compact && w >= 760
  const columns = boardColumns(w, compact)
  const rows = ['far', 'near', 'hand'] as const
  const safeHeight = (value: number, minimum: number): number =>
    Number.isFinite(value) ? Math.max(minimum, value) : minimum
  const h = safeHeight(height, 1)
  const minimumHeaders = [28, 52, 28]
  const headerHeights = rows.map((row, index) => safeHeight(headers[row], minimumHeaders[index]))
  if (compact) {
    const measuredRows = rows.map((_, index) => Math.max(headerHeights[index], 44))
    const minimumRows = rows.map((_, index) => Math.max(44, minimumHeaders[index]))
    const rowSizes = fitToBudget(measuredRows, minimumRows, h)
    const minimum = rowSizes.reduce((sum, size) => sum + size, 0)
    const spacing = Math.min(12, Math.max(0, (h - minimum) / (rows.length + 1)))
    const available = Math.max(rows.length, h - spacing * (rows.length + 1))
    const extra = Math.max(0, (available - minimum) / rows.length)
    const rowHeights = rowSizes.map((size) => size + extra)
    const cardHeight = Math.max(1, Math.min(180, ...rowHeights))
    const cardWidth = Math.min(cardHeight * 0.73, columns.cardsWidth)
    const gap = 12
    let top = spacing
    const row = (index: number): RowLayout => {
      const space = rowHeights[index]
      const center = top + space / 2
      top += space + spacing
      return {
        y: h / 2 - center, height: space,
        labelTop: center - Math.min(headerHeights[index], space) / 2,
        labelHeight: Math.min(headerHeights[index], space),
      }
    }
    const positions = { far: row(0), near: row(1), hand: row(2) }
    return {
      width: w, height: h, cardWidth, cardHeight, gap, compact, columns, rows: positions,
      drop: {
        x: columns.cardsLeft + columns.cardsWidth / 2 - w / 2, y: positions.near.y,
        width: columns.cardsWidth, height: positions.near.height,
      },
    }
  }
  const fittedChrome = fitToBudget(
    headerHeights,
    [0, minimumHeaders[1], 0],
    Math.max(0, h - rows.length),
  )
  const fittedHeaders = fittedChrome
  const chromeHeight = fittedChrome.reduce((sum, size) => sum + size, 0)
  const spacingSlots = rows.length * 2 + 1
  const spacing = Math.min(8, Math.max(0, (h - chromeHeight - rows.length * 32) / spacingSlots))
  const cardSpace = Math.max(1, (h - chromeHeight - spacing * spacingSlots) / rows.length)
  const cardHeight = Math.max(1, Math.min(204, cardSpace))
  const cardWidth = Math.max(1, Math.min(cardHeight * 0.73, w - 32))
  const gap = 12
  let top = spacing
  const row = (index: number): RowLayout => {
    const labelTop = top
    const cardsTop = labelTop + fittedHeaders[index] + spacing
    top = cardsTop + cardSpace + spacing
    return {
      y: h / 2 - cardsTop - cardSpace / 2,
      labelTop,
      labelHeight: fittedHeaders[index],
      height: cardSpace,
    }
  }
  const positions = { far: row(0), near: row(1), hand: row(2) }
  return {
    width: w,
    height: h,
    cardWidth,
    cardHeight,
    gap,
    compact,
    columns,
    rows: positions,
    drop: { x: 0, y: positions.near.y, width: Math.max(1, w - 24), height: cardSpace },
  }
}

export function cardSlotX(slot: number, visibleCount: number, layout: ThreeLayout): number {
  const count = Number.isFinite(visibleCount) ? Math.max(1, Math.floor(visibleCount)) : 1
  const index = Number.isFinite(slot) ? Math.min(count - 1, Math.max(0, Math.floor(slot))) : 0
  const minX = layout.columns.cardsLeft + layout.cardWidth / 2
  const maxX = layout.columns.cardsLeft + layout.columns.cardsWidth - layout.cardWidth / 2
  if (count === 1 || maxX <= minX) {
    return layout.columns.cardsLeft + layout.columns.cardsWidth / 2 - layout.width / 2
  }
  const step = Math.min(layout.cardWidth + layout.gap, (maxX - minX) / (count - 1))
  const usedWidth = step * (count - 1)
  const startX = minX + (maxX - minX - usedWidth) / 2
  return startX + index * step - layout.width / 2
}

/** Leave room for the lifted shadow within the caster's card lane, not its chrome. */
export function pendingCardRect(layout: ThreeLayout, owner: number, presentedActor: number): BoardRect {
  const row = layout.rows[owner === presentedActor ? 'near' : 'far']
  const ratio = layout.cardWidth / layout.cardHeight
  const shadow = 10
  const horizontalLimit = Math.max(1, layout.columns.cardsWidth - 32) / ratio
  const height = Math.max(1, Math.min(layout.cardHeight * 1.08, row.height - shadow, horizontalLimit))
  const lift = Math.min(shadow / 2, Math.max(0, (row.height - height) / 2))
  const width = height * ratio
  const offset = Math.max(0, Math.min(18, (layout.columns.cardsWidth - width) / 2 - 16))
  return { x: cardSlotX(0, 1, layout) + offset, y: row.y + lift, width, height }
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
