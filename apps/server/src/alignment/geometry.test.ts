import { describe, expect, it } from 'vitest'
import { createAlignmentBaseline, measureAlignment, type AlignmentSample } from './geometry.js'

const radians = Math.PI / 180

const latitude = 40 * radians

// Independent horizon-coordinate construction: tilt in the meridian, then turn
// north/east components about the zenith. No renderer or production math imports.
function sample(altitude: number, azimuth: number, joint: number, sidereal: number, declination = 60): AlignmentSample {
  const dec = declination * radians
  const a = altitude / 3600 * radians
  const z = azimuth / 3600 * radians
  const x = Math.cos(dec) * Math.cos(joint * radians)
  const y = Math.cos(dec) * Math.sin(joint * radians)
  const v = Math.sin(dec)
  const tiltedX = x * Math.cos(a) + v * Math.sin(a)
  const tiltedZ = v * Math.cos(a) - x * Math.sin(a)
  const north = -tiltedX * Math.sin(latitude) + tiltedZ * Math.cos(latitude)
  const up = tiltedX * Math.cos(latitude) + tiltedZ * Math.sin(latitude)
  const turnedNorth = north * Math.cos(z) - y * Math.sin(z)
  const turnedEast = north * Math.sin(z) + y * Math.cos(z)
  const localX = up * Math.cos(latitude) - turnedNorth * Math.sin(latitude)
  const localZ = up * Math.sin(latitude) + turnedNorth * Math.cos(latitude)

  return { raDegrees: (Math.atan2(turnedEast, localX) / radians + sidereal + 720) % 360,
    decDegrees: Math.atan2(localZ, Math.hypot(localX, turnedEast)) / radians,
    capturedAt: new Date(1_700_000_000_000 + sidereal * 1000).toISOString(), siderealTimeDegrees: sidereal }
}

function baseline(altitude: number, azimuth: number) {
  return createAlignmentBaseline([sample(altitude, azimuth, 10, 359), sample(altitude, azimuth, 30, 359.1),
    sample(altitude, azimuth, 50, 359.2)], 40)
}

function check(actual: { altitudeArcsec: number, azimuthArcsec: number, totalArcsec: number }, altitude: number, azimuth: number) {
  expect(actual.altitudeArcsec).toBeCloseTo(altitude, 5)
  expect(actual.azimuthArcsec).toBeCloseTo(azimuth, 5)
  const alt = latitude + altitude / 3600 * radians
  const north = Math.cos(alt) * Math.cos(azimuth / 3600 * radians)
  const east = Math.cos(alt) * Math.sin(azimuth / 3600 * radians)
  const up = Math.sin(alt)

  const expected = Math.atan2(Math.hypot(up * Math.cos(latitude) - north * Math.sin(latitude), east),
    up * Math.sin(latitude) + north * Math.cos(latitude)) / radians * 3600

  expect(actual.totalArcsec).toBeCloseTo(expected, 5)
}

describe('polar measurement from solved directions', () => {
  it('recovers signed physical offsets after local sidereal rotation', () => {
    for (const [altitude, azimuth] of [[480, -360], [-240, 180], [12, -9], [0, 0]]) {
      check(baseline(altitude!, azimuth!).measurement, altitude!, azimuth!)
    }
  })
  it('updates one frame while tracking across sidereal wrap without accumulating old error', () => {
    const reference = baseline(480, -360)

    for (const [altitude, azimuth] of [[240, -180], [12, -9], [0, 0]]) {
      // LST advanced 3 degrees; sidereal tracking moved the mount joint -3.
      check(measureAlignment(reference, sample(altitude!, azimuth!, 47, 2.2), true), altitude!, azimuth!)
    }

    check(measureAlignment(reference, sample(480, -360, 35, 14.2), true), 480, -360)
  })
  it.each([60, 80])('recovers large offsets and corrections beyond five degrees at Dec %s', declination => {
    for (const [altitudeDegrees, azimuthDegrees] of [[6, -8], [-10, 15]]) {
      const altitude = altitudeDegrees! * 3600
      const azimuth = azimuthDegrees! * 3600

      const reference = createAlignmentBaseline([
        sample(altitude, azimuth, -130, 359, declination),
        sample(altitude, azimuth, -76, 359.1, declination),
        sample(altitude, azimuth, -22, 359.2, declination),
      ], 40)

      check(reference.measurement, altitude, azimuth)
      check(measureAlignment(reference, sample(altitude / 2, azimuth / 2, -25, 2.2, declination), true), altitude / 2, azimuth / 2)
      check(measureAlignment(reference, sample(0, 0, -25, 2.2, declination), true), 0, 0)
    }
  })
  it('recovers twenty-degree corrections for the physical starting declination', () => {
    const reference = createAlignmentBaseline([
      sample(72000, -72000, -130, 359, 80),
      sample(72000, -72000, -76, 359.1, 80),
      sample(72000, -72000, -22, 359.2, 80),
    ], 40)

    check(reference.measurement, 72000, -72000)
    check(measureAlignment(reference, sample(36000, -36000, -25, 2.2, 80), true), 36000, -36000)
    check(measureAlignment(reference, sample(0, 0, -25, 2.2, 80), true), 0, 0)
  })
  it('rejects a numerical jump to the second altitude solution instead of reporting a false correction', () => {
    const reference = createAlignmentBaseline([
      sample(72000, -72000, -130, 359),
      sample(72000, -72000, -76, 359.1),
      sample(72000, -72000, -22, 359.2),
    ], 40)

    // This sightline fits both zero altitude error and an alternative ~44.76° root.
    // Undamped iteration crosses the elevation fold and would publish the latter.
    expect(() => measureAlignment(reference, sample(0, 0, -25, 2.2), true)).toThrow(/ambiguous sightline geometry/)
  })
  it('supports fixed joints separately from tracking', () => {
    check(measureAlignment(baseline(480, -360), sample(-100, 150, 50, 2.2), false), -100, 150)
  })
  it('rejects coincident baselines and malformed measurements instead of reporting an aligned pole', () => {
    const point = sample(0, 0, 10, 1)
    expect(() => createAlignmentBaseline([point, point, point], 40)).toThrow(/baseline/)
    expect(() => measureAlignment(baseline(480, -360), { ...point, raDegrees: NaN }, true)).toThrow(/sample/)
  })
})
