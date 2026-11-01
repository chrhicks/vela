import { describe, expect, it } from 'vitest'
import { tangentOffsetArcmin } from '@vela/rig-sky'

const arcminutes = (degrees: number) => degrees * 60

describe('tangentOffsetArcmin', () => {
  it('is zero where the two positions agree', () => {
    expect(tangentOffsetArcmin({ raDegrees: 123.4, decDegrees: -33.3 }, { raDegrees: 123.4, decDegrees: -33.3 })).toEqual({ east: 0, north: 0, total: 0 })
  })

  it('puts a sky position due north of the mount on the north axis', () => {
    const offset = tangentOffsetArcmin({ raDegrees: 80, decDegrees: 40 }, { raDegrees: 80, decDegrees: 40.5 })

    expect(offset?.east).toBeCloseTo(0, 9)
    expect(offset?.north).toBeCloseTo(arcminutes(Math.tan((0.5 * Math.PI) / 180) * (180 / Math.PI)), 9)
    expect(offset?.total).toBeCloseTo(offset?.north ?? 0, 9)
  })

  it('puts a sky position due east on the east axis, scaled by cos(dec)', () => {
    const atEquator = tangentOffsetArcmin({ raDegrees: 10, decDegrees: 0 }, { raDegrees: 10.5, decDegrees: 0 })
    const atSixty = tangentOffsetArcmin({ raDegrees: 10, decDegrees: 60 }, { raDegrees: 10.01, decDegrees: 60 })

    expect(atEquator?.east).toBeCloseTo(arcminutes(Math.tan((0.5 * Math.PI) / 180) * (180 / Math.PI)), 9)
    expect(atEquator?.north).toBeCloseTo(0, 9)
    expect(atSixty?.east).toBeCloseTo(0.01 * 60 * 0.5, 4)
  })

  it('takes the short way across the RA wrap', () => {
    const offset = tangentOffsetArcmin({ raDegrees: 359.99, decDegrees: 0 }, { raDegrees: 0.01, decDegrees: 0 })

    expect(offset?.east).toBeCloseTo(1.2, 3)
  })

  it('gives the sign of each axis: east and north are positive', () => {
    const offset = tangentOffsetArcmin({ raDegrees: 100, decDegrees: 20 }, { raDegrees: 100.1, decDegrees: 19.95 })

    expect(offset?.east).toBeGreaterThan(0)
    expect(offset?.north).toBeLessThan(0)
  })

  it('stays finite beside the pole', () => {
    const offset = tangentOffsetArcmin({ raDegrees: 0, decDegrees: 89.9 }, { raDegrees: 90, decDegrees: 89.9 })

    expect(Number.isFinite(offset?.total)).toBe(true)
    expect(offset?.total).toBeGreaterThan(0)
  })

  it('has no answer for positions 90 degrees apart or more', () => {
    expect(tangentOffsetArcmin({ raDegrees: 0, decDegrees: 0 }, { raDegrees: 90, decDegrees: 0 })).toBeNull()
    expect(tangentOffsetArcmin({ raDegrees: 0, decDegrees: 0 }, { raDegrees: 180, decDegrees: 0 })).toBeNull()
  })
})
