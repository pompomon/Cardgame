import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AUTO_SCROLL_EDGE_PX, AUTO_SCROLL_MAX_SPEED, autoScrollVelocity,
  boardLayout, cardSlotX, clientToBoard, compactBoardViewport, dragProxyPlacement, dropAccepts, handTop, isNarrowWidth,
  landingSlotRect, MOUSE_DRAG_SCALE, NARROW_LAYOUT_MAX_WIDTH, PEEK_MIN_HEIGHT, peekPlacement,
  NARROW_LAYOUT_QUERY, NARROW_MAX_BOARD_GROWTH, NARROW_MIN_BOARD_HEIGHT, NARROW_TYPE_SLOTS, narrowBoardLayout, narrowHandPageSize, narrowHandRects, pendingCardRect, pointInRect,
  SHORT_SHELL_MAX_HEIGHT, threeShellProfile, TOUCH_DRAG_SCALE, TOUCH_DROP_SLOP_PX, TOUCH_SHELL_MAX_WIDTH, typeSlotX,
  type BoardRect, type DragProxyInput, type DragProxySide, type LayerRect, type PeekPlacement, type PeekSide, type ThreeLayout, type ThreeShell,
  type TouchLayoutMode,
} from '../renderers/three/layout'
import { DEFAULT_OPENING_HAND_SIZE } from '../game/engine'
import { DESKTOP_SHELL, DOCK_SHELL, FOLD4_POSTURES, NARROW_SHELL, RAIL_SHELL, SHORT_RAIL_SHELL } from './helpers/fold4-postures'

function laneBounds(layout: ThreeLayout, row: 'far' | 'near' | 'hand') {
  const lane = layout.rows[row]
  return {
    left: layout.columns.cardsLeft - layout.width / 2,
    right: layout.columns.cardsLeft + layout.columns.cardsWidth - layout.width / 2,
    top: lane.y + lane.height / 2,
    bottom: lane.y - lane.height / 2,
  }
}

function overlaps(a: BoardRect, b: BoardRect): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 - 0.001 && Math.abs(a.y - b.y) < (a.height + b.height) / 2 - 0.001
}

describe('Three.js fixed tabletop layout', () => {
  it.each([[320, 690], [390, 844], [844, 690], [1440, 960]])('keeps cards within %sx%s', (width, height) => {
    const layout = boardLayout(width, height)
    expect(layout.cardHeight).toBeGreaterThan(100)
    const last = cardSlotX(11, 12, layout)
    expect(last + layout.cardWidth / 2).toBeLessThanOrEqual(width / 2)
    expect(layout.rows.far.y).toBeGreaterThan(layout.rows.near.y)
    expect(layout.rows.near.y).toBeGreaterThan(layout.rows.hand.y)
    expect(pointInRect({ x: 0, y: layout.rows.near.y }, layout.drop)).toBe(true)
    expect(pointInRect({ x: 0, y: layout.rows.hand.y }, layout.drop)).toBe(false)
  })

  it.each([[320, 690], [390, 844], [844, 390], [1440, 960]])(
    'keeps every card in an overflowing row visible within %sx%s',
    (width, height) => {
      const layout = boardLayout(width, height, undefined, compactBoardViewport(width, height))
      const count = 50
      const positions = Array.from({ length: count }, (_, index) => cardSlotX(index, count, layout))
      const left = layout.width / 2 + positions[0] - layout.cardWidth / 2
      const right = layout.width / 2 + positions.at(-1)! + layout.cardWidth / 2
      expect(left).toBeGreaterThanOrEqual(layout.columns.cardsLeft - 0.001)
      expect(right).toBeLessThanOrEqual(layout.columns.cardsLeft + layout.columns.cardsWidth + 0.001)
      expect(positions.every((position, index) => index === 0 || position > positions[index - 1])).toBe(true)
      expect(positions[1] - positions[0]).toBeLessThan(layout.cardWidth + layout.gap)
    },
  )

  it('centers one card and preserves normal spacing while a row fits', () => {
    const layout = boardLayout(390, 844)
    expect(cardSlotX(0, 1, layout)).toBe(
      layout.columns.cardsLeft + layout.columns.cardsWidth / 2 - layout.width / 2,
    )
    const count = 2
    expect(cardSlotX(1, count, layout) - cardSlotX(0, count, layout)).toBeCloseTo(layout.cardWidth + layout.gap)
  })

  it.each([[320, 456], [390, 700], [844, 390], [1440, 670]])('fits measured chrome within the %sx%s stage', (width, height) => {
    const headers = { far: 52, near: width < 480 ? 112 : 104, hand: 28 }
    const layout = boardLayout(width, height, headers, compactBoardViewport(width, height))
    expect(layout.height).toBe(height)
    expect(layout.cardHeight).toBeGreaterThan(0)
    for (const row of ['far', 'near', 'hand'] as const) {
      const pos = layout.rows[row]
      const top = layout.height / 2 - pos.y - layout.cardHeight / 2
      expect(pos.labelTop).toBeGreaterThanOrEqual(0)
      expect(pos.labelTop + headers[row]).toBeLessThanOrEqual(layout.height)
      if (!layout.compact) {
        expect(top).toBeGreaterThanOrEqual(pos.labelTop + headers[row])
        expect(top + layout.cardHeight).toBeLessThanOrEqual(layout.height)
      }
    }
    const dropTop = layout.height / 2 - layout.drop.y - layout.drop.height / 2
    expect(dropTop).toBeGreaterThanOrEqual(0)
    expect(dropTop + layout.drop.height).toBeLessThanOrEqual(layout.height)
  })

  it('shrinks cards before overlapping wrapped chrome in a constrained portrait stage', () => {
    const headers = { far: 60, near: 130, hand: 40 }
    const layout = boardLayout(320, 420, headers)
    expect(layout.height).toBe(420)
    expect(layout.cardHeight).toBeLessThan(104)
    for (const row of ['far', 'near', 'hand'] as const) {
      const placement = layout.rows[row]
      const cardTop = layout.height / 2 - placement.y - layout.cardHeight / 2
      expect(cardTop + 0.001).toBeGreaterThanOrEqual(placement.labelTop + headers[row])
      expect(cardTop + layout.cardHeight).toBeLessThanOrEqual(layout.height)
    }
    expect(pointInRect({ x: 0, y: layout.rows.near.y }, layout.drop)).toBe(true)
    expect(pointInRect({ x: 0, y: layout.rows.hand.y }, layout.drop)).toBe(false)
  })

  it.each([[320, false], [844, true]])('compacts oversized headers within a 300px stage at width %s', (width, compact) => {
    const headers = { far: 100, near: 180, hand: 100 }
    const layout = boardLayout(width, 300, headers, compact)
    expect(Object.values(headers).reduce((sum, size) => sum + size, 0)).toBeGreaterThan(layout.height)
    for (const row of ['far', 'near', 'hand'] as const) {
      const placement = layout.rows[row]
      expect(placement.labelTop).toBeGreaterThanOrEqual(0)
      expect(placement.labelTop + placement.labelHeight).toBeLessThanOrEqual(layout.height)
    }
    expect(layout.rows.near.labelHeight).toBeGreaterThanOrEqual(52)
  })

  it.each([[320, 150, false], [844, 150, true]])(
    'preserves the primary-action header below the full chrome minimum at %sx%s',
    (width, height, compact) => {
      const layout = boardLayout(
        width,
        height,
        { far: 60, near: 130, hand: 40 },
        compact,
      )
      expect(layout.rows.near.labelHeight).toBeGreaterThanOrEqual(52)
    },
  )

  it('handles invalid dimensions and slot input safely', () => {
    expect(boardLayout(NaN, 0).width).toBe(1)
    const layout = boardLayout(320, 690)
    expect(cardSlotX(NaN, Infinity, layout)).toBe(cardSlotX(0, 1, layout))
  })

  it.each([[844, 390], [1024, 600], [1440, 700]])('uses separate readable landscape lanes at %sx%s', (width, height) => {
    expect(compactBoardViewport(width, height)).toBe(true)
    const headers = { far: 90, near: 160, hand: 28 }
    const layout = boardLayout(width, height, headers, true)
    expect(layout.compact).toBe(true)
    expect(layout.height).toBe(height)
    expect(layout.cardHeight).toBeGreaterThan(0)
    const first = layout.width / 2 + cardSlotX(0, 12, layout) - layout.cardWidth / 2
    const last = layout.width / 2 + cardSlotX(11, 12, layout) + layout.cardWidth / 2
    expect(first).toBeGreaterThan(layout.columns.labelLeft + layout.columns.labelWidth)
    expect(last).toBeLessThanOrEqual(layout.columns.cardsLeft + layout.columns.cardsWidth + 0.001)
    for (const row of ['far', 'near', 'hand'] as const) {
      const placement = layout.rows[row]
      expect(placement.labelTop).toBeGreaterThanOrEqual(0)
      expect(placement.labelTop + headers[row]).toBeLessThanOrEqual(layout.height)
    }
    expect(pointInRect({ x: cardSlotX(0, 1, layout), y: layout.rows.near.y }, layout.drop)).toBe(true)
    expect(pointInRect({ x: cardSlotX(0, 1, layout), y: layout.rows.hand.y }, layout.drop)).toBe(false)
  })

  it('uses the exact constrained landscape height and never classifies a tall board as the viewport', () => {
    expect(compactBoardViewport(844, 390)).toBe(true)
    expect(compactBoardViewport(844, 1100)).toBe(false)
    expect(compactBoardViewport(390, 844)).toBe(false)
    expect(compactBoardViewport(Infinity, 300)).toBe(false)
    const headers = { far: 90, near: 160, hand: 40 }
    const layout = boardLayout(844, 300, headers, true)
    expect(layout.height).toBe(300)
    expect(layout.rows.far.y).toBeGreaterThan(layout.rows.near.y)
    expect(layout.rows.near.y).toBeGreaterThan(layout.rows.hand.y)
  })

  it('converts using the displayed rectangle, independent of DPR or CSS scaling', () => {
    const point = { x: 0, y: 0 }
    const layout = boardLayout(1000, 750)
    const rect = { left: 70, top: 110, width: 500, height: 375 }
    expect(clientToBoard(320, 297.5, rect, layout, point)).toBe(true)
    expect(point).toEqual({ x: 0, y: 0 })
    expect(clientToBoard(570, 110, rect, layout, point)).toBe(true)
    expect(point).toEqual({ x: 500, y: 375 })
    expect(clientToBoard(10, 10, rect, layout, point)).toBe(false)
    expect(clientToBoard(320, 297, { ...rect, width: 0 }, layout, point)).toBe(false)
  })

  it.each([[320, 690], [390, 844], [844, 390], [1024, 600], [1440, 960]])('bounds pending cards and shadows outside chrome at %sx%s', (width, height) => {
    const headers = { far: 90, near: 160, hand: 28 }
    const layout = boardLayout(width, height, headers, compactBoardViewport(width, height))
    for (const actor of [0, 1]) {
      for (const owner of [0, 1]) {
        const rect = pendingCardRect(layout, owner, actor)
        const row = owner === actor ? 'near' : 'far'
        const top = layout.height / 2 - rect.y - rect.height / 2
        const left = layout.width / 2 + rect.x - rect.width / 2
        expect(rect.width / rect.height).toBeCloseTo(layout.cardWidth / layout.cardHeight)
        if (layout.compact) {
          expect(rect.height + 10).toBeLessThanOrEqual(layout.rows[row].height)
        }
        expect(rect.y).toBeGreaterThanOrEqual(layout.rows[row].y)
        expect(left).toBeGreaterThanOrEqual(layout.columns.cardsLeft)
        expect(left + rect.width + 8).toBeLessThanOrEqual(layout.columns.cardsLeft + layout.columns.cardsWidth)
        expect(top).toBeGreaterThanOrEqual(0)
        expect(top + rect.height + 10).toBeLessThanOrEqual(layout.height)
        if (!layout.compact) {
          expect(top).toBeGreaterThanOrEqual(layout.rows[row].labelTop + headers[row])
          expect(top + rect.height + 10).toBeLessThanOrEqual(
            layout.height / 2 - layout.rows[row].y + layout.rows[row].height / 2 + 0.001,
          )
        }
      }
    }
  })
})

