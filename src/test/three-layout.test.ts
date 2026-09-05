import { describe, expect, it } from 'vitest'
import { boardLayout, cardSlotX, clientToBoard, pageWindow, pointInRect } from '../renderers/three/layout'

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

  it('clamps pages when cards leave a row and handles empty/invalid input', () => {
    expect(pageWindow(5, 100, 3)).toMatchObject({ page: 1, start: 3, end: 5, pages: 2 })
    expect(pageWindow(0, 4, 3)).toMatchObject({ page: 0, pages: 1, end: 0 })
    expect(pageWindow(NaN, Infinity, 0)).toMatchObject({ page: 0, pages: 1, count: 0 })
    expect(boardLayout(NaN, 0).width).toBe(1)
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
})
