import { describe, expect, it } from 'vitest'
import { median, steadiness } from './steadiness.ts'

describe('steadiness', () => {
  it('is zero for a constant count', () => {
    expect(steadiness([100, 100, 100, 100])).toEqual({ pairs: 3, jumps: 0, spread: 0 })
  })

  it('counts a doubling and the halving back as two jumps', () => {
    const { pairs, jumps, spread } = steadiness([100, 100, 100, 200, 100])

    expect(pairs).toBe(4)
    expect(jumps).toBe(2)
    expect(spread).toBeCloseTo((1.4826 * Math.LN2) / 2)
  })

  it('counts a change above 1.5x and not one below it', () => {
    expect(steadiness([100, 140, 100]).jumps).toBe(0)
    expect(steadiness([100, 160]).jumps).toBe(1)
    expect(steadiness([160, 100]).jumps).toBe(1)
  })

  it('reads a count of zero as one star, so an empty frame is a jump but not infinite', () => {
    expect(steadiness([0, 0, 10])).toMatchObject({ pairs: 2, jumps: 1 })
  })

  it('has no spread without a pair of frames', () => {
    expect(steadiness([100])).toEqual({ pairs: 0, jumps: 0, spread: null })
  })
})

describe('median', () => {
  it('averages the middle two of an even list and leaves its input alone', () => {
    const values = [4, 1, 3, 2]

    expect(median(values)).toBe(2.5)
    expect(values).toEqual([4, 1, 3, 2])
  })
})
