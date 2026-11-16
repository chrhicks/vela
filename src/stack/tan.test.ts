import { describe, expect, it } from 'vitest'
import type { PlateSolution } from '../frames/stats.ts'
import { toPixel, toSky } from './tan.ts'

const m33: PlateSolution = {
  centre: { raDegrees: 23.45928974921922, decDegrees: 30.648188779510235 },
  referencePixel: [3124.5, 2088.5],
  matrix: [
    [1.7864279971656184e-4, 5.0522612662452055e-4],
    [-5.0512286386245552e-4, 1.7836531801028712e-4],
  ],
}

const arcsec = 1 / 3600

describe('a plate solution between pixels and sky', () => {
  it('puts pixels on the sky where astropy puts them for the same solution', () => {
    const corners = [
      [{ x: 3124.5, y: 2088.5 }, 23.45928974921922, 30.648188779510235],
      [{ x: 1, y: 1 }, 21.561830074538417, 31.839339592482673],
      [{ x: 6248, y: 4176 }, 25.310057367612515, 29.43015665733217],
      [{ x: 100, y: 4000 }, 23.963532733564577, 32.51521027068009],
    ] as const

    for (const [pixel, ra, dec] of corners) {
      const sky = toSky(m33, pixel)

      expect(Math.abs(sky.raDegrees - ra)).toBeLessThan(0.01 * arcsec)
      expect(Math.abs(sky.decDegrees - dec)).toBeLessThan(0.01 * arcsec)
    }
  })

  it('finds the pixel of a sky position, and back again', () => {
    const pixel = toPixel(m33, { raDegrees: 23, decDegrees: 30 })

    expect(pixel?.x).toBeCloseTo(4016.777644728354, 4)
    expect(pixel?.y).toBeCloseTo(985.6546499884782, 4)

    const again = toPixel(m33, toSky(m33, { x: 17.25, y: 3999.5 }))

    expect(again?.x).toBeCloseTo(17.25, 6)
    expect(again?.y).toBeCloseTo(3999.5, 6)
  })

  it('has no pixel for the far side of the sky', () => {
    expect(toPixel(m33, { raDegrees: 203.46, decDegrees: -30.65 })).toBeUndefined()
  })
})
