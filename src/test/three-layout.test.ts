import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  boardLayout, cardSlotX, clientToBoard, compactBoardViewport, dragProxyPlacement, dropAccepts, handTop, isNarrowWidth,
  landingSlotRect, MOUSE_DRAG_SCALE, NARROW_LAYOUT_MAX_WIDTH,
  NARROW_LAYOUT_QUERY, NARROW_MAX_BOARD_GROWTH, NARROW_MIN_BOARD_HEIGHT, NARROW_TYPE_SLOTS, narrowBoardLayout, narrowHandPageSize, narrowHandRects, pendingCardRect, pointInRect,
  SHORT_SHELL_MAX_HEIGHT, threeShellProfile, TOUCH_DRAG_SCALE, TOUCH_DROP_SLOP_PX, TOUCH_SHELL_MAX_WIDTH, typeSlotX,
  type BoardRect, type DragProxyInput, type LayerRect, type ThreeLayout, type ThreeShell,
} from '../renderers/three/layout'

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

describe('Three.js shell profile', () => {
  const NARROW: ThreeShell = { profile: 'narrow', short: false }
  const DOCK: ThreeShell = { profile: 'dock', short: false }
  const RAIL: ThreeShell = { profile: 'rail', short: false }
  const SHORT_RAIL: ThreeShell = { profile: 'rail', short: true }
  const DESKTOP: ThreeShell = { profile: 'desktop', short: false }
  const touch = (width: number, height: number) => threeShellProfile({ width, height, coarse: true })
  const mouse = (width: number, height: number) => threeShellProfile({ width, height, coarse: false })

  // Estimated layout viewports from the plan's Fold4 postures table. Milestone 0
  // device measurements, keyboard-open variants included, replace these rows.
  const fold4Postures: ReadonlyArray<readonly [string, number, number, ThreeShell, ThreeShell]> = [
    ['cover portrait in a Chrome tab', 344, 770, NARROW, NARROW],
    ['cover portrait as an installed PWA', 344, 834, NARROW, NARROW],
    ['cover portrait at full screen', 344, 882, NARROW, NARROW],
    ['cover landscape in a Chrome tab', 882, 232, SHORT_RAIL, DESKTOP],
    ['main portrait in a Chrome tab', 690, 717, DOCK, DESKTOP],
    ['main portrait at full screen', 690, 829, DOCK, DESKTOP],
    ['main landscape in a Chrome tab', 829, 578, RAIL, DESKTOP],
    ['main landscape at full screen', 829, 690, RAIL, DESKTOP],
  ]

  it.each(fold4Postures)('maps the Fold4 %s (%sx%s) by pointer type', (_, width, height, coarse, fine) => {
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
