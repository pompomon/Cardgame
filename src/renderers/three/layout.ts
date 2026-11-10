import { clamp } from '../shared/math'

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

export type BoardLayoutMode = 'stacked' | 'compact' | 'narrow'

export interface ThreeLayout {
  readonly width: number
  readonly height: number
  /** Battlefield card size; narrow hands are sized separately by narrowHandRects(). */
  readonly cardWidth: number
  readonly cardHeight: number
  readonly gap: number
  readonly compact: boolean
  readonly mode: BoardLayoutMode
  readonly columns: BoardColumns
  readonly rows: Readonly<Record<BoardRow, RowLayout>>
  readonly drop: BoardRect
}

/** The single-column phone profile; renderer.css uses the same breakpoint. */
export const NARROW_LAYOUT_QUERY = '(max-width: 480px)'
export const NARROW_LAYOUT_MAX_WIDTH = 480
/** Narrow battlefields reserve one stacked slot per creature type. */
export const NARROW_TYPE_SLOTS = 5
/** Large-text headers may grow the scrollable board up to this multiple of its stage height. */
export const NARROW_MAX_BOARD_GROWTH = 2
/** Header chrome fits within this share of the stage before the board grows. */
const NARROW_CHROME_SHARE = 0.3
const CARD_ASPECT = 0.73
const MAX_CARD_HEIGHT = 204
const NARROW_INSET = 8
const NARROW_SPACING = 4
const NARROW_GAP = 4
const NARROW_FRAME_ROOM = 6
const NARROW_MAX_SLOT_HEIGHT = 148
const NARROW_MAX_HAND_LINES = 3
const MIN_TOUCH_WIDTH = 44
const NARROW_BATTLEFIELD_SHARE = 0.3
/** Reserve enough lane height for 44px battlefield widths, even on short screens. */
export const NARROW_MIN_BOARD_HEIGHT = Math.ceil(
  ((MIN_TOUCH_WIDTH / CARD_ASPECT + NARROW_FRAME_ROOM) / NARROW_BATTLEFIELD_SHARE
    + NARROW_SPACING * 7) / (1 - NARROW_CHROME_SHARE),
)

export function isNarrowWidth(width: number): boolean {
  return Number.isFinite(width) && width > 0 && width <= NARROW_LAYOUT_MAX_WIDTH
}

export function compactBoardViewport(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height)
    && width >= 760 && height > 0 && width > height && height <= 740
}

/**
 * `narrow`, `dock`, and `rail` share the touch grammar (tap selects, the dock
 * or rail confirms). `desktop` keeps the stacked and compact layouts.
 */
export type ThreeShellProfile = 'narrow' | 'dock' | 'rail' | 'desktop'

export interface ThreeShellInput {
  /** Layout viewport (`innerWidth`, `innerHeight`), never `visualViewport`. */
  readonly width: number
  readonly height: number
  /** `matchMedia('(pointer: coarse)')`: the primary pointer is coarse. */
  readonly coarse: boolean
}

export interface ThreeShell {
  readonly profile: ThreeShellProfile
  /** Only a `rail` can be short: a landscape screen too low for stacked rows. */
  readonly short: boolean
}

/** Coarse pointers wider than this, unless the screen is short, keep `desktop`. */
export const TOUCH_SHELL_MAX_WIDTH = 1024
/** Landscape touch screens at or below this height use the short rail. */
export const SHORT_SHELL_MAX_HEIGHT = 480

const shell = (profile: ThreeShellProfile, short = false): ThreeShell => Object.freeze({ profile, short })
const DESKTOP_SHELL = shell('desktop')
const NARROW_SHELL = shell('narrow')
const DOCK_SHELL = shell('dock')
const RAIL_SHELL = shell('rail')
const SHORT_RAIL_SHELL = shell('rail', true)

/**
 * Classifies the layout viewport and primary pointer; the first matching rule
 * wins. The inputs never depend on the shell, so no hysteresis is needed.
 */
export function threeShellProfile({ width, height, coarse }: ThreeShellInput): ThreeShell {
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) return DESKTOP_SHELL
  if (isNarrowWidth(width)) return NARROW_SHELL
  if (coarse !== true) return DESKTOP_SHELL
  if (width > TOUCH_SHELL_MAX_WIDTH && height > SHORT_SHELL_MAX_HEIGHT) return DESKTOP_SHELL
  if (width > height) return height <= SHORT_SHELL_MAX_HEIGHT ? SHORT_RAIL_SHELL : RAIL_SHELL
  return DOCK_SHELL
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
      width: w, height: h, cardWidth, cardHeight, gap, compact, mode: 'compact', columns, rows: positions,
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
    mode: 'stacked',
    columns,
    rows: positions,
    drop: { x: 0, y: positions.near.y, width: Math.max(1, w - 24), height: cardSpace },
  }
}