const css = (file: string) => readFileSync(join(__dirname, '..', 'renderers', 'three', file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')

interface SafeArea { top: number; right: number; bottom: number; left: number }
const NO_INSETS: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 }

/**
 * The board's stage size inside renderer.css's narrow shell: a 3.5rem top bar
 * and rem-sized dock, 4px gaps, safe-area-aware 4px padding, and the 1px
 * borders of `.three-stage` and `.three-board-stage`.
 */
function narrowStage(viewportWidth: number, viewportHeight: number, textScale = 1, insets: SafeArea = NO_INSETS) {
  const rem = 16 * textScale
  const pad = (inset: number) => Math.max(4, inset)
  const topBar = 3.5 * rem
  const dock = 3 * 1.25 * 0.8125 * rem + 62
  const borders = 4
  return {
    width: viewportWidth - pad(insets.left) - pad(insets.right) - borders,
    height: viewportHeight - pad(insets.top) - pad(insets.bottom) - 2 * 4 - topBar - dock - borders,
  }
}

describe('Three.js narrow single-column layout', () => {
  // Fold4 cover screen as an installed PWA and in a browser tab, plus common phones.
  const screens = [[320, 690], [344, 655], [344, 770], [344, 834], [344, 882], [360, 780], [390, 844], [430, 932]]
  const fold4Pwa: SafeArea = { top: 28, right: 0, bottom: 16, left: 0 }
  // Viewport, browser text size, and safe-area insets → the board's stage.
  const viewports = [
    ...screens.flatMap(([width, height]) => [1, 2].map((scale) => [width, height, scale, NO_INSETS] as const)),
    [344, 882, 1, fold4Pwa] as const,
    [344, 882, 2, fold4Pwa] as const,
  ].map(([width, height, scale, insets]) => {
    const stage = narrowStage(width, height, scale, insets)
    const headers = { far: 36 * scale, near: 36 * scale, hand: 50 * scale }
    return [`${width}x${height} at ${scale * 100}% text${insets === NO_INSETS ? '' : ' with safe areas'}`, stage, headers] as const
  })
  // The Fold4 cover screen in a browser tab.
  const cover = narrowStage(344, 770)

  it('derives stage sizes from the narrow shell in renderer.css', () => {
    const shell = css('renderer.css')
    const root = shell.match(/\.three-root--game\.three-root--narrow \{([^}]*)\}/)?.[1] ?? ''
    expect(root).toContain('--three-topbar-height: 3.5rem;')
    expect(root).toContain('--three-dock-prompt-height: calc(3 * 1.25 * 0.8125rem);')
    expect(root).toContain('--three-dock-height: calc(var(--three-dock-prompt-height) + 62px);')
    expect(root).toContain('padding: max(4px, env(safe-area-inset-top)) max(4px, env(safe-area-inset-right)) max(4px, env(safe-area-inset-bottom)) max(4px, env(safe-area-inset-left));')
    expect(root).toContain('grid-template-rows: var(--three-topbar-height) minmax(0, 1fr) var(--three-dock-height);')
    expect(root).toContain('gap: 4px;')
    expect(shell).toMatch(/\.three-stage \{[^}]*border: 1px /)
    expect(css('graphics.css')).toMatch(/\.three-board-stage \{[^}]*border: 1px /)
    // A 344x770 browser tab leaves the board well under the viewport height.
    expect(narrowStage(344, 770)).toEqual({ width: 332, height: 583.25 })
    expect(narrowStage(344, 770, 2).height).toBe(478.5)
  })

  it('classifies the narrow profile at the shared 480px breakpoint', () => {
    expect(NARROW_LAYOUT_QUERY).toBe(`(max-width: ${NARROW_LAYOUT_MAX_WIDTH}px)`)
    expect(isNarrowWidth(344)).toBe(true)
    expect(isNarrowWidth(480)).toBe(true)
    expect(isNarrowWidth(481)).toBe(false)
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(isNarrowWidth(invalid)).toBe(false)
  })

  it.each(viewports)('keeps fixed type slots inside the lanes at %s', (_, { width, height }, headers) => {
    const layout = narrowBoardLayout(width, height, headers)
    expect(layout.height).toBeGreaterThanOrEqual(Math.max(NARROW_MIN_BOARD_HEIGHT, height))
    expect(layout.height).toBeLessThanOrEqual(Math.max(NARROW_MIN_BOARD_HEIGHT, height) * NARROW_MAX_BOARD_GROWTH)
    for (const row of ['far', 'near', 'hand'] as const) {
      // Measured headers keep their height and end above their own card lane.
      expect(layout.rows[row].labelHeight).toBeCloseTo(headers[row], 6)
      const laneTop = layout.height / 2 - layout.rows[row].y - layout.rows[row].height / 2
      expect(layout.rows[row].labelTop + layout.rows[row].labelHeight).toBeLessThanOrEqual(laneTop + 0.001)
    }
    expect(layout.mode).toBe('narrow')
    expect(layout.compact).toBe(false)
    expect(layout.cardWidth).toBeGreaterThanOrEqual(44)
    expect(layout.cardHeight).toBeGreaterThanOrEqual(44)
    expect(layout.columns.cardsWidth).toBe(width - 16)
    for (const row of ['far', 'near'] as const) {
      const bounds = laneBounds(layout, row)
      for (let slot = 0; slot < NARROW_TYPE_SLOTS; slot++) {
        const x = typeSlotX(slot, layout)
        expect(x - layout.cardWidth / 2).toBeGreaterThanOrEqual(bounds.left - 0.001)
        expect(x + layout.cardWidth / 2).toBeLessThanOrEqual(bounds.right + 0.001)
        if (slot) expect(x - typeSlotX(slot - 1, layout)).toBeGreaterThanOrEqual(layout.cardWidth)
      }
      expect(layout.rows[row].y + layout.cardHeight / 2).toBeLessThanOrEqual(bounds.top + 0.001)
      expect(layout.rows[row].y - layout.cardHeight / 2).toBeGreaterThanOrEqual(bounds.bottom - 0.001)
    }
    expect(layout.rows.far.y).toBeGreaterThan(layout.rows.near.y)
    expect(layout.rows.near.y).toBeGreaterThan(layout.rows.hand.y)
    const handBottom = layout.height / 2 - layout.rows.hand.y + layout.rows.hand.height / 2
    expect(handBottom).toBeLessThanOrEqual(layout.height + 0.001)
    // The hand receives at least as much height as a battlefield row.
    expect(layout.rows.hand.height).toBeGreaterThanOrEqual(layout.rows.near.height)
  })

  it('does not depend on how many creatures are on the battlefield', () => {
    const layout = narrowBoardLayout(344, 655)
    expect(narrowBoardLayout(344, 655)).toEqual(layout)
    expect(typeSlotX(-3, layout)).toBe(typeSlotX(0, layout))
    expect(typeSlotX(99, layout)).toBe(typeSlotX(NARROW_TYPE_SLOTS - 1, layout))
    expect(typeSlotX(Number.NaN, layout)).toBe(typeSlotX(0, layout))
  })

  it('drops onto the near header or lane, never the hand', () => {
    const layout = narrowBoardLayout(344, 655)
    const near = layout.rows.near
    const headerY = layout.height / 2 - near.labelTop - near.labelHeight / 2
    expect(pointInRect({ x: 0, y: near.y }, layout.drop)).toBe(true)
    expect(pointInRect({ x: 0, y: headerY }, layout.drop)).toBe(true)
    expect(pointInRect({ x: layout.columns.cardsWidth / 2 - 2, y: near.y }, layout.drop)).toBe(true)
    expect(pointInRect({ x: 0, y: layout.rows.hand.y }, layout.drop)).toBe(false)
    expect(pointInRect({ x: 0, y: layout.rows.far.y }, layout.drop)).toBe(false)
  })

  it('fits the Fold4 cover screen with large board slots and a large hand', () => {
    const layout = narrowBoardLayout(cover.width, cover.height, { far: 36, near: 36, hand: 50 })
    expect(layout.cardWidth).toBeGreaterThanOrEqual(56)
    expect(layout.cardHeight).toBeGreaterThanOrEqual(78)
    const five = narrowHandRects(5, layout)
    expect(five[0].width).toBeGreaterThanOrEqual(90)
    const seven = narrowHandRects(7, layout)
    expect(seven[0].width).toBeGreaterThanOrEqual(70)
  })

  it.each(viewports)('keeps every page of up to fifty hand cards separate and tappable at %s', (_, { width, height }, headers) => {
    const layout = narrowBoardLayout(width, height, headers)
    const bounds = laneBounds(layout, 'hand')
    const pageSize = narrowHandPageSize(layout)
    for (let count = 1; count <= 50; count++) {
      for (let start = 0; start < count; start += pageSize) {
        const rects = narrowHandRects(count - start, layout)
        expect(rects).toHaveLength(Math.min(count - start, pageSize))
        for (const [index, rect] of rects.entries()) {
          expect(rect.width).toBeGreaterThanOrEqual(44)
          expect(rect.x - rect.width / 2).toBeGreaterThanOrEqual(bounds.left - 0.001)
          expect(rect.x + rect.width / 2).toBeLessThanOrEqual(bounds.right + 0.001)
          expect(rect.y + rect.height / 2).toBeLessThanOrEqual(bounds.top + 0.001)
          expect(rect.y - rect.height / 2).toBeGreaterThanOrEqual(bounds.bottom - 0.001)
          for (const other of rects.slice(index + 1)) expect(overlaps(rect, other)).toBe(false)
        }
      }
    }
  })

  it('keeps the hand in reading order and handles invalid input safely', () => {
    const layout = narrowBoardLayout(344, 655)
    const rects = narrowHandRects(7, layout)
    for (let index = 1; index < rects.length; index++) {
      const previous = rects[index - 1]
      const current = rects[index]
      expect(current.y < previous.y - 0.001 || (Math.abs(current.y - previous.y) < 0.001 && current.x > previous.x)).toBe(true)
    }
    expect(narrowHandRects(0, layout)).toEqual([])
    expect(narrowHandRects(-2, layout)).toEqual([])
    expect(narrowHandRects(Number.NaN, layout)).toEqual([])
    const degenerate = narrowBoardLayout(Number.NaN, -1, { far: Number.NaN, near: -5, hand: Number.POSITIVE_INFINITY })
    expect(Number.isFinite(degenerate.cardWidth)).toBe(true)
    expect(degenerate.cardHeight).toBeGreaterThan(0)
    expect(narrowHandRects(3, degenerate).every((rect) => Number.isFinite(rect.x) && Number.isFinite(rect.y))).toBe(true)
  })

  it('reserves scrollable height for full touch targets when the narrow viewport is short', () => {
    const layout = narrowBoardLayout(344, 200, { far: 36, near: 36, hand: 50 })
    expect(layout.height).toBeGreaterThan(200)
    expect(layout.cardWidth).toBeGreaterThanOrEqual(44)
    expect(layout.cardHeight).toBeGreaterThanOrEqual(44)
    const rects = narrowHandRects(50, layout)
    expect(rects).toHaveLength(narrowHandPageSize(layout))
    expect(rects.every((rect) => rect.width >= 44)).toBe(true)
  })

  it('removes inherited narrow HUD padding and keeps clipped controls focusable visibly', () => {
    const shell = css('renderer.css')
    expect(shell).toMatch(/\.three-root--narrow \.three-hud-mount \{[^}]*padding: 0;/)
    const styles = css('interface.css')
    expect(styles).toMatch(/\.three-interface \.three-hud\[data-layout="narrow"\] :focus-visible[^}]*outline-offset: -3px;/)
    expect(styles).toMatch(/\.three-dock-actions\.three-interface :focus-visible[^}]*outline-offset: -3px;/)
    expect(shell).toMatch(/\.three-dock \.three-board-primary:focus-visible \{[^}]*outline-offset: -3px;/)
  })

  it('grows the scrollable board instead of shrinking large-text headers into the lanes', () => {
    // Fold4 cover screen in a browser tab at 200% text.
    const stage = narrowStage(344, 770, 2)
    const headers = { far: 72, near: 72, hand: 100 }
    const layout = narrowBoardLayout(stage.width, stage.height, headers)
    expect(layout.height).toBe(Math.ceil(stage.height + 244 - stage.height * 0.3))
    expect(layout.rows.far.labelHeight).toBe(72)
    expect(layout.rows.near.labelHeight).toBe(72)
    expect(layout.rows.hand.labelHeight).toBe(100)
    // The card lanes keep the space they had in the stage-sized board.
    const unscaled = narrowBoardLayout(stage.width, stage.height, { far: 36, near: 36, hand: 50 })
    expect(layout.cardHeight).toBeCloseTo(unscaled.cardHeight, 0)
  })

  it('bounds board growth for oversized headers instead of collapsing the lanes', () => {
    const layout = narrowBoardLayout(344, 655, { far: 400, near: 400, hand: 400 })
    expect(layout.height).toBe(655 * NARROW_MAX_BOARD_GROWTH)
    const chrome = layout.rows.far.labelHeight + layout.rows.near.labelHeight + layout.rows.hand.labelHeight
    expect(chrome).toBeLessThanOrEqual(layout.height - 655 * 0.7 + 0.001)
    expect(layout.cardHeight).toBeGreaterThan(60)
  })
})

