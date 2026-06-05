import { describe, expect, it } from 'vitest'

import {
  capTail,
  filterValid,
  isFiniteInteger,
  isFiniteNumber,
  isIntegerInRange,
  isNonNegativeInteger,
  isRecordObject,
} from '../app/validators'

describe('validators', () => {
  describe('isFiniteNumber', () => {
    it.each([
      ['Infinity', Infinity],
      ['-Infinity', -Infinity],
      ['NaN', Number.NaN],
      ['string', '3'],
      ['array', [1]],
      ['null', null],
      ['object', { value: 1 }],
    ])('rejects %s', (_label, value) => {
      expect(isFiniteNumber(value)).toBe(false)
    })

    it('accepts finite numbers including zero and negatives', () => {
      expect(isFiniteNumber(0)).toBe(true)
      expect(isFiniteNumber(-1.5)).toBe(true)
      expect(isFiniteNumber(1e10)).toBe(true)
    })
    it('rejects NaN, Infinity, strings, null, undefined', () => {
      expect(isFiniteNumber(Number.NaN)).toBe(false)
      expect(isFiniteNumber(Infinity)).toBe(false)
      expect(isFiniteNumber(-Infinity)).toBe(false)
      expect(isFiniteNumber('3')).toBe(false)
      expect(isFiniteNumber(null)).toBe(false)
      expect(isFiniteNumber(undefined)).toBe(false)
    })
  })

  describe('isFiniteInteger', () => {
    it.each([
      ['Infinity', Infinity],
      ['-Infinity', -Infinity],
      ['NaN', Number.NaN],
      ['fraction', 1.5],
      ['string', '3'],
      ['array', [1]],
      ['null', null],
      ['object', { value: 1 }],
    ])('rejects %s', (_label, value) => {
      expect(isFiniteInteger(value)).toBe(false)
    })

    it('rejects fractions', () => {
      expect(isFiniteInteger(1.5)).toBe(false)
    })
    it('accepts integers including zero and negatives', () => {
      expect(isFiniteInteger(0)).toBe(true)
      expect(isFiniteInteger(-3)).toBe(true)
      expect(isFiniteInteger(42)).toBe(true)
    })
  })

  describe('isNonNegativeInteger', () => {
    it.each([
      ['Infinity', Infinity],
      ['-Infinity', -Infinity],
      ['NaN', Number.NaN],
      ['negative', -1],
      ['fraction', 1.5],
      ['string', '3'],
      ['array', [1]],
      ['null', null],
      ['object', { value: 1 }],
    ])('rejects %s', (_label, value) => {
      expect(isNonNegativeInteger(value)).toBe(false)
    })

    it('accepts zero and positive integers', () => {
      expect(isNonNegativeInteger(0)).toBe(true)
      expect(isNonNegativeInteger(7)).toBe(true)
    })
    it('rejects negatives and fractions', () => {
      expect(isNonNegativeInteger(-1)).toBe(false)
      expect(isNonNegativeInteger(1.5)).toBe(false)
    })
  })

  describe('isIntegerInRange', () => {
    it.each([
      ['Infinity', Infinity],
      ['-Infinity', -Infinity],
      ['NaN', Number.NaN],
      ['below range', -1],
      ['fraction', 1.5],
      ['string', '3'],
      ['array', [1]],
      ['null', null],
      ['object', { value: 1 }],
    ])('rejects %s', (_label, value) => {
      expect(isIntegerInRange(value, 0, 5)).toBe(false)
    })

    it('respects inclusive bounds', () => {
      expect(isIntegerInRange(1, 1, 7)).toBe(true)
      expect(isIntegerInRange(7, 1, 7)).toBe(true)
      expect(isIntegerInRange(0, 1, 7)).toBe(false)
      expect(isIntegerInRange(8, 1, 7)).toBe(false)
    })
  })

  describe('isRecordObject', () => {
    it.each([
      ['Infinity', Infinity],
      ['-Infinity', -Infinity],
      ['NaN', Number.NaN],
      ['negative', -1],
      ['fraction', 1.5],
      ['string', '3'],
      ['array', [1]],
      ['null', null],
    ])('rejects %s', (_label, value) => {
      expect(isRecordObject(value)).toBe(false)
    })

    it('accepts plain objects', () => {
      expect(isRecordObject({})).toBe(true)
      expect(isRecordObject({ a: 1 })).toBe(true)
    })
    it('rejects arrays and null', () => {
      expect(isRecordObject([])).toBe(false)
      expect(isRecordObject(null)).toBe(false)
      expect(isRecordObject('foo')).toBe(false)
    })
  })

  describe('capTail', () => {
    it('returns input when shorter than cap', () => {
      expect(capTail([1, 2, 3], 5)).toEqual([1, 2, 3])
    })
    it('keeps the most recent entries (tail)', () => {
      expect(capTail([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5])
    })
    it('keeps the exact tail at the cap boundary', () => {
      const input = Array.from({ length: 12 }, (_value, index) => index)
      expect(capTail(input, 5)).toEqual([7, 8, 9, 10, 11])
      expect(capTail(input, 12)).toEqual(input)
    })
    it('returns empty array for max <= 0', () => {
      expect(capTail([1, 2, 3], 0)).toEqual([])
      expect(capTail([1, 2, 3], -1)).toEqual([])
    })
    it('returns a fresh array (does not alias)', () => {
      const input = [1, 2, 3]
      const out = capTail(input, 5)
      expect(out).not.toBe(input)
      expect(out).toEqual(input)
    })
  })

  describe('filterValid', () => {
    const isNumber = (v: unknown): v is number => typeof v === 'number'

    it('returns empty for non-arrays', () => {
      expect(filterValid('foo', isNumber)).toEqual([])
      expect(filterValid(null, isNumber)).toEqual([])
    })
    it('drops invalid entries while keeping valid ones in order', () => {
      expect(filterValid([1, 'x', 2, null, 3], isNumber)).toEqual([1, 2, 3])
    })
    it('applies max as a tail cap before filtering', () => {
      // 5 entries, cap to last 3 then filter → [3, 4, 5] all numbers
      expect(filterValid([1, 2, 3, 4, 5], isNumber, { max: 3 })).toEqual([3, 4, 5])
    })
    it('drops invalid entries only after applying the tail cap', () => {
      expect(filterValid([1, 2, 3, 4, 'drop-me'], isNumber, { max: 3 })).toEqual([3, 4])
    })
  })
})
