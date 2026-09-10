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
  readonly controlsTop: number
  readonly controlsHeight: number
  readonly height: number
}

export interface BoardColumns {
  readonly labelLeft: number
  readonly labelWidth: number
  readonly controlsLeft: number
  readonly controlsWidth: number
  readonly cardsLeft: number
  readonly cardsWidth: number
}

export interface ThreeLayout {
  readonly width: number
  readonly height: number
  readonly cardWidth: number
  readonly cardHeight: number
  readonly capacity: number
  readonly gap: number
  readonly compact: boolean
  readonly columns: BoardColumns
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

export function compactBoardViewport(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height)
    && width >= 760 && height > 0 && width > height && height <= 740
}

export function boardColumns(width: number, compact: boolean): BoardColumns {
  const w = Number.isFinite(width) && width > 0 ? width : 1
  const labelWidth = compact ? Math.min(240, w * 0.26) : Math.max(1, w - 24)
  const controlsWidth = compact ? Math.min(280, Math.max(220, w * 0.32)) : Math.max(1, w - 20)
  const controlsLeft = compact ? w - controlsWidth - 12 : 10
  const cardsLeft = compact ? labelWidth + 24 : 12
  return {
    labelLeft: 12, labelWidth, controlsLeft, controlsWidth, cardsLeft,
    cardsWidth: Math.max(1, compact ? controlsLeft - cardsLeft - 12 : w - 24),
  }
}

function fitToBudget(sizes: readonly number[], minima: readonly number[], budget: number): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0)
  if (total <= budget) return [...sizes]
  const minimum = minima.reduce((sum, size) => sum + size, 0)
  if (minimum >= budget) return minima.map((size) => size * budget / minimum)
  const extra = total - minimum
  const available = budget - minimum
  return sizes.map((size, index) => minima[index] + (size - minima[index]) * available / extra)
}

export function boardLayout(
  width: number,
  height: number,
  headers: Readonly<Record<BoardRow, number>> = { far: 48, near: 96, hand: 28 },
  controls: Readonly<Record<BoardRow, number>> = { far: 44, near: 44, hand: 44 },
  compact = false,
): ThreeLayout {
  const w = Number.isFinite(width) && width > 0 ? width : 1
  compact = compact && w >= 760
  const columns = boardColumns(w, compact)
  const rows = ['far', 'near', 'hand'] as const
  const safeHeight = (value: number, minimum: number): number =>
    Number.isFinite(value) ? Math.max(minimum, value) : minimum
  const h = safeHeight(height, 1)
  const headerHeights = rows.map((row) => safeHeight(headers[row], 28))
  const controlHeights = rows.map((row) => safeHeight(controls[row], 44))
  if (compact) {
    const measuredRows = rows.map((_, index) => Math.max(headerHeights[index], controlHeights[index]))
    const minimumRows = rows.map(() => 44)
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
        controlsTop: center - Math.min(controlHeights[index], space) / 2,
        controlsHeight: Math.min(controlHeights[index], space),
      }
    }
    const positions = { far: row(0), near: row(1), hand: row(2) }
    return {
      width: w, height: h, cardWidth, cardHeight, gap, compact, columns, rows: positions,
      capacity: Math.max(1, Math.min(16, Math.floor((columns.cardsWidth + gap) / (cardWidth + gap)))),
      drop: {
        x: columns.cardsLeft + columns.cardsWidth / 2 - w / 2, y: positions.near.y,
        width: columns.cardsWidth, height: positions.near.height,
      },
    }
  }
  const fittedChrome = fitToBudget(
    [...headerHeights, ...controlHeights],
    [...rows.map(() => 28), ...rows.map(() => 44)],
    Math.max(0, h - rows.length),
  )
  const fittedHeaders = fittedChrome.slice(0, rows.length)
  const fittedControls = fittedChrome.slice(rows.length)
  const chromeHeight = fittedChrome.reduce((sum, size) => sum + size, 0)
  const spacingSlots = rows.length * 3 + 1
  const spacing = Math.min(8, Math.max(0, (h - chromeHeight - rows.length * 32) / spacingSlots))
  const cardSpace = Math.max(1, (h - chromeHeight - spacing * spacingSlots) / rows.length)
  const cardHeight = Math.max(1, Math.min(204, cardSpace))
  const cardWidth = Math.max(1, Math.min(cardHeight * 0.73, w - 32))
  const gap = 12
  const capacity = Math.max(1, Math.min(16, Math.floor((w - 24 + gap) / (cardWidth + gap))))
  let top = spacing
  const row = (index: number): RowLayout => {
    const labelTop = top
    const cardsTop = labelTop + fittedHeaders[index] + spacing
    const controlsTop = cardsTop + cardSpace + spacing
    top = controlsTop + fittedControls[index] + spacing
    return {
      y: h / 2 - cardsTop - cardSpace / 2,
      labelTop,
      labelHeight: fittedHeaders[index],
      controlsTop,
      controlsHeight: fittedControls[index],
      height: cardSpace,
    }
  }
  const positions = { far: row(0), near: row(1), hand: row(2) }
  return {
    width: w,
    height: h,
    cardWidth,
    cardHeight,
    capacity,
    gap,
    compact,
    columns,
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
  return layout.columns.cardsLeft + layout.columns.cardsWidth / 2 - layout.width / 2
    + (slot - (visibleCount - 1) / 2) * (layout.cardWidth + layout.gap)
}

/** Leave room for the lifted shadow within the caster's card lane, not its chrome. */
export function pendingCardRect(layout: ThreeLayout, owner: number, presentedActor: number): BoardRect {
  const row = layout.rows[owner === presentedActor ? 'near' : 'far']
  const ratio = layout.cardWidth / layout.cardHeight
  const shadow = 10
  const horizontalLimit = Math.max(1, layout.columns.cardsWidth - 32) / ratio
  let lift: number
  let height: number
  if (layout.compact) {
    height = Math.max(1, Math.min(layout.cardHeight * 1.08, row.height - shadow, horizontalLimit))
    lift = Math.min(shadow / 2, Math.max(0, (row.height - height) / 2))
  } else {
    const cardTop = layout.height / 2 - row.y - layout.cardHeight / 2
    const gap = Math.max(0, row.controlsTop - cardTop - layout.cardHeight)
    height = Math.max(1, Math.min(layout.cardHeight * 1.08,
      layout.cardHeight + gap * 2 - shadow, horizontalLimit))
    const growth = (height - layout.cardHeight) / 2
    lift = Math.max(0, growth + shadow - gap)
  }
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
