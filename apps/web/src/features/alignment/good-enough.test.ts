import { describe, expect, it } from 'vitest'
import { GOOD_ENOUGH_ARCSEC, goodEnoughDrift } from './good-enough'

describe('goodEnoughDrift', () => {
  it('turns 2 arcminutes into about 1.6 arcseconds over 3 minutes', () => {
    expect(goodEnoughDrift(120 - 0.001)).toBeCloseTo(1.5708, 3)
  })

  it('scales with the actual total, not a fixed figure', () => {
    expect(goodEnoughDrift(60)).toBeCloseTo(0.7854, 3)
    expect(goodEnoughDrift(0)).toBe(0)
  })

  it('is not good enough at exactly the threshold or above it', () => {
    expect(GOOD_ENOUGH_ARCSEC).toBe(120)
    expect(goodEnoughDrift(GOOD_ENOUGH_ARCSEC)).toBeNull()
    expect(goodEnoughDrift(GOOD_ENOUGH_ARCSEC + 1)).toBeNull()
    expect(goodEnoughDrift(600)).toBeNull()
  })
})
