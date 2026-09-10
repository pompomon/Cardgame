import { describe, expect, it } from 'vitest'
import { boardLayout, cardSlotX, clientToBoard, compactBoardViewport, pageWindow, pendingCardRect, pointInRect } from '../renderers/three/layout'

describe('Three.js fixed tabletop layout', () => {
  it.each([[320, 690], [390, 844], [844, 690], [1440, 960]])('keeps page cards within %sx%s', (width, height) => {
    const layout = boardLayout(width, height)
    expect(layout.cardHeight).toBeGreaterThan(100)
    expect(layout.capacity).toBeGreaterThan(0)
    const last = cardSlotX(layout.capacity - 1, layout.capacity, layout)
    expect(last + layout.cardWidth / 2).toBeLessThanOrEqual(width / 2)
    expect(layout.rows.far.y).toBeGreaterThan(layout.rows.near.y)
    expect(layout.rows.near.y).toBeGreaterThan(layout.rows.hand.y)
    expect(pointInRect({ x: 0, y: layout.rows.near.y }, layout.drop)).toBe(true)
    expect(pointInRect({ x: 0, y: layout.rows.hand.y }, layout.drop)).toBe(false)
  })

  it.each([1, 3, 7, 16])('makes every card in a long row reachable with capacity %s', (capacity) => {
    const seen: number[] = []
    for (let index = 0; index < pageWindow(103, 0, capacity).pages; index++) {
      const page = pageWindow(103, index, capacity)
      for (let card = page.start; card < page.end; card++) seen.push(card)
    }
    expect(seen).toEqual(Array.from({ length: 103 }, (_, index) => index))
  })

  it.each([[320, 456], [390, 700], [844, 390], [1440, 670]])('fits measured chrome within the %sx%s stage', (width, height) => {
    const headers = { far: 52, near: width < 480 ? 112 : 104, hand: 28 }
    const controls = { far: 44, near: 44, hand: 44 }
    const layout = boardLayout(width, height, headers, controls, compactBoardViewport(width, height))
    expect(layout.height).toBe(height)
    expect(layout.cardHeight).toBeGreaterThan(0)
    for (const row of ['far', 'near', 'hand'] as const) {
      const pos = layout.rows[row]
      const top = layout.height / 2 - pos.y - layout.cardHeight / 2
      expect(pos.labelTop).toBeGreaterThanOrEqual(0)
      expect(pos.labelTop + headers[row]).toBeLessThanOrEqual(layout.height)
      expect(pos.controlsTop).toBeGreaterThanOrEqual(0)
      expect(pos.controlsTop + controls[row]).toBeLessThanOrEqual(layout.height)
      if (!layout.compact) {
        expect(top).toBeGreaterThanOrEqual(pos.labelTop + headers[row])
        expect(top + layout.cardHeight).toBeLessThanOrEqual(pos.controlsTop + 0.001)
      }
    }
    const dropTop = layout.height / 2 - layout.drop.y - layout.drop.height / 2
    expect(dropTop).toBeGreaterThanOrEqual(0)
    expect(dropTop + layout.drop.height).toBeLessThanOrEqual(layout.height)
  })

  it('shrinks cards before overlapping wrapped chrome in a constrained portrait stage', () => {
    const headers = { far: 60, near: 130, hand: 40 }
    const controls = { far: 44, near: 44, hand: 44 }
    const layout = boardLayout(320, 420, headers, controls)
    expect(layout.height).toBe(420)
    expect(layout.cardHeight).toBeLessThan(104)
    expect(layout.rows.hand.controlsTop + controls.hand).toBeLessThanOrEqual(layout.height)
    for (const row of ['far', 'near', 'hand'] as const) {
      const placement = layout.rows[row]
      const cardTop = layout.height / 2 - placement.y - layout.cardHeight / 2
      expect(cardTop + 0.001).toBeGreaterThanOrEqual(placement.labelTop + headers[row])
      expect(cardTop + layout.cardHeight).toBeLessThanOrEqual(placement.controlsTop + 0.001)
    }
    expect(pointInRect({ x: 0, y: layout.rows.near.y }, layout.drop)).toBe(true)
    expect(pointInRect({ x: 0, y: layout.rows.hand.y }, layout.drop)).toBe(false)
  })

  it.each([[320, false], [844, true]])('compacts oversized chrome within a 300px stage at width %s', (width, compact) => {
    const headers = { far: 60, near: 130, hand: 40 }
    const controls = { far: 120, near: 120, hand: 120 }
    const layout = boardLayout(width, 300, headers, controls, compact)
    expect(Object.values(headers).reduce((sum, size) => sum + size, 0)
      + Object.values(controls).reduce((sum, size) => sum + size, 0)).toBeGreaterThan(layout.height)
    for (const row of ['far', 'near', 'hand'] as const) {
      const placement = layout.rows[row]
      expect(placement.labelTop).toBeGreaterThanOrEqual(0)
      expect(placement.labelTop + placement.labelHeight).toBeLessThanOrEqual(layout.height)
      expect(placement.controlsTop).toBeGreaterThanOrEqual(0)
      expect(placement.controlsTop + placement.controlsHeight).toBeLessThanOrEqual(layout.height)
    }
    expect(layout.rows.near.labelHeight).toBeGreaterThanOrEqual(52)
    expect(layout.rows.hand.controlsTop + layout.rows.hand.controlsHeight).toBeLessThanOrEqual(layout.height)
  })

  it('clamps pages when cards leave a row and handles empty/invalid input', () => {
    expect(pageWindow(5, 100, 3)).toMatchObject({ page: 1, start: 3, end: 5, pages: 2 })
    expect(pageWindow(0, 4, 3)).toMatchObject({ page: 0, pages: 1, end: 0 })
    expect(pageWindow(NaN, Infinity, 0)).toMatchObject({ page: 0, pages: 1, count: 0 })
    expect(boardLayout(NaN, 0).width).toBe(1)
  })

  it.each([[844, 390], [1024, 600], [1440, 700]])('uses separate readable landscape lanes at %sx%s', (width, height) => {
    expect(compactBoardViewport(width, height)).toBe(true)
    const headers = { far: 90, near: 160, hand: 28 }
    const controls = { far: 44, near: 44, hand: 44 }
    const layout = boardLayout(width, height, headers, controls, true)
    expect(layout.compact).toBe(true)
    expect(layout.height).toBe(height)
    expect(layout.cardHeight).toBeGreaterThan(0)
    const first = layout.width / 2 + cardSlotX(0, layout.capacity, layout) - layout.cardWidth / 2
    const last = layout.width / 2 + cardSlotX(layout.capacity - 1, layout.capacity, layout) + layout.cardWidth / 2
    expect(first).toBeGreaterThan(layout.columns.labelLeft + layout.columns.labelWidth)
    expect(last).toBeLessThan(layout.columns.controlsLeft)
    for (const row of ['far', 'near', 'hand'] as const) {
      const placement = layout.rows[row]
      expect(placement.labelTop).toBeGreaterThanOrEqual(0)
      expect(placement.labelTop + headers[row]).toBeLessThanOrEqual(layout.height)
      expect(placement.controlsTop + controls[row]).toBeLessThanOrEqual(layout.height)
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
    const controls = { far: 44, near: 44, hand: 44 }
    const layout = boardLayout(844, 300, headers, controls, true)
    expect(layout.height).toBe(300)
    expect(layout.rows.hand.controlsTop + controls.hand).toBeLessThanOrEqual(300)
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
    const controls = { far: 44, near: 44, hand: 44 }
    const layout = boardLayout(width, height, headers, controls, compactBoardViewport(width, height))
    for (const actor of [0, 1]) {
      for (const owner of [0, 1]) {
        const rect = pendingCardRect(layout, owner, actor)
        const row = owner === actor ? 'near' : 'far'
        const top = layout.height / 2 - rect.y - rect.height / 2
        const left = layout.width / 2 + rect.x - rect.width / 2
        expect(rect.width / rect.height).toBeCloseTo(layout.cardWidth / layout.cardHeight)
        if (layout.compact) {
          expect(rect.height + 10).toBeLessThanOrEqual(layout.rows[row].height)
        } else {
          expect(rect.height).toBeGreaterThanOrEqual(layout.cardHeight)
        }
        expect(rect.y).toBeGreaterThanOrEqual(layout.rows[row].y)
        expect(left).toBeGreaterThanOrEqual(layout.columns.cardsLeft)
        expect(left + rect.width + 8).toBeLessThanOrEqual(layout.columns.cardsLeft + layout.columns.cardsWidth)
        expect(top).toBeGreaterThanOrEqual(0)
        expect(top + rect.height + 10).toBeLessThanOrEqual(layout.height)
        if (!layout.compact) {
          expect(top).toBeGreaterThanOrEqual(layout.rows[row].labelTop + headers[row])
          expect(top + rect.height + 10).toBeLessThanOrEqual(layout.rows[row].controlsTop + 0.001)
        }
      }
    }
  })
})
