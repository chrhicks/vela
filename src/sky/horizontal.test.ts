import { Horizon, Observer, SiderealTime } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'
import { horizonOf } from '../align/polar.ts'
import { fromMount } from './coordinates.ts'
import { equatorialOfDate } from './horizontal.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const observer = new Observer(phoenix.latitudeDegrees, phoenix.longitudeDegrees, phoenix.elevationMeters)
const times = [Date.UTC(2026, 10, 9, 4, 0, 0), Date.UTC(2026, 10, 9, 9, 17, 31), Date.UTC(2026, 5, 21, 17, 45, 12), Date.UTC(2027, 0, 3, 23, 59, 59)]
const azimuths = [0, 0.001, 1, 45, 90, 135, 180, 225, 270, 314.9, 359, 359.999, 360]
const altitudes = [2, 5, 10, 15, 23, 30, 45, 55, 70, 80]
const degrees = 180 / Math.PI

const separation = (a: readonly [number, number, number], b: readonly [number, number, number]) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * degrees

const altitudeError = (altitude: number, azimuth: number, at: number) => {
  const { raHours, decDegrees } = equatorialOfDate(altitude, azimuth, at, phoenix)
  const back = Horizon(new Date(at), observer, raHours, decDegrees, undefined)
  const azimuthDifference = Math.abs((((back.azimuth - azimuth) % 360) + 540) % 360 - 180)

  return { altitude: Math.abs(back.altitude - altitude), azimuth: azimuthDifference * Math.cos((altitude / degrees)) }
}

describe('equatorial coordinates of date from altitude and azimuth', () => {
  it('goes back to the same altitude and azimuth through astronomy-engine, for azimuths round the compass and altitudes from 2 to 80 degrees', () => {
    for (const at of times)
      for (const azimuth of azimuths)
        for (const altitude of altitudes) {
          const error = altitudeError(altitude, azimuth, at)

          expect(error.altitude).toBeLessThan(1e-6)
          expect(error.azimuth).toBeLessThan(1e-6)
        }
  })

  it('keeps right ascension in hours from 0 up to 24 and declination within the poles', () => {
    for (const at of times)
      for (const azimuth of azimuths)
        for (const altitude of altitudes) {
          const { raHours, decDegrees } = equatorialOfDate(altitude, azimuth, at, phoenix)

          expect(raHours).toBeGreaterThanOrEqual(0)
          expect(raHours).toBeLessThan(24)
          expect(Math.abs(decDegrees)).toBeLessThanOrEqual(90)
        }
  })

  it('puts a point due north below the pole at the declination the latitude gives, on the meridian under the pole', () => {
    for (const at of times) {
      const { raHours, decDegrees } = equatorialOfDate(10, 0, at, phoenix)
      const hourAngle = (((SiderealTime(new Date(at)) * 15 + phoenix.longitudeDegrees - raHours * 15 + 180) % 360) + 360) % 360 - 180

      expect(decDegrees).toBeCloseTo(90 - (phoenix.latitudeDegrees - 10), 3)
      expect(Math.abs(hourAngle)).toBeGreaterThan(179.99)
    }
  })

  it('puts a point due north above the pole on the meridian above it', () => {
    const at = times[0]!
    const { raHours, decDegrees } = equatorialOfDate(50, 0, at, phoenix)
    const hourAngle = (((SiderealTime(new Date(at)) * 15 + phoenix.longitudeDegrees - raHours * 15 + 180) % 360) + 360) % 360 - 180

    expect(decDegrees).toBeCloseTo(90 - (50 - phoenix.latitudeDegrees), 3)
    expect(Math.abs(hourAngle)).toBeLessThan(0.01)
  })

  it('puts the zenith at the latitude, and due south on the horizon at the colatitude below the equator', () => {
    const at = times[1]!

    expect(equatorialOfDate(90, 0, at, phoenix).decDegrees).toBeCloseTo(phoenix.latitudeDegrees, 6)
    expect(equatorialOfDate(0, 180, at, phoenix).decDegrees).toBeCloseTo(phoenix.latitudeDegrees - 90, 6)
  })

  it('agrees with the horizon direction polar alignment makes from a solve at the same place', () => {
    for (const at of times)
      for (const azimuth of [0.5, 90, 200, 359.5])
        for (const altitude of [2, 25, 80]) {
          const ofDate = equatorialOfDate(altitude, azimuth, at, phoenix)
          const j2000 = fromMount({ raDegrees: ofDate.raHours * 15, decDegrees: ofDate.decDegrees }, new Date(at))
          const direction = horizonOf({ raDegrees: j2000.raDegrees, decDegrees: j2000.decDegrees, at }, phoenix)
          const wanted = [Math.cos(altitude / degrees) * Math.cos(azimuth / degrees), -Math.cos(altitude / degrees) * Math.sin(azimuth / degrees), Math.sin(altitude / degrees)] as const

          expect(separation(direction, wanted)).toBeLessThan(1e-4)
        }
  })

  it('is geometric: no refraction is applied', () => {
    const at = times[0]!
    const { raHours, decDegrees } = equatorialOfDate(2, 90, at, phoenix)

    expect(Horizon(new Date(at), observer, raHours, decDegrees, undefined).altitude).toBeCloseTo(2, 6)
    expect(Horizon(new Date(at), observer, raHours, decDegrees, 'normal').altitude).toBeGreaterThan(2.2)
  })
})
