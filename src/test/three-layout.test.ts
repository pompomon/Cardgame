import { describe, expect, it } from 'vitest'
import { boardLayout, cardSlotX, clientToBoard, compactBoardViewport, pendingCardRect, pointInRect } from '../renderers/three/layout'

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
