import { describe, expect, it } from 'vitest'
import { offsetOf, pointingOf } from './pointing.ts'

const commanded = { altitudeDegrees: 20, azimuthDegrees: 100 }

describe('the offset of a solve from the commanded position', () => {
  it('is the solve minus the commanded altitude and azimuth', () => {
    const offset = offsetOf({ altitudeDegrees: 20.4, azimuthDegrees: 99.7 }, commanded)

    expect(offset.altitudeDegrees).toBeCloseTo(0.4, 9)
    expect(offset.azimuthDegrees).toBeCloseTo(-0.3, 9)
  })

  it('takes the short way round north', () => {
    expect(offsetOf({ altitudeDegrees: 20, azimuthDegrees: 359.8 }, { altitudeDegrees: 20, azimuthDegrees: 0.3 }).azimuthDegrees).toBeCloseTo(-0.5, 9)
  })
})

describe('the pointing of a frame', () => {
  it('is the solve, source solve, when it solved', () => {
    expect(pointingOf({ solved: { altitudeDegrees: 20.4, azimuthDegrees: 99.7 }, commanded, pierSide: 'PIER_WEST' }, [])).toEqual({ altitudeDegrees: 20.4, azimuthDegrees: 99.7, source: 'solve' })
  })

  it('is the commanded position, source commanded, when it did not solve and no frame has', () => {
    expect(pointingOf({ solved: undefined, commanded, pierSide: 'PIER_WEST' }, [])).toEqual({ ...commanded, source: 'commanded' })
  })

  it('adds the offset of the most recent solved frame on the same pier side, source commanded+offset', () => {
    const known = [
      { pierSide: 'PIER_WEST' as const, offset: { altitudeDegrees: 0.1, azimuthDegrees: 0.1 } },
      { pierSide: 'PIER_EAST' as const, offset: { altitudeDegrees: 9, azimuthDegrees: 9 } },
      { pierSide: 'PIER_WEST' as const, offset: { altitudeDegrees: 0.3, azimuthDegrees: -0.2 } },
    ]
    const found = pointingOf({ solved: undefined, commanded, pierSide: 'PIER_WEST' }, known)

    expect(found.source).toBe('commanded+offset')
    expect(found.altitudeDegrees).toBeCloseTo(20.3, 9)
    expect(found.azimuthDegrees).toBeCloseTo(99.8, 9)
  })

  it('does not borrow the offset of the other pier side', () => {
    expect(pointingOf({ solved: undefined, commanded, pierSide: 'PIER_EAST' }, [{ pierSide: 'PIER_WEST', offset: { altitudeDegrees: 1, azimuthDegrees: 1 } }])).toEqual({ ...commanded, source: 'commanded' })
  })

  it('wraps the azimuth past north', () => {
    expect(pointingOf({ solved: undefined, commanded: { altitudeDegrees: 10, azimuthDegrees: 359.9 }, pierSide: undefined }, [{ pierSide: undefined, offset: { altitudeDegrees: 0, azimuthDegrees: 0.3 } }]).azimuthDegrees).toBeCloseTo(0.2, 9)
  })
})