export function narrowBoardColumns(width: number): BoardColumns {
  const w = Number.isFinite(width) && width > 0 ? width : 1
  const lane = Math.max(1, w - NARROW_INSET * 2)
  return { labelLeft: NARROW_INSET, labelWidth: lane, cardsLeft: NARROW_INSET, cardsWidth: lane }
}

/**
 * Full-width rows for portrait phones and cover screens. Each battlefield row
 * has fixed creature-type slots, so its height never depends on the number of
 * creatures; the hand receives the remaining height. Tall (large-text) headers
 * grow the scrollable board rather than shrinking below their measured height.
 */
export function narrowBoardLayout(
  width: number,
  height: number,
  headers: Readonly<Record<BoardRow, number>> = { far: 36, near: 36, hand: 22 },
): ThreeLayout {
  const w = Number.isFinite(width) && width > 0 ? width : 1
  const stage = Math.max(NARROW_MIN_BOARD_HEIGHT, Number.isFinite(height) && height > 0 ? height : 1)
  const columns = narrowBoardColumns(w)
  const measured = (['far', 'near', 'hand'] as const)
    .map((row) => Number.isFinite(headers[row]) ? Math.max(0, headers[row]) : 0)
  // Grow the board by any chrome beyond its share of the stage, so card lanes
  // keep their stage-sized space and headers keep their measured height.
  const measuredChrome = measured.reduce((sum, size) => sum + size, 0)
  const overflow = Math.max(0, measuredChrome - stage * NARROW_CHROME_SHARE)
  const h = overflow > 0 ? Math.min(stage * NARROW_MAX_BOARD_GROWTH, Math.ceil(stage + overflow)) : stage
  const [far, near, hand] = fitToBudget(measured, [0, 0, 0], h - stage * (1 - NARROW_CHROME_SHARE))
  const chrome = far + near + hand
  const spacing = Math.min(NARROW_SPACING, Math.max(0, (h - chrome) / 60))
  const lanes = Math.max(3, h - chrome - spacing * 7)
  const slotWidth = Math.max(1, (columns.cardsWidth - (NARROW_TYPE_SLOTS - 1) * NARROW_GAP) / NARROW_TYPE_SLOTS)
  // The two battlefields together never take more than 60% of the card space.
  const cardHeight = Math.max(1, Math.min(
    NARROW_MAX_SLOT_HEIGHT, slotWidth / CARD_ASPECT, lanes * NARROW_BATTLEFIELD_SHARE - NARROW_FRAME_ROOM,
  ))
  const cardWidth = Math.max(1, Math.min(slotWidth, cardHeight * CARD_ASPECT))
  const boardLane = cardHeight + NARROW_FRAME_ROOM
  const handLane = Math.max(1, lanes - boardLane * 2)
  let top = spacing
  const row = (labelHeight: number, laneHeight: number): RowLayout => {
    const labelTop = top
    const laneTop = labelTop + labelHeight + spacing
    top = laneTop + laneHeight + spacing
    return { y: h / 2 - laneTop - laneHeight / 2, labelTop, labelHeight, height: laneHeight }
  }
  const rows = { far: row(far, boardLane), near: row(near, boardLane), hand: row(hand, handLane) }
  // Dropping anywhere on the near player's header or lane summons the card.
  const dropTop = rows.near.labelTop
  const dropBottom = h / 2 - rows.near.y + rows.near.height / 2
  return {
    width: w, height: h, cardWidth, cardHeight, gap: NARROW_GAP, compact: false, mode: 'narrow', columns, rows,
    drop: {
      x: columns.cardsLeft + columns.cardsWidth / 2 - w / 2,
      y: h / 2 - (dropTop + dropBottom) / 2,
      width: columns.cardsWidth,
      height: Math.max(1, dropBottom - dropTop),
    },
  }
}

/** Centre x of a fixed creature-type slot in a narrow battlefield row. */
export function typeSlotX(slot: number, layout: ThreeLayout): number {
  const index = Number.isFinite(slot) ? Math.min(NARROW_TYPE_SLOTS - 1, Math.max(0, Math.floor(slot))) : 0
  const used = NARROW_TYPE_SLOTS * layout.cardWidth + (NARROW_TYPE_SLOTS - 1) * layout.gap
  const left = layout.columns.cardsLeft + Math.max(0, (layout.columns.cardsWidth - used) / 2)
  return left + layout.cardWidth / 2 + index * (layout.cardWidth + layout.gap) - layout.width / 2
}

