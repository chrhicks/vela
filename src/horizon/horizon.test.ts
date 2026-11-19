import { describe, expect, it } from 'vitest'
import { altitudeAt, noHorizon, type Horizon } from './horizon.ts'

const with_ = (known: Record<number, number>): Horizon => ({
  ...noHorizon,
  altitudesDegrees: noHorizon.altitudesDegrees.map((_, bin) => known[bin] ?? null),
})

describe('altitudeAt', () => {
  it('is the bin value on a whole degree', () => {
    expect(altitudeAt(with_({ 90: 12, 91: 14 }), 90)).toBe(12)
  })

  it('interpolates between adjacent known bins', () => {
    expect(altitudeAt(with_({ 90: 12, 91: 14 }), 90.25)).toBeCloseTo(12.5, 10)
    expect(altitudeAt(with_({ 90: 14, 91: 10 }), 90.5)).toBeCloseTo(12, 10)
  })

  it('is unknown when either neighbour is unknown', () => {
    const horizon = with_({ 90: 12, 92: 14 })

    expect(altitudeAt(horizon, 90.5)).toBeNull()
    expect(altitudeAt(horizon, 91.5)).toBeNull()
    expect(altitudeAt(horizon, 91)).toBeNull()
  })

  it('wraps at 360, between the last bin and the first', () => {
    const horizon = with_({ 359: 10, 0: 20, 1: 30 })

    expect(altitudeAt(horizon, 359.5)).toBeCloseTo(15, 10)
    expect(altitudeAt(horizon, 360)).toBe(20)
    expect(altitudeAt(horizon, 720.5)).toBeCloseTo(25, 10)
    expect(altitudeAt(horizon, -0.5)).toBeCloseTo(15, 10)
  })

  it('is unknown everywhere with no horizon, and for an azimuth that is not a number', () => {
    expect(altitudeAt(noHorizon, 0)).toBeNull()
    expect(altitudeAt(noHorizon, 200.5)).toBeNull()
    expect(altitudeAt(with_({ 0: 1, 1: 2 }), Number.NaN)).toBeNull()
  })
})