type UnfoldedShell = Exclude<TouchLayoutMode, 'narrow'>

/** The rail column, `clamp(180px, 26vw, 240px)` in renderer.css. */
const railWidth = (viewportWidth: number) => Math.min(240, Math.max(180, 0.26 * viewportWidth))

/**
 * The board's stage size inside renderer.css's unfolded shells, derived as
 * narrowStage() derives the cover screen's: the 3.5rem top bar, 4px gaps,
 * safe-area-aware 4px padding, and stage borders, plus a fixed two-line dock
 * below the board (`dock`) or a rail column beside it (`rail`).
 */
function unfoldedStage(
  shell: UnfoldedShell, viewportWidth: number, viewportHeight: number, textScale = 1, insets: SafeArea = NO_INSETS,
) {
  const rem = 16 * textScale
  const pad = (inset: number) => Math.max(4, inset)
  const gap = 4
  const borders = 4
  const width = viewportWidth - pad(insets.left) - pad(insets.right) - borders
  const height = viewportHeight - pad(insets.top) - pad(insets.bottom) - 3.5 * rem - borders
  return shell === 'dock'
    ? { width, height: height - 2 * gap - (2 * 1.25 * 0.8125 * rem + Math.max(44, 1.125 * rem + 16) + 18) }
    : { width: width - gap - railWidth(viewportWidth), height: height - gap }
}

/** Every rule in a css() source, with its selector list split. */
const cssRules = (source: string) => [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, list, body]) => ({ selectors: list.split(',').map((selector) => selector.trim()), body: body.trim() }))

/** The declarations of the rules whose selector list is exactly `selectors`. */
const ruleBody = (source: string, ...selectors: string[]) => cssRules(source)
  .filter((rule) => rule.selectors.join(', ') === selectors.join(', '))
  .map((rule) => rule.body)
  .join(' ')

/**
 * The board's stage size in the short rail, where the top bar heads the rail
 * column and the stage spans the full height beside it (renderer.css). Text
 * size changes only the headers.
 */
function shortRailStage(viewportWidth: number, viewportHeight: number, insets: SafeArea = NO_INSETS) {
  const pad = (inset: number) => Math.max(4, inset)
  const gap = 4
  const borders = 4
  return {
    width: viewportWidth - pad(insets.left) - pad(insets.right) - gap - railWidth(viewportWidth) - borders,
    height: viewportHeight - pad(insets.top) - pad(insets.bottom) - borders,
  }
}

