import { Horizon, Observer, SiderealTime } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'
import { skyPointOf } from './pointing.js'
import type { MountReading } from './rules.js'

const reading = (fields: Partial<MountReading>): MountReading => ({
  tracking: true,
  slewing: false,
  parked: false,
  rightAscensionHours: 5,
  declinationDegrees: -20,
  siderealTimeHours: 5,
  latitudeDegrees: 40,
  pierSide: 'west',
  ...fields,
})

describe('where a mount points', () => {
  it('puts the meridian due south at colatitude minus declination', () => {
    const point = skyPointOf(reading({}))!

    expect(point.altitudeDegrees).toBeCloseTo(30, 9)
    expect(point.azimuthDegrees).toBeCloseTo(180, 9)
  })

  it('puts a star west of the meridian in the west and east of it in the east', () => {
    const west = skyPointOf(reading({ siderealTimeHours: 7 }))!
    const east = skyPointOf(reading({ siderealTimeHours: 3 }))!

    expect(west.azimuthDegrees).toBeGreaterThan(180)
    expect(east.azimuthDegrees).toBeLessThan(180)
    expect(west.altitudeDegrees).toBeCloseTo(east.altitudeDegrees, 9)
    expect(west.azimuthDegrees + east.azimuthDegrees).toBeCloseTo(360, 9)
  })

  it('puts the celestial pole at the latitude, due north', () => {
    const pole = skyPointOf(reading({ declinationDegrees: 90 }))!

    expect(pole.altitudeDegrees).toBeCloseTo(40, 9)
    expect(Math.min(pole.azimuthDegrees, 360 - pole.azimuthDegrees)).toBeCloseTo(0, 6)
  })

  it('agrees with an independent horizontal conversion over a spread of positions', () => {
    const site = { latitude: 40, longitude: -75 }
    const observer = new Observer(site.latitude, site.longitude, 0)

    for (const [iso, ra, dec] of [
      ['2026-09-07T04:00:00Z', 1.2, 41.3],
      ['2026-09-07T04:00:00Z', 18.6, -22],
      ['2026-12-01T09:30:00Z', 6.1, 7.5],
      ['2026-12-01T09:30:00Z', 23.9, 70],
      ['2026-03-20T22:10:00Z', 12, -5],
    ] as const) {
      const date = new Date(iso)
      const lst = (((SiderealTime(date) + site.longitude / 15) % 24) + 24) % 24
      const expected = Horizon(date, observer, ra, dec)

      const point = skyPointOf(
        reading({ rightAscensionHours: ra, declinationDegrees: dec, siderealTimeHours: lst, latitudeDegrees: site.latitude }),
      )!

      expect(point.altitudeDegrees).toBeCloseTo(expected.altitude, 6)
      expect(point.azimuthDegrees).toBeCloseTo(expected.azimuth, 6)
    }
  })

  it('has no point unless the reading carries all four values', () => {
    for (const missing of ['rightAscensionHours', 'declinationDegrees', 'siderealTimeHours', 'latitudeDegrees'] as const)
      expect(skyPointOf(reading({ [missing]: null }))).toBeNull()
  })
})
