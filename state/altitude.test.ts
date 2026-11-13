import { describe, expect, it } from 'vitest'
import { altitudeDegrees } from './altitude.ts'
import { greenwichSiderealHours } from './flip.ts'
import { fold, wire } from './testing.ts'
import { readings } from './readings.ts'

const phoenix = { LAT: 33.45, LONG: 360 - 112.07, ELEV: 331 }
const at = Date.UTC(2026, 10, 8, 4)
const localSidereal = greenwichSiderealHours(at) + phoenix.LONG / 15

const pointing = (ra: number, dec: number) => fold(readings, {}, [wire('mount', 'GEOGRAPHIC_COORD', phoenix), wire('mount', 'EQUATORIAL_EOD_COORD', { RA: ra, DEC: dec })])

describe('altitudeDegrees', () => {
  it('is the latitude at the pole and the co-latitude plus the declination on the meridian', () => {
    expect(altitudeDegrees(pointing(3, 90), at)).toBeCloseTo(33.45)
    expect(altitudeDegrees(pointing(localSidereal % 24, 20), at)).toBeCloseTo(90 - 33.45 + 20)
  })

  it('is unknown without the site, the pointing or the time', () => {
    expect(altitudeDegrees(fold(readings, {}, [wire('mount', 'EQUATORIAL_EOD_COORD', { RA: 1, DEC: 2 })]), at)).toBeUndefined()
    expect(altitudeDegrees(pointing(1, 2), undefined)).toBeUndefined()
  })
})