/** A notched phone held sideways: an inset on both sides and one for the gesture bar. */
const SIDEWAYS_NOTCH: SafeArea = { top: 0, right: 47, bottom: 21, left: 47 }
const SHORT_RAIL_POSTURES = [
  ...FOLD4_POSTURES.flatMap(([name, width, height, { short }]) => short ? [[`Fold4 ${name}`, width, height, NO_INSETS] as const] : []),
  ['phone held sideways', 844, 390, NO_INSETS] as const,
  ['notched phone held sideways', 844, 390, SIDEWAYS_NOTCH] as const,
]
/** Single-line headers; a paged hand's header is the short rail's 44px pager strip (board.ts applySize). */
const shortRailHeaders = (scale: number, paged: boolean) => ({ far: 21 * scale, near: 21 * scale, hand: (paged ? 44 : 22) * scale })
const shortRailViewports = SHORT_RAIL_POSTURES.flatMap(([name, width, height, insets]) => [1, 2].flatMap((scale) =>
  [false, true].map((paged) => [
    `the ${name} (${width}x${height}) at ${scale * 100}% text${paged ? ' and a paged hand' : ''}`,
    shortRailStage(width, height, insets), shortRailHeaders(scale, paged), scale,
  ] as const)))

describe('Three.js unfolded dock and rail layouts', () => {
  // The Milestone 0 main-screen postures: portrait gets the dock, landscape the rail.
  const postures = FOLD4_POSTURES.flatMap(([name, width, height, { profile, short }]) =>
    (profile === 'dock' || profile === 'rail') && !short ? [{ name, width, height, shell: profile }] : [])
  const fold4Pwa: SafeArea = { top: 28, right: 0, bottom: 16, left: 0 }
  // Single-line headers; only a hand with more pages reserves the pager row (board.ts applySize).
  const headers = (scale: number, paged: boolean) => ({ far: 21 * scale, near: 21 * scale, hand: (paged ? 50 : 22) * scale })
  const viewports = [
    ...postures.flatMap(({ name, width, height, shell }) => (
      [[1, NO_INSETS], [2, NO_INSETS], [1, fold4Pwa]] as const
    ).flatMap(([scale, insets]) => [false, true].map((paged) => [
      `${name} (${width}x${height}) at ${scale * 100}% text${insets === NO_INSETS ? '' : ' with safe areas'}${paged ? ' and a paged hand' : ''}`,
      shell, unfoldedStage(shell, width, height, scale, insets), headers(scale, paged),
    ] as const))),
    ...shortRailViewports.map(([label, stage, rowHeaders]) => [label, 'rail', stage, rowHeaders] as const),
  ]

  it('covers both unfolded shells', () => {
    expect(postures.map(({ shell }) => shell).sort()).toEqual(['dock', 'dock', 'rail', 'rail'])
  })

  it('derives dock and rail stage sizes from the fixed shells in renderer.css', () => {
    const shell = css('renderer.css')
    const unfolded = ruleBody(shell, '.three-root--game[data-shell="dock"]', '.three-root--game[data-shell="rail"]')
    expect(unfolded).toContain('--three-topbar-height: 3.5rem;')
    expect(unfolded).toContain('--three-dock-prompt-height: calc(2 * 1.25 * 0.8125rem);')
    expect(unfolded).toContain('padding: 4px; padding: max(4px, env(safe-area-inset-top)) max(4px, env(safe-area-inset-right)) max(4px, env(safe-area-inset-bottom)) max(4px, env(safe-area-inset-left));')
    expect(unfolded).toContain('gap: 4px;')
    const dock = ruleBody(shell, '.three-root--game[data-shell="dock"]')
    expect(dock).toContain('--three-dock-height: calc(var(--three-dock-prompt-height) + max(44px, 1.125rem + 16px) + 18px);')
    expect(dock).toContain('grid-template-rows: var(--three-topbar-height) minmax(0, 1fr) var(--three-dock-height);')
    // The dock's action row reserves End Turn's height, which grows with the text.
    const primary = ruleBody(shell, '.three-dock .three-board-primary')
    expect(primary).toContain('padding: 6px 12px;')
    expect(primary).toContain('font-size: 0.9375rem;')
    const basePrimary = ruleBody(css('graphics.css'), '.three-board-primary')
    expect(basePrimary).toContain('border: 2px solid #b1ffdd;')
    expect(basePrimary).toContain('font: 700 1rem/1.2 system-ui, sans-serif;')
    const dockBox = ruleBody(shell, '.three-root--game[data-shell="dock"] .three-dock',
      '.three-root--game[data-shell="rail"] .three-dock', '.three-root--narrow .three-dock')
    expect(dockBox).toContain('padding: 6px;')
    expect(dockBox).toContain('border: 1px solid #476478;')
    expect(dockBox).toContain('gap: 4px 6px;')
    const rail = ruleBody(shell, '.three-root--game[data-shell="rail"]')
    expect(rail).toContain('--three-rail-width: clamp(180px, 26vw, 240px);')
    expect(rail).toContain('grid-template-columns: minmax(0, 1fr) var(--three-rail-width);')
    expect(rail).toContain('grid-template-rows: var(--three-topbar-height) minmax(0, 1fr);')
    expect(rail).toContain('grid-template-areas: "hud rail" "stage rail";')
    // The top bar stays above the board; the rail spans both rows on the right.
    expect(ruleBody(shell, '.three-root--game[data-shell="rail"] .three-hud-mount')).toBe('grid-area: hud;')
    expect(ruleBody(shell, '.three-root--game[data-shell="rail"] .three-stage')).toBe('grid-area: stage;')
    expect(ruleBody(shell, '.three-root--game[data-shell="rail"] .three-dock')).toContain('grid-area: rail;')
    expect(unfoldedStage('dock', 690, 717)).toEqual({ width: 678, height: 546.5 })
    expect(unfoldedStage('dock', 690, 717, 2).height).toBe(450)
    expect(unfoldedStage('rail', 829, 578).width).toBeCloseTo(597.46, 6)
    expect(unfoldedStage('rail', 829, 578).height).toBe(506)
  })

  it.each(postures.map((posture) => [posture.name, posture] as const))(
    'fits the five-card opening hand in one row and 85x117 slots in the %s at 100%% text',
    (_, { width, height, shell }) => {
      const stage = unfoldedStage(shell, width, height)
      const layout = narrowBoardLayout(stage.width, stage.height, headers(1, false), shell)
      expect(layout.mode).toBe(shell)
      // Nothing scrolls at 100% text.
      expect(layout.height).toBe(stage.height)
      expect(layout.cardHeight).toBe(117)
      expect(layout.cardWidth).toBeCloseTo(117 * 0.73, 6)
      const hand = narrowHandRects(DEFAULT_OPENING_HAND_SIZE, layout)
      expect(hand).toHaveLength(DEFAULT_OPENING_HAND_SIZE)
      expect(new Set(hand.map((rect) => rect.y)).size).toBe(1)
      for (const rect of hand) {
        expect(rect.width).toBeGreaterThanOrEqual(108)
        expect(rect.height).toBeGreaterThanOrEqual(148)
      }
      // Portrait reaches the plan's 115x158 target.
      if (shell === 'dock') expect(hand[0].height).toBe(158)
    },
  )

  it.each(viewports)('keeps every target at least 44px and inside the board at %s', (_, shell, stage, rowHeaders) => {
    const layout = narrowBoardLayout(stage.width, stage.height, rowHeaders, shell)
    expect(layout.mode).toBe(shell)
    // The board spans the stage's grid track, beside the rail and above the dock;
    // large text, or a short rail below the minimum board, grows it into the
    // stage's own scroll area instead.
    expect(layout.width).toBe(stage.width)
    expect(layout.height).toBeGreaterThanOrEqual(stage.height)
    expect(layout.height).toBeLessThanOrEqual(Math.max(NARROW_MIN_BOARD_HEIGHT, stage.height) * NARROW_MAX_BOARD_GROWTH)
    expect(layout.cardWidth).toBeGreaterThanOrEqual(44)
    expect(layout.cardHeight).toBeGreaterThanOrEqual(44)
    for (const row of ['far', 'near', 'hand'] as const) {
      expect(layout.rows[row].labelHeight).toBeCloseTo(rowHeaders[row], 6)
      const laneTop = layout.height / 2 - layout.rows[row].y - layout.rows[row].height / 2
      expect(layout.rows[row].labelTop + layout.rows[row].labelHeight).toBeLessThanOrEqual(laneTop + 0.001)
    }
    const inside = (rect: BoardRect, bounds: ReturnType<typeof laneBounds>) =>
      rect.x - rect.width / 2 >= bounds.left - 0.001 && rect.x + rect.width / 2 <= bounds.right + 0.001
      && rect.y + rect.height / 2 <= bounds.top + 0.001 && rect.y - rect.height / 2 >= bounds.bottom - 0.001
    const board = { left: -layout.width / 2, right: layout.width / 2, top: layout.height / 2, bottom: -layout.height / 2 }
    expect(inside(layout.drop, board)).toBe(true)
    for (const row of ['far', 'near'] as const) {
      const slots = Array.from({ length: NARROW_TYPE_SLOTS }, (_, slot) => (
        { x: typeSlotX(slot, layout), y: layout.rows[row].y, width: layout.cardWidth, height: layout.cardHeight }))
      expect(slots.every((slot) => inside(slot, laneBounds(layout, row)))).toBe(true)
      expect(slots.some((slot, index) => slots.slice(index + 1).some((other) => overlaps(slot, other)))).toBe(false)
    }
    const hand = laneBounds(layout, 'hand')
    const pageSize = narrowHandPageSize(layout)
    for (let count = 1; count <= 50; count++) {
      for (let start = 0; start < count; start += pageSize) {
        const rects = narrowHandRects(count - start, layout)
        expect(rects).toHaveLength(Math.min(count - start, pageSize))
        expect(rects.every((rect) => rect.width >= 44 && rect.height >= 44 && inside(rect, hand))).toBe(true)
        expect(rects.some((rect, index) => rects.slice(index + 1).some((other) => overlaps(rect, other)))).toBe(false)
      }
    }
  })

  it('keeps the cover-screen geometry for narrow and unknown shells', () => {
    const stage = narrowStage(344, 770)
    const narrow = narrowBoardLayout(stage.width, stage.height, { far: 36, near: 36, hand: 50 })
    expect(narrowBoardLayout(stage.width, stage.height, { far: 36, near: 36, hand: 50 }, 'narrow')).toEqual(narrow)
    expect(narrowBoardLayout(stage.width, stage.height, { far: 36, near: 36, hand: 50 }, 'desktop' as never)).toEqual(narrow)
    // The unfolded maxima never shrink a cover-screen board, which stays below them.
    expect(narrowBoardLayout(stage.width, stage.height, { far: 36, near: 36, hand: 50 }, 'dock')).toEqual({ ...narrow, mode: 'dock' })
  })

  it('gives the unfolded boards every narrow header rule except the always-reserved pager row', () => {
    const graphics = css('graphics.css')
    expect(graphics).not.toContain('@media (max-width: 480px)')
    expect(ruleBody(graphics, '.three-root[data-shell] .three-board-stage')).toBe('border-radius: 10px;')
    const narrowRules = cssRules(graphics).filter(({ selectors }) => selectors.some((selector) => selector.includes('[data-layout="narrow"]')))
    expect(narrowRules.length).toBeGreaterThan(5)
    for (const { selectors, body } of narrowRules) {
      if (body === 'min-height: 50px;') {
        expect(selectors).toEqual(['.three-board-stage[data-layout="narrow"] .three-board-label[data-row="hand"]'])
        continue
      }
      for (const selector of selectors.filter((candidate) => candidate.includes('[data-layout="narrow"]'))) {
        for (const shell of ['dock', 'rail']) {
          expect(selectors).toContain(selector.replace('[data-layout="narrow"]', `[data-layout="${shell}"]`))
        }
      }
    }
  })

  it('gives the unfolded top bars every narrow top-bar rule', () => {
    const styles = css('interface.css')
    const narrowRules = cssRules(styles).filter(({ selectors }) => selectors.some((selector) => selector.includes('.three-hud[data-layout="narrow"]')))
    expect(narrowRules.length).toBeGreaterThan(5)
    for (const { selectors } of narrowRules) {
      for (const selector of selectors.filter((candidate) => candidate.includes('.three-hud[data-layout="narrow"]'))) {
        for (const shell of ['dock', 'rail']) {
          expect(selectors).toContain(selector.replace('[data-layout="narrow"]', `[data-layout="${shell}"]`))
        }
      }
    }
    expect(styles).toMatch(/\.three-interface \.three-hud\[data-layout="rail"\] :focus-visible[^}]*outline-offset: -3px;/)
  })

  it('stacks rail actions at 48px and keeps overlays over the board column', () => {
    const shell = css('renderer.css')
    expect(ruleBody(shell, '.three-root--game[data-shell="rail"] .three-dock')).toContain('grid-template-areas: "prompt" "actions" "primary";')
    const primary = ruleBody(shell, '.three-root--game[data-shell="rail"] .three-dock .three-board-primary')
    expect(primary).toContain('width: 100%;')
    expect(primary).toContain('min-height: 48px;')
    const styles = css('interface.css')
    expect(ruleBody(styles, '.three-root--game[data-shell="rail"] .three-dock-actions.three-interface')).toContain('flex-direction: column;')
    expect(ruleBody(styles, '.three-root--game[data-shell="rail"] .three-dock-actions.three-interface button')).toContain('min-height: 48px;')
    // The dock's target list opens above it; the rail's beside it, clear of the rail.
    expect(ruleBody(styles, '.three-root--game[data-shell="dock"] .three-interface .three-target-panel', '.three-root--narrow .three-interface .three-target-panel'))
      .toContain('bottom: calc(max(4px, env(safe-area-inset-bottom)) + var(--three-dock-height, 111px) + 8px);')
    const clearOfRail = 'right: calc(16px + var(--three-rail-width, 180px)); right: calc(max(4px, env(safe-area-inset-right)) + var(--three-rail-width, 180px) + 12px);'
    const panel = ruleBody(styles, '.three-root--game[data-shell="rail"] .three-interface .three-target-panel')
    expect(panel).toContain(clearOfRail)
    expect(panel).toContain('transform: none;')
    expect(ruleBody(styles, '.three-root--game[data-shell="rail"] .three-interface .three-tutorial-banner')).toContain(clearOfRail)
  })

  it('precedes every safe-area declaration in the renderer styles with a plain fallback', () => {
    for (const file of ['renderer.css', 'graphics.css', 'interface.css']) {
      for (const { selectors, body } of cssRules(css(file))) {
        const declarations = body.split(';').map((declaration) => declaration.trim()).filter(Boolean)
        declarations.forEach((declaration, index) => {
          if (!declaration.includes('env(')) return
          const property = declaration.slice(0, declaration.indexOf(':')).trim()
          const fallback = declarations.slice(0, index)
            .some((earlier) => earlier.startsWith(`${property}:`) && !earlier.includes('env('))
          expect(fallback, `${file}: ${selectors.join(', ')} { ${declaration} }`).toBe(true)
        })
      }
    }
  })
})