/** Number of cards that fit on one page without shrinking touch targets. */
export function narrowHandPageSize(layout: ThreeLayout): number {
  const columns = Math.max(1, Math.floor((layout.columns.cardsWidth + layout.gap) / (MIN_TOUCH_WIDTH + layout.gap)))
  const lines = Math.max(1, Math.min(NARROW_MAX_HAND_LINES, Math.floor(
    (layout.rows.hand.height - NARROW_FRAME_ROOM + layout.gap) / (MIN_TOUCH_WIDTH / CARD_ASPECT + layout.gap),
  )))
  return columns * lines
}

/**
 * Lays one narrow hand page out in up to three centred lines, choosing the line count
 * that gives the largest cards. Cards never overlap: overlapping would enlarge
 * the art but shrink each card's exposed, tappable width.
 */
export function narrowHandRects(count: number, layout: ThreeLayout): BoardRect[] {
  const total = Number.isFinite(count) ? Math.min(narrowHandPageSize(layout), Math.max(0, Math.floor(count))) : 0
  if (!total) return []
  const lane = layout.columns.cardsWidth
  const row = layout.rows.hand
  const laneHeight = Math.max(1, row.height - NARROW_FRAME_ROOM)
  const gap = layout.gap
  let lines = 1
  let perLine = total
  let height = 0
  for (let candidate = 1; candidate <= Math.min(NARROW_MAX_HAND_LINES, total); candidate++) {
    const candidatePerLine = Math.ceil(total / candidate)
    if (Math.ceil(total / candidatePerLine) !== candidate) continue
    const byWidth = (lane - (candidatePerLine - 1) * gap) / candidatePerLine / CARD_ASPECT
    const byHeight = (laneHeight - (candidate - 1) * gap) / candidate
    const candidateHeight = Math.min(MAX_CARD_HEIGHT, byWidth, byHeight)
    if (candidateHeight * CARD_ASPECT < MIN_TOUCH_WIDTH && total > 1) continue
    if (candidateHeight > height + 0.5) {
      lines = candidate
      perLine = candidatePerLine
      height = candidateHeight
    }
  }
  height = Math.max(1, height)
  const width = height * CARD_ASPECT
  const step = width + gap
  const block = lines * height + (lines - 1) * gap
  const laneTop = layout.height / 2 - row.y - row.height / 2
  const top = laneTop + Math.max(0, (row.height - block) / 2)
  const rects: BoardRect[] = []
  for (let index = 0; index < total; index++) {
    const line = Math.floor(index / perLine)
    const column = index % perLine
    const inLine = line === lines - 1 ? total - perLine * (lines - 1) : perLine
    const lineWidth = width + step * (inLine - 1)
    const left = layout.columns.cardsLeft + (lane - lineWidth) / 2
    rects.push({
      x: left + width / 2 + column * step - layout.width / 2,
      y: layout.height / 2 - (top + line * (height + gap) + height / 2),
      width,
      height,
    })
  }
  return rects
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

/** Touch and pen drops reach this many CSS pixels past the drop zone's top and sides. */
export const TOUCH_DROP_SLOP_PX = 12

/** Board y of the top of the presented hand, including its header. */
export function handTop(layout: ThreeLayout): number {
  const row = layout.rows.hand
  return Math.max(layout.height / 2 - row.labelTop, row.y + row.height / 2)
}

/**
 * The one drop predicate behind both the drag highlight and the release.
 * `slop` (board units) widens only the top and side edges: the edge facing the
 * hand never grows, and no point over the hand is ever accepted.
 */
export function dropAccepts(point: Point, layout: ThreeLayout, slop = 0): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false
  const margin = Number.isFinite(slop) ? Math.max(0, slop) : 0
  const { drop } = layout
  return point.y >= drop.y - drop.height / 2
    && point.y <= drop.y + drop.height / 2 + margin
    && point.y > handTop(layout)
    && Math.abs(point.x - drop.x) <= drop.width / 2 + margin
}

/** `center` follows a mouse; touch cards sit above the finger or beside it. */
export type DragProxySide = 'center' | 'above' | 'left' | 'right'

/** A rectangle in drag-layer pixels: top-left origin, y grows downward. */
export interface LayerRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface DragProxyInput {
  /** Pointer position in layer pixels. */
  readonly pointer: Point
  /** Unscaled card size in layer pixels. */
  readonly card: { readonly width: number; readonly height: number }
  /** The visible part of the stage in layer pixels. */
  readonly stage: LayerRect
  readonly touch: boolean
  /** The previous placement's side, so the card does not flip while it still fits. */
  readonly side?: DragProxySide
}