describe('Three.js short-landscape rail', () => {
  const SHORT = '.three-root--game[data-shell="rail"][data-shell-short="true"]'
  const bottomOf = (layout: ThreeLayout, row: 'far' | 'near' | 'hand') =>
    layout.height / 2 - layout.rows[row].y + layout.rows[row].height / 2

  it('gives the board the full height beside a rail headed by the top bar', () => {
    const shell = css('renderer.css')
    expect(ruleBody(shell, SHORT)).toBe('grid-template-areas: "stage hud" "stage rail";')
    // The rows stay the plain rail's, so the top bar keeps its fixed rem height.
    expect(ruleBody(shell, '.three-root--game[data-shell="rail"]'))
      .toContain('grid-template-rows: var(--three-topbar-height) minmax(0, 1fr);')
    // The actions keep their full height, and the rail scrolls rather than clipping them.
    const rail = ruleBody(shell, `${SHORT} .three-dock`)
    expect(rail).toContain('grid-template-rows: minmax(var(--three-dock-prompt-height), 1fr) max-content auto;')
    expect(rail).toContain('overflow-y: auto;')
    expect(rail).toContain('overscroll-behavior: contain;')
    expect(SHORT_RAIL_POSTURES.map(([, width, height]) => threeShellProfile({ width, height, coarse: true })))
      .toEqual([SHORT_RAIL_SHELL, SHORT_RAIL_SHELL, SHORT_RAIL_SHELL])
    const cover = shortRailStage(882, 232)
    expect(cover.width).toBeCloseTo(636.68, 6)
    expect(cover.height).toBe(220)
    expect(shortRailStage(844, 390, SIDEWAYS_NOTCH).height).toBe(361)
  })

  it.each(shortRailViewports.filter(([, , , scale]) => scale === 1))(
    'shows the whole hand under a card-high strip of the drop zone in one view at %s',
    (_, stage, rowHeaders) => {
      const layout = narrowBoardLayout(stage.width, stage.height, rowHeaders, 'rail')
      // Only a stage below the minimum board, such as the cover screen's, scrolls.
      expect(layout.height).toBe(Math.max(NARROW_MIN_BOARD_HEIGHT, stage.height))
      const dropBottom = layout.height / 2 - layout.drop.y + layout.drop.height / 2
      expect(dropBottom).toBeCloseTo(bottomOf(layout, 'near'), 6)
      expect(layout.rows.hand.labelTop).toBeGreaterThan(dropBottom)
      expect(bottomOf(layout, 'hand') - (dropBottom - layout.cardHeight)).toBeLessThanOrEqual(stage.height + 0.001)
    },
  )

  it.each(shortRailViewports.filter(([, , , scale]) => scale === 2))(
    'keeps every row and the drop zone reachable whole by scrolling at %s',
    (_, stage, rowHeaders) => {
      const layout = narrowBoardLayout(stage.width, stage.height, rowHeaders, 'rail')
      expect(layout.height).toBeGreaterThan(stage.height)
      for (const row of ['far', 'near', 'hand'] as const) {
        expect(bottomOf(layout, row) - layout.rows[row].labelTop).toBeLessThanOrEqual(stage.height)
      }
      // With the whole hand in view, part of the drop zone still shows above it.
      expect(bottomOf(layout, 'near')).toBeGreaterThan(bottomOf(layout, 'hand') - stage.height)
    },
  )

  it('scrolls a large-text top bar and wraps the actions in the rail instead of clipping them', () => {
    const styles = css('interface.css')
    const hud = `${SHORT} .three-interface .three-hud[data-layout="rail"]`
    const top = ruleBody(styles, hud)
    expect(top).toContain('overflow-y: auto;')
    expect(top).toContain('overscroll-behavior: contain;')
    // The menu and Hint stay reachable while the title and status scroll.
    const pinned = ruleBody(styles, `${hud} > [data-action="menu"]`, `${hud} > [data-action="tutorial-show"]`)
    expect(pinned).toContain('position: sticky;')
    expect(pinned).toContain('top: 0;')
    expect(ruleBody(styles, `${hud} > p`)).toContain('max-height: none;')
    // The board starts at the top of the screen, and so does the tutorial banner.
    expect(ruleBody(styles, `${SHORT} .three-interface .three-tutorial-banner`))
      .toBe('top: 12px; top: calc(max(4px, env(safe-area-inset-top)) + 8px);')
    const actions = ruleBody(styles, `${SHORT} .three-dock-actions.three-interface`)
    expect(actions).toContain('flex-direction: row;')
    expect(actions).toContain('flex-wrap: wrap;')
    expect(ruleBody(styles, `${SHORT} .three-dock-actions.three-interface button`)).toContain('flex: 1 1 auto;')
    // The rail's 48px actions still apply.
    expect(ruleBody(styles, '.three-root--game[data-shell="rail"] .three-dock-actions.three-interface button'))
      .toContain('min-height: 48px;')
    // The pager's 44px buttons bleed into the hand header's padding instead of growing it.
    expect(ruleBody(css('graphics.css'),
      '.three-root[data-shell-short="true"] .three-board-stage[data-layout="rail"] .three-board-pagination button'))
      .toBe('margin-block: -3px;')
  })
})

describe('Three.js shell profile', () => {
  const NARROW: ThreeShell = NARROW_SHELL
  const DOCK: ThreeShell = DOCK_SHELL
  const RAIL: ThreeShell = RAIL_SHELL
  const SHORT_RAIL: ThreeShell = SHORT_RAIL_SHELL
  const DESKTOP: ThreeShell = DESKTOP_SHELL
  const touch = (width: number, height: number) => threeShellProfile({ width, height, coarse: true })
  const mouse = (width: number, height: number) => threeShellProfile({ width, height, coarse: false })

  it.each(FOLD4_POSTURES)('maps the Fold4 %s (%sx%s) by pointer type', (_, width, height, coarse, fine) => {
    expect(touch(width, height)).toEqual(coarse)
    expect(mouse(width, height)).toEqual(fine)
  })

  it('switches at the 480px narrow and 1024px desktop widths', () => {
    expect(TOUCH_SHELL_MAX_WIDTH).toBe(1024)
    expect(touch(NARROW_LAYOUT_MAX_WIDTH, 700)).toEqual(NARROW)
    expect(touch(NARROW_LAYOUT_MAX_WIDTH + 1, 700)).toEqual(DOCK)
    expect(mouse(NARROW_LAYOUT_MAX_WIDTH, 700)).toEqual(NARROW)
    expect(mouse(NARROW_LAYOUT_MAX_WIDTH + 1, 700)).toEqual(DESKTOP)
    expect(touch(1024, 768)).toEqual(RAIL)
    expect(touch(1025, 768)).toEqual(DESKTOP)
    expect(touch(1024, 1366)).toEqual(DOCK)
    expect(touch(1025, 1366)).toEqual(DESKTOP)
  })

  it('uses the short rail for landscape touch screens at most 480px high', () => {
    expect(SHORT_SHELL_MAX_HEIGHT).toBe(480)
    expect(touch(882, 480)).toEqual(SHORT_RAIL)
    expect(touch(882, 481)).toEqual(RAIL)
    // Phones held sideways, including wide ones beyond the desktop cap.
    expect(touch(844, 390)).toEqual(SHORT_RAIL)
    expect(touch(932, 430)).toEqual(SHORT_RAIL)
    expect(touch(1100, 480)).toEqual(SHORT_RAIL)
    expect(touch(1100, 481)).toEqual(DESKTOP)
    // Only a landscape rail is ever short.
    expect(touch(344, 200)).toEqual(NARROW)
    expect(touch(481, 481)).toEqual(DOCK)
  })

  it('splits square touch screens on orientation', () => {
    expect(touch(700, 700)).toEqual(DOCK)
    expect(touch(701, 700)).toEqual(RAIL)
    expect(touch(700, 701)).toEqual(DOCK)
    expect(touch(1024, 1024)).toEqual(DOCK)
    expect(touch(1025, 1025)).toEqual(DESKTOP)
    expect(mouse(700, 700)).toEqual(DESKTOP)
  })

  it('keeps fine pointers wider than 480px on the desktop layouts', () => {
    for (const [width, height] of [[481, 900], [690, 717], [829, 578], [882, 232], [1024, 768], [1440, 960]]) {
      expect(mouse(width, height)).toEqual(DESKTOP)
    }
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'falls back to desktop for a %s viewport size',
    (invalid) => {
      for (const coarse of [true, false]) {
        expect(threeShellProfile({ width: invalid, height: 700, coarse })).toEqual(DESKTOP)
        expect(threeShellProfile({ width: 344, height: invalid, coarse })).toEqual(DESKTOP)
        expect(threeShellProfile({ width: invalid, height: invalid, coarse })).toEqual(DESKTOP)
      }
    },
  )

  it('returns immutable results', () => {
    for (const result of [touch(344, 770), touch(690, 717), touch(829, 578), touch(882, 232), mouse(1440, 960)]) {
      expect(Object.isFrozen(result)).toBe(true)
    }
  })
})

describe('Three.js touch drag geometry', () => {
  const layouts: ReadonlyArray<readonly [string, ThreeLayout]> = [
    ['stacked', boardLayout(390, 760)],
    ['compact', boardLayout(844, 390, undefined, true)],
    ['narrow', narrowBoardLayout(332, 583.25, { far: 36, near: 36, hand: 50 })],
  ]

  it.each(layouts)('accepts the %s drop zone exactly for a mouse and widens only its top and sides for touch', (_, layout) => {
    const { drop } = layout
    const top = drop.y + drop.height / 2
    const bottom = drop.y - drop.height / 2
    const right = drop.x + drop.width / 2
    const left = drop.x - drop.width / 2
    const slop = TOUCH_DROP_SLOP_PX
    expect(slop).toBe(12)
    for (const point of [{ x: drop.x, y: drop.y }, { x: left, y: top }, { x: right, y: bottom + 0.01 }]) {
      expect(dropAccepts(point, layout)).toBe(true)
      expect(dropAccepts(point, layout, slop)).toBe(true)
    }
    // Top and side slop for touch and pen only.
    for (const point of [{ x: drop.x, y: top + 6 }, { x: right + 6, y: drop.y }, { x: left - 6, y: drop.y }, { x: right + 11, y: top + 11 }]) {
      expect(dropAccepts(point, layout)).toBe(false)
      expect(dropAccepts(point, layout, slop)).toBe(true)
    }
    for (const point of [{ x: drop.x, y: top + 13 }, { x: right + 13, y: drop.y }, { x: left - 13, y: drop.y }]) {
      expect(dropAccepts(point, layout, slop)).toBe(false)
    }
    // The edge that faces the hand never grows.
    expect(dropAccepts({ x: drop.x, y: bottom - 1 }, layout, slop)).toBe(false)
    expect(dropAccepts({ x: right + 6, y: bottom - 1 }, layout, slop)).toBe(false)
    // Invalid input is never a drop, and invalid slop is no slop.
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(dropAccepts({ x: value, y: drop.y }, layout, slop)).toBe(false)
      expect(dropAccepts({ x: drop.x, y: value }, layout, slop)).toBe(false)
      expect(dropAccepts({ x: drop.x, y: top + 6 }, layout, value)).toBe(false)
    }
    expect(dropAccepts({ x: drop.x, y: top + 6 }, layout, -12)).toBe(false)
  })

  it.each(layouts)('never accepts any point over the %s hand, header included', (_, layout) => {
    const hand = layout.rows.hand
    const lowest = hand.y - hand.height / 2
    const highest = handTop(layout)
    expect(highest).toBeGreaterThanOrEqual(hand.y + hand.height / 2)
    if (layout.mode !== 'compact') expect(highest).toBeCloseTo(layout.height / 2 - hand.labelTop)
    for (let x = -layout.width / 2; x <= layout.width / 2; x += layout.width / 24) {
      for (let y = lowest; y <= highest; y += (highest - lowest) / 16) {
        expect(dropAccepts({ x, y }, layout, TOUCH_DROP_SLOP_PX)).toBe(false)
      }
      expect(dropAccepts({ x, y: highest }, layout, TOUCH_DROP_SLOP_PX)).toBe(false)
    }
  })

  const stage: LayerRect = { left: 0, top: 0, width: 332, height: 583 }
  const card = { width: 80, height: 110 }
  const place = (input: Partial<DragProxyInput>) => dragProxyPlacement({
    pointer: { x: 166, y: 400 }, card, stage, touch: true, ...input,
  })

  it('keeps the mouse placement centred on the pointer at the existing scale', () => {
    expect(MOUSE_DRAG_SCALE).toBe(1.08)
    for (const pointer of [{ x: 166, y: 400 }, { x: 2, y: 2 }, { x: -50, y: 900 }]) {
      expect(dragProxyPlacement({ pointer, card, stage, touch: false, side: 'left' })).toEqual({
        ...pointer, width: card.width * 1.08, height: card.height * 1.08, scale: 1.08, side: 'center',
      })
    }
  })

  it('lifts a smaller touch card above the finger by an adaptive, bounded distance', () => {
    expect(TOUCH_DRAG_SCALE).toBe(0.9)
    const lifted = place({})
    expect(lifted).toMatchObject({ x: 166, width: 72, height: 99, scale: 0.9, side: 'above' })
    // Half the scaled card plus 20px: the finger never covers the card.
    expect(400 - lifted.y).toBeCloseTo(99 / 2 + 20)
    expect(lifted.y + lifted.height / 2).toBeLessThanOrEqual(400 - 20 + 0.001)
    // Small cards still clear the finger by 44px; huge cards lift at most 120px.
    expect(400 - place({ card: { width: 20, height: 30 } }).y).toBe(44)
    const tall: LayerRect = { left: 0, top: 0, width: 800, height: 1200 }
    expect(1000 - place({ pointer: { x: 400, y: 1000 }, card: { width: 300, height: 420 }, stage: tall }).y).toBe(120)
  })

  it('clamps touch placements inside every stage edge with a 4px margin', () => {
    const inside = (placement: ReturnType<typeof place>, area: LayerRect = stage) => {
      expect(placement.x - placement.width / 2).toBeGreaterThanOrEqual(area.left + 4 - 0.001)
      expect(placement.x + placement.width / 2).toBeLessThanOrEqual(area.left + area.width - 4 + 0.001)
      expect(placement.y - placement.height / 2).toBeGreaterThanOrEqual(area.top + 4 - 0.001)
      expect(placement.y + placement.height / 2).toBeLessThanOrEqual(area.top + area.height - 4 + 0.001)
    }
    const leftEdge = place({ pointer: { x: 1, y: 400 } })
    expect(leftEdge.x).toBeCloseTo(4 + 72 / 2)
    inside(leftEdge)
    const rightEdge = place({ pointer: { x: 331, y: 400 } })
    expect(rightEdge.x).toBeCloseTo(332 - 4 - 72 / 2)
    inside(rightEdge)
    const topEdge = place({ pointer: { x: 166, y: 1 } })
    expect(topEdge.y).toBeCloseTo(4 + 99 / 2)
    inside(topEdge)
    const bottomEdge = place({ pointer: { x: 20, y: 583 }, side: 'right' })
    expect(bottomEdge.y).toBeLessThanOrEqual(583 - 4 - 99 / 2 + 0.001)
    inside(bottomEdge)
    for (let x = 0; x <= 332; x += 16) {
      for (let y = 0; y <= 583; y += 16) inside(place({ pointer: { x, y } }))
    }
    // A stage smaller than the card centres it rather than overflowing one edge.
    const tiny: LayerRect = { left: 10, top: 20, width: 60, height: 50 }
    expect(place({ pointer: { x: 15, y: 25 }, stage: tiny })).toMatchObject({ x: 40, y: 45 })
  })

  it('moves beside the finger without room above and keeps that side while it fits', () => {
    const nearTop = { x: 166, y: 90 }
    const first = place({ pointer: nearTop })
    // Ties go left, away from a right thumb, and the card clears the finger.
    expect(first.side).toBe('left')
    expect(first.x + first.width / 2).toBeLessThanOrEqual(nearTop.x - 20 + 0.001)
    expect(first.y).toBeCloseTo(nearTop.y)
    expect(place({ pointer: nearTop, side: 'right' }).side).toBe('right')
    expect(place({ pointer: { x: 250, y: 90 }, side: 'left' }).side).toBe('left')
    // The roomier side wins when the previous side no longer fits.
    expect(place({ pointer: { x: 60, y: 90 }, side: 'left' }).side).toBe('right')
    expect(place({ pointer: { x: 290, y: 90 }, side: 'right' }).side).toBe('left')
    expect(place({ pointer: { x: 200, y: 90 } }).side).toBe('left')
    expect(place({ pointer: { x: 120, y: 90 } }).side).toBe('right')
  })

  it('returns above the finger only with 12px of extra room after moving sideways', () => {
    const lift = 99 / 2 + 20
    const fitsAbove = 4 + 99 / 2 + lift
    expect(place({ pointer: { x: 166, y: fitsAbove } }).side).toBe('above')
    expect(place({ pointer: { x: 166, y: fitsAbove - 1 } }).side).toBe('left')
    expect(place({ pointer: { x: 166, y: fitsAbove + 6 }, side: 'left' }).side).toBe('left')
    expect(place({ pointer: { x: 166, y: fitsAbove + 12 }, side: 'right' }).side).toBe('above')
  })

  it('lifts the card beside the finger whenever a side fits when it prefers a side', () => {
    // Room above, but the short rail goes sideways; ties still go left.
    expect(place({}).side).toBe('above')
    const beside = place({ preferSide: true })
    expect(beside.side).toBe('left')
    expect(beside.x + beside.width / 2).toBeLessThanOrEqual(166 - 20 + 0.001)
    expect(beside.y).toBeCloseTo(400)
    // The side holds while it fits; otherwise the only side that fits wins.
    expect(place({ preferSide: true, pointer: { x: 200, y: 400 } }).side).toBe('left')
    expect(place({ preferSide: true, pointer: { x: 200, y: 400 }, side: 'right' }).side).toBe('right')
    expect(place({ preferSide: true, pointer: { x: 60, y: 400 }, side: 'left' }).side).toBe('right')
    expect(place({ preferSide: true, pointer: { x: 290, y: 400 }, side: 'right' }).side).toBe('left')
    // Above only when neither side fits, then the roomier side when nothing fits.
    const slim: LayerRect = { left: 0, top: 0, width: 150, height: 583 }
    expect(place({ preferSide: true, pointer: { x: 75, y: 400 }, stage: slim, side: 'left' }).side).toBe('above')
    expect(place({ preferSide: true, pointer: { x: 70, y: 90 }, stage: slim }).side).toBe('right')
    // Without it, nothing changes; a mouse stays centred.
    for (const side of ['above', 'left', 'right'] as const) {
      expect(place({ preferSide: false, side })).toEqual(place({ side }))
    }
    expect(dragProxyPlacement({ pointer: { x: 166, y: 400 }, card, stage, touch: false, preferSide: true }).side).toBe('center')
  })

  it('takes the side that leaves the landing ghost in view, without flickering near its centre', () => {
    const overlaps = (placement: ReturnType<typeof place>, rect: LayerRect) =>
      Math.abs(placement.x - (rect.left + rect.width / 2)) < (placement.width + rect.width) / 2
      && Math.abs(placement.y - (rect.top + rect.height / 2)) < (placement.height + rect.height) / 2
    // A 60px ghost beside the finger's row, right of the finger as when dragging straight up the short rail.
    const landing: LayerRect = { left: 180, top: 380, width: 60, height: 36 }
    const right = place({ preferSide: true, pointer: { x: 150, y: 400 }, side: 'right' })
    expect(right.side).toBe('right')
    expect(overlaps(right, landing)).toBe(true)
    const clear = place({ preferSide: true, pointer: { x: 150, y: 400 }, side: 'right', landing })
    expect(clear.side).toBe('left')
    expect(overlaps(clear, landing)).toBe(false)
    // Ties no longer go left when the left card would hide a ghost there.
    expect(place({ preferSide: true, landing: { ...landing, left: 90 } }).side).toBe('right')
    // Sweeping across the ghost switches sides once each way, where the new side first clears it.
    const sweep = (xs: readonly number[]) => {
      let side: DragProxySide | undefined
      const switches: [number, DragProxySide][] = []
      for (const x of xs) {
        const next = place({ preferSide: true, pointer: { x, y: 400 }, side, landing }).side
        if (next !== side) switches.push([x, next])
        side = next
      }
      return switches
    }
    // Both sides fit from 170 to 235; each card clears the ghost 20px past its far edge.
    const xs = Array.from({ length: 66 }, (_, index) => 170 + index)
    expect(sweep(xs)).toEqual([[170, 'left'], [220, 'right']])
    expect(sweep([...xs].reverse())).toEqual([[235, 'right'], [200, 'left']])
    // When both sides cover it, or only one side fits, the usual rules hold.
    expect(place({ preferSide: true, pointer: { x: 210, y: 400 }, side: 'right', landing }).side).toBe('right')
    expect(place({ preferSide: true, pointer: { x: 60, y: 400 }, side: 'left', landing: { ...landing, left: 100 } }).side).toBe('right')
    // Off the card's row, the ghost changes nothing, and a card above the finger ignores it.
    const below: LayerRect = { ...landing, top: 520 }
    expect(place({ preferSide: true, pointer: { x: 150, y: 400 }, side: 'right', landing: below }).side).toBe('right')
    expect(place({ pointer: { x: 150, y: 400 }, landing: { left: 120, top: 300, width: 60, height: 36 } }).side).toBe('above')
  })

  it('places relative to the visible, scrolled part of the stage', () => {
    const scrolled: LayerRect = { left: 0, top: 300, width: 332, height: 583 }
    const nearVisibleTop = place({ pointer: { x: 166, y: 330 }, stage: scrolled })
    expect(nearVisibleTop.side).toBe('left')
    expect(nearVisibleTop.y - nearVisibleTop.height / 2).toBeGreaterThanOrEqual(304 - 0.001)
    const lower = place({ pointer: { x: 166, y: 600 }, stage: scrolled })
    expect(lower).toMatchObject({ side: 'above', y: 600 - (99 / 2 + 20) })
    // The same pointer is above the unscrolled stage's top margin.
    expect(place({ pointer: { x: 166, y: 330 } }).side).toBe('above')
  })

  it('handles invalid sizes and pointers safely', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -5, 0]) {
      const placement = place({ card: { width: value, height: value } })
      expect(Number.isFinite(placement.x) && Number.isFinite(placement.y)).toBe(true)
      expect(placement.width).toBeGreaterThanOrEqual(1)
      expect(placement.height).toBeGreaterThanOrEqual(1)
    }
    const lost = place({ pointer: { x: Number.NaN, y: Number.POSITIVE_INFINITY } })
    expect(Number.isFinite(lost.x) && Number.isFinite(lost.y)).toBe(true)
  })

  it('marks each narrow type slot, and stacks onto an occupied slot as +1', () => {
    const [, , [, narrow]] = layouts
    for (let slot = 0; slot < NARROW_TYPE_SLOTS; slot++) {
      expect(landingSlotRect(narrow, { typeSlot: slot, slotCount: 0, nearCount: 7 })).toEqual({
        x: typeSlotX(slot, narrow), y: narrow.rows.near.y, width: narrow.cardWidth, height: narrow.cardHeight, occupied: false,
      })
      expect(landingSlotRect(narrow, { typeSlot: slot, slotCount: 2, nearCount: 7 }).occupied).toBe(true)
    }
    expect(landingSlotRect(narrow, { typeSlot: 99, slotCount: 0, nearCount: 0 }).x).toBe(typeSlotX(NARROW_TYPE_SLOTS - 1, narrow))
    expect(landingSlotRect(narrow, { typeSlot: 0, slotCount: Number.NaN, nearCount: 0 }).occupied).toBe(false)
  })

  it.each(layouts.slice(0, 2))('appends after the near battlefield in the %s layout', (_, layout) => {
    for (const count of [0, 1, 4, 11]) {
      const rect = landingSlotRect(layout, { typeSlot: 3, slotCount: 5, nearCount: count })
      expect(rect).toEqual({
        x: cardSlotX(count, count + 1, layout), y: layout.rows.near.y,
        width: layout.cardWidth, height: layout.cardHeight, occupied: false,
      })
      expect(dropAccepts(rect, layout)).toBe(true)
    }
    for (const invalid of [Number.NaN, -3]) {
      expect(landingSlotRect(layout, { typeSlot: 0, slotCount: 0, nearCount: invalid }).x).toBe(cardSlotX(0, 1, layout))
    }
  })
})