export interface DragProxyPlacement {
  /** Card centre in layer pixels. */
  readonly x: number
  readonly y: number
  /** Scaled card size in layer pixels. */
  readonly width: number
  readonly height: number
  readonly scale: number
  readonly side: DragProxySide
}

export const MOUSE_DRAG_SCALE = 1.08
export const TOUCH_DRAG_SCALE = 0.9
const TOUCH_LIFT_MIN = 44
const TOUCH_LIFT_MAX = 120
/** Space kept between the finger and the lifted card's nearest edge. */
const TOUCH_LIFT_CLEARANCE = 20
const DRAG_STAGE_MARGIN = 4
/** Extra room needed above before a sideways card returns above the finger. */
const DRAG_SIDE_HYSTERESIS = 12

/** Centres `size` within [min, max], or between them when it cannot fit. */
function fitCenter(center: number, size: number, min: number, max: number): number {
  if (max - min <= size) return (min + max) / 2
  return clamp(center, min + size / 2, max - size / 2)
}

/**
 * Where the dragged card is drawn. A mouse keeps the card centred on the
 * pointer, as before. Touch and pen lift a smaller card above the finger so it
 * stays visible; without room above, the card moves beside the finger and
 * keeps that side while it fits. Touch placements stay inside the visible stage.
 */
export function dragProxyPlacement({ pointer, card, stage, touch, side }: DragProxyInput): DragProxyPlacement {
  const scale = touch ? TOUCH_DRAG_SCALE : MOUSE_DRAG_SCALE
  const width = Math.max(1, (Number.isFinite(card.width) ? card.width : 1) * scale)
  const height = Math.max(1, (Number.isFinite(card.height) ? card.height : 1) * scale)
  const px = Number.isFinite(pointer.x) ? pointer.x : stage.left + stage.width / 2
  const py = Number.isFinite(pointer.y) ? pointer.y : stage.top + stage.height / 2
  if (!touch) return { x: px, y: py, width, height, scale, side: 'center' }
  const left = stage.left + DRAG_STAGE_MARGIN
  const right = stage.left + stage.width - DRAG_STAGE_MARGIN
  const top = stage.top + DRAG_STAGE_MARGIN
  const bottom = stage.top + stage.height - DRAG_STAGE_MARGIN
  const lift = clamp(height / 2 + TOUCH_LIFT_CLEARANCE, TOUCH_LIFT_MIN, TOUCH_LIFT_MAX)
  const sideways = side === 'left' || side === 'right'
  let next: DragProxySide = 'above'
  let x = px
  let y = py - lift
  if (y - height / 2 < top + (sideways ? DRAG_SIDE_HYSTERESIS : 0)) {
    const offset = width / 2 + TOUCH_LIFT_CLEARANCE
    const fitsLeft = px - offset - width / 2 >= left
    const fitsRight = px + offset + width / 2 <= right
    if ((side === 'left' && fitsLeft) || (side === 'right' && fitsRight)) next = side
    else if (fitsLeft !== fitsRight) next = fitsLeft ? 'left' : 'right'
    // The roomier side; ties go left, away from a right thumb.
    else next = px - left >= right - px ? 'left' : 'right'
    x = px + (next === 'left' ? -offset : offset)
    y = py
  }
  return {
    x: fitCenter(x, width, left, right), y: fitCenter(y, height, top, bottom),
    width, height, scale, side: next,
  }
}

export interface LandingSlotInput {
  /** The dragged card's creature-type slot; only the narrow layout uses it. */
  readonly typeSlot: number
  /** Cards already in that narrow type slot. */
  readonly slotCount: number
  /** Cards already on the near battlefield; other layouts append after them. */
  readonly nearCount: number
}

export interface LandingSlotRect extends BoardRect {
  /** Narrow only: the card joins an existing stack ("+1") instead of an empty slot. */
  readonly occupied: boolean
}

/** Where a summoned card lands on the near battlefield, in board units. */
export function landingSlotRect(layout: ThreeLayout, { typeSlot, slotCount, nearCount }: LandingSlotInput): LandingSlotRect {
  const narrow = layout.mode === 'narrow'
  const count = Number.isFinite(nearCount) ? Math.max(0, Math.floor(nearCount)) : 0
  return {
    x: narrow ? typeSlotX(typeSlot, layout) : cardSlotX(count, count + 1, layout),
    y: layout.rows.near.y,
    width: layout.cardWidth,
    height: layout.cardHeight,
    occupied: narrow && Number.isFinite(slotCount) && slotCount > 0,
  }
}