describe('Three.js long-press peek and edge auto-scroll geometry', () => {
  // The Fold4 cover screen's narrow stage, in client pixels below a 48px top bar.
  const cover: LayerRect = { left: 6, top: 48, width: 332, height: 583 }
  const handCard: LayerRect = { left: 130, top: 520, width: 60, height: 84 }
  const farCard: LayerRect = { left: 20, top: 90, width: 60, height: 84 }

  it('opens on the half of the stage away from the finger, scaled to the stage', () => {
    expect(peekPlacement({ stage: cover, card: handCard, pointer: { x: 160, y: 560 } })).toEqual({
      left: 14, width: 316, side: 'above', y: 512, maxHeight: 512 - 56,
    })
    expect(peekPlacement({ stage: cover, card: farCard, pointer: { x: 50, y: 130 } })).toEqual({
      left: 14, width: 316, side: 'below', y: 182, maxHeight: 623 - 182,
    })
    // A wider screen caps the panel and centres it on the card.
    const main: LayerRect = { left: 0, top: 0, width: 666, height: 600 }
    expect(peekPlacement({ stage: main, card: { left: 300, top: 480, width: 66, height: 92 }, pointer: { x: 333, y: 520 } }))
      .toMatchObject({ left: 153, width: 360, side: 'above' })
  })

  it('never covers the held card and stays inside the visible stage', () => {
    for (let top = cover.top; top + handCard.height <= cover.top + cover.height; top += 37) {
      for (const left of [cover.left, 140, cover.left + cover.width - handCard.width]) {
        const card = { ...handCard, top, left }
        for (const pointerY of [top, top + card.height / 2, top + card.height]) {
          const placement = peekPlacement({ stage: cover, card, pointer: { x: left + 30, y: pointerY } })
          if (!placement) continue
          const [panelTop, panelBottom] = placement.side === 'above'
            ? [placement.y - placement.maxHeight, placement.y]
            : [placement.y, placement.y + placement.maxHeight]
          expect(panelBottom <= card.top || panelTop >= card.top + card.height).toBe(true)
          expect(panelTop).toBeGreaterThanOrEqual(cover.top)
          expect(panelBottom).toBeLessThanOrEqual(cover.top + cover.height)
          expect(placement.left).toBeGreaterThanOrEqual(cover.left)
          expect(placement.left + placement.width).toBeLessThanOrEqual(cover.left + cover.width)
          expect(placement.maxHeight).toBeGreaterThanOrEqual(PEEK_MIN_HEIGHT)
        }
      }
    }
  })

  it('uses the other side when the preferred one is too short, and opens nowhere without room', () => {
    const stage: LayerRect = { left: 0, top: 0, width: 332, height: 300 }
    // The finger is low, but the card sits near the top: the panel goes below.
    expect(peekPlacement({ stage, card: { left: 100, top: 40, width: 60, height: 84 }, pointer: { x: 130, y: 160 } }))
      .toMatchObject({ side: 'below', y: 132 })
    const short: LayerRect = { left: 0, top: 0, width: 332, height: 180 }
    expect(peekPlacement({ stage: short, card: { left: 100, top: 60, width: 60, height: 84 }, pointer: { x: 130, y: 100 } })).toBeNull()
    expect(peekPlacement({ stage: { ...cover, width: 150 }, card: handCard, pointer: { x: 160, y: 560 } })).toBeNull()
  })

  it('tries the other side when the preferred one would clip the whole peek, and opens nowhere when neither fits', () => {
    const tried: PeekSide[] = []
    const needs = (height: number) => (placement: PeekPlacement) => {
      tried.push(placement.side)
      return placement.maxHeight >= height
    }
    const stage: LayerRect = { left: 0, top: 0, width: 332, height: 600 }
    const card: LayerRect = { left: 100, top: 254, width: 60, height: 84 }
    // The finger is low, so above is preferred, but only below has 240px.
    const pointer = { x: 130, y: 300 }
    expect(peekPlacement({ stage, card, pointer })).toMatchObject({ side: 'above', maxHeight: 238 })
    expect(peekPlacement({ stage, card, pointer, fits: needs(240) })).toEqual({ left: 8, width: 316, side: 'below', y: 346, maxHeight: 246 })
    expect(tried).toEqual(['above', 'below'])
    tried.length = 0
    expect(peekPlacement({ stage, card, pointer, fits: needs(250) })).toBeNull()
    expect(tried).toEqual(['above', 'below'])
    // A 332x300 stage leaves 104px above an 84px card at top 120, and 80px below:
    // too short for Signal Siren's two abilities, and for any peek.
    tried.length = 0
    const short: LayerRect = { left: 0, top: 0, width: 332, height: 300 }
    const held: LayerRect = { left: 100, top: 120, width: 60, height: 84 }
    expect(peekPlacement({ stage: short, card: held, pointer: { x: 130, y: 160 } })).toMatchObject({ side: 'above', maxHeight: 104 })
    expect(peekPlacement({ stage: short, card: held, pointer: { x: 130, y: 160 }, fits: needs(200) })).toBeNull()
    expect(tried).toEqual(['above'])
  })

  it('places the peek relative to a scrolled stage and handles invalid input', () => {
    const scrolled = peekPlacement({ stage: { ...cover, top: -200 }, card: { ...handCard, top: 200 }, pointer: { x: 160, y: 240 } })
    expect(scrolled).toMatchObject({ side: 'above', y: 192, maxHeight: 192 - -192 })
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(peekPlacement({ stage: { ...cover, height: value }, card: handCard, pointer: { x: 0, y: 0 } })).toBeNull()
      expect(peekPlacement({ stage: cover, card: { ...handCard, left: value }, pointer: { x: 0, y: 0 } })).toBeNull()
    }
    // A lost pointer falls back to the card's centre, which is in the lower half.
    expect(peekPlacement({ stage: cover, card: handCard, pointer: { x: Number.NaN, y: Number.NaN } })?.side).toBe('above')
  })

  it('scrolls only in the edge bands, faster with depth and capped beyond the edge', () => {
    const [top, bottom] = [100, 500]
    expect(AUTO_SCROLL_EDGE_PX).toBe(48)
    expect(AUTO_SCROLL_MAX_SPEED).toBe(600)
    expect(autoScrollVelocity(300, top, bottom)).toBe(0)
    expect(autoScrollVelocity(top + 48, top, bottom)).toBe(0)
    expect(autoScrollVelocity(top + 24, top, bottom)).toBe(-300)
    expect(autoScrollVelocity(top, top, bottom)).toBe(-600)
    expect(autoScrollVelocity(top - 80, top, bottom)).toBe(-600)
    expect(autoScrollVelocity(bottom - 48, top, bottom)).toBe(0)
    expect(autoScrollVelocity(bottom - 12, top, bottom)).toBe(450)
    expect(autoScrollVelocity(bottom + 80, top, bottom)).toBe(600)
    // A short stage shares its height between the bands.
    expect(autoScrollVelocity(130, 100, 160)).toBe(0)
    expect(autoScrollVelocity(115, 100, 160)).toBe(-300)
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(autoScrollVelocity(value, top, bottom)).toBe(0)
      expect(autoScrollVelocity(top, value, bottom)).toBe(0)
      expect(autoScrollVelocity(top, top, value)).toBe(0)
    }
    expect(autoScrollVelocity(100, 100, 100)).toBe(0)
  })
})
