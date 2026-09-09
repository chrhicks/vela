import { describe, expect, it } from 'vitest'
import { projectSky, type PlateWcs } from '../plate-solving/solver.js'
import { angularDistance, fromMount, plateCorners, skyAtPixel, skyPath, toMount } from './sky.js'

// Deliberately synthetic geographic site; this is not observatory configuration.
const site = { latitudeDegrees: 40, longitudeDegrees: -75, elevationMeters: 0 }
const date = new Date('2026-09-07T04:00:00Z')

// Independent reference: ERFA 2.0.1.5 atco13, derived from IAU SOFA.
// https://github.com/liberfa/erfa/blob/master/src/atco13.c
// UTC above; site above; proper motion/parallax/radial velocity, DUT1,
// polar motion and pressure all zero; temperature 10 C, humidity 0, wavelength .55 um.
// Observed equinox-based RA = rob - eo, altitude = 90 - zob (degrees).
// https://github.com/liberfa/erfa/blob/master/src/atci13.c documents RA = RI - EO.
// Fixtures need no Python/ERFA dependency at test runtime. 0.5 arcsec tolerance
// allows Astronomy Engine's shorter nutation model, omitted light deflection,
// ICRS frame bias and first-order aberration, while detecting absent aberration.
const benchmarks = [
  { catalog: { raDegrees: 359.99, decDegrees: 82 }, apparent: { raDegrees: 0.35785842911299515, decDegrees: 82.14840755360858 }, altitude: 46.73537485217423 },
  { catalog: { raDegrees: 10.68470833, decDegrees: 41.26875 }, apparent: { raDegrees: 11.058091306851674, decDegrees: 41.41611865040379 }, altitude: 60.06028088597603 },
  { catalog: { raDegrees: 0.01, decDegrees: -80 }, apparent: { raDegrees: 0.3931427977204232, decDegrees: -79.848558666562 }, altitude: -30.983898663858042 },
  { catalog: { raDegrees: 279.23473479, decDegrees: 38.78368896 }, apparent: { raDegrees: 279.4629823829434, decDegrees: 38.81040994135053 }, altitude: 50.541090008198246 },
]

describe('target sky coordinates', () => {
  it.each(benchmarks)('matches independent apparent-place and altitude reference at $catalog', ({ catalog, apparent, altitude }) => {
    expect(angularDistance(toMount(catalog, 'topocentric', date, site), apparent) * 3600).toBeLessThan(0.5)
    expect(angularDistance(fromMount(apparent, 'topocentric', date, site), catalog) * 3600).toBeLessThan(0.5)
    expect(Math.abs(skyPath(catalog, site, date).currentAltitudeDegrees - altitude) * 3600).toBeLessThan(0.5)
  })

  it.each([{ raDegrees: 359.99, decDegrees: 89.99 }, { raDegrees: 0.01, decDegrees: -89.99 }, { raDegrees: 280, decDegrees: 20 }])('round trips across RA wrap and near celestial poles: %j', catalog => {
    const mount = toMount(catalog, 'topocentric', date, site)
    expect(mount.raDegrees).toBeGreaterThanOrEqual(0)
    expect(mount.raDegrees).toBeLessThan(360)
    expect(angularDistance(fromMount(mount, 'topocentric', date, site), catalog) * 3600).toBeLessThan(0.01)
  })

  it('preserves J2000 coordinates and rejects unnamed or unsupported mount frames', () => {
    const catalog = benchmarks[0]!.catalog
    expect(toMount(catalog, 'j2000', date, site)).toEqual(catalog)
    expect(fromMount(catalog, 'j2000', date, site)).toEqual(catalog)
    for (const frame of ['other', 'unknown', 'j2050', 'b1950']) {
      expect(() => toMount(catalog, frame, date, site)).toThrow('not supported')
      expect(() => fromMount(catalog, frame, date, site)).toThrow('not supported')
    }
    expect(angularDistance({ raDegrees: 359, decDegrees: 0 }, { raDegrees: 1, decDegrees: 0 })).toBeCloseTo(2, 10)
  })
})

describe('target sky night', () => {
  it('keeps target azimuth in the same apparent frame, clockwise from north', () => {
    // ERFA atco13 aob output, with the same inputs as benchmarks above.
    const azimuths = [5.56350130287918, 74.13530018467179, 174.25467450209425, 285.543875717234]
    for (const [index, benchmark] of benchmarks.entries()) {
      const sample = skyPath(benchmark.catalog, site, date).samples.find(sample => sample.at === date.toISOString())!
      expect(Math.abs(sample.azimuthDegrees - azimuths[index]!) * 3600).toBeLessThan(0.5)
    }
  })

  it('matches independent airless topocentric Moon positions and geocentric illumination', () => {
    // JPL Horizons DE441, Moon (301), UTC, geodetic site -75,40,0 km,
    // quantities 4 (airless az/el). Quantity 10 from center 500@399 gives
    // geocentric illumination. https://ssd-api.jpl.nasa.gov/doc/horizons.html
    // 0.01° allows the shorter lunar model; still rejects missing parallax,
    // J2000 coordinates fed into Horizon, or refraction near the horizon.
    const path = skyPath(benchmarks[1]!.catalog, site, date)
    for (const [at, azimuth, altitude] of [
      ['2026-09-07T04:00:00.000Z', 34.392562, -17.794425],
      ['2026-09-07T06:15:00.000Z', 58.190210, -0.122525],
    ] as const) {
      const moon = path.samples.find(sample => sample.at === at)!.moon
      expect(Math.abs(moon.azimuthDegrees - azimuth)).toBeLessThan(0.01)
      expect(Math.abs(moon.altitudeDegrees - altitude)).toBeLessThan(0.01)
    }
    const moon = path.samples.find(sample => sample.at === date.toISOString())!.moon
    expect(Math.abs(moon.illuminationFraction - 0.1948491)).toBeLessThan(0.0001)
    expect(path.samples.some(sample => sample.moon.altitudeDegrees > 0)).toBe(true)
    expect(path.samples.some(sample => sample.moon.altitudeDegrees < 0)).toBe(true)
  })

  it.each([
    ['2026-09-07T04:00:00Z', false],
    ['2026-09-18T04:00:00Z', true],
  ] as const)('moves lunar illumination consistently with waxing or waning on %s', (at, waxing) => {
    const samples = skyPath(benchmarks[1]!.catalog, site, new Date(at)).samples
    for (const [index, sample] of samples.entries()) {
      expect(sample.moon.waxing).toBe(waxing)
      expect(sample.moon.illuminationFraction).toBeGreaterThan(0)
      expect(sample.moon.illuminationFraction).toBeLessThan(1)
      if (index > 0) {
        const previous = samples[index - 1]!
        expect(Date.parse(sample.at) - Date.parse(previous.at)).toBe(900_000)
        expect(sample.moon.illuminationFraction > previous.moon.illuminationFraction).toBe(waxing)
      }
    }
  })

  it('spans the active observing night in observatory solar time and reports sampled dark visibility', () => {
    const path = skyPath(benchmarks[1]!.catalog, site, date)
    expect(path.observedAt).toBe(date.toISOString())
    expect(path.startsAt).toBe('2026-09-06T17:00:00.000Z')
    expect(path.endsAt).toBe('2026-09-07T17:00:00.000Z')
    expect(path.samples).toHaveLength(97)
    expect(path.aboveHorizonDuringDarkness).toHaveLength(1)
    const window = path.aboveHorizonDuringDarkness[0]!
    expect(Date.parse(window.startsAt)).toBeLessThan(date.getTime())
    expect(Date.parse(window.endsAt)).toBeGreaterThan(date.getTime())
    const visible = path.samples.filter(sample => sample.at >= window.startsAt && sample.at < window.endsAt)
    expect(visible.length).toBeGreaterThan(0)
    expect(visible.every(sample => sample.altitudeDegrees > 0 && sample.sunAltitudeDegrees < -18)).toBe(true)
    expect(path.samples.some(sample => sample.sunAltitudeDegrees > 0)).toBe(true)
  })

  it('switches morning planning to the upcoming night after astronomical dawn', () => {
    const target = benchmarks[1]!.catalog
    const beforeDawn = skyPath(target, site, new Date('2026-09-07T08:00:00Z'))
    expect(beforeDawn.startsAt).toBe('2026-09-06T17:00:00.000Z')
    expect(beforeDawn.aboveHorizonDuringDarkness[0]!.endsAt < '2026-09-07T12:00:00Z').toBe(true)
    for (const time of ['2026-09-07T10:00:00Z', '2026-09-07T14:00:00Z']) {
      const morning = skyPath(target, site, new Date(time))
      expect(morning.startsAt).toBe('2026-09-07T17:00:00.000Z')
      expect(morning.endsAt).toBe('2026-09-08T17:00:00.000Z')
      expect(morning.aboveHorizonDuringDarkness.length).toBeGreaterThan(0)
      expect(morning.aboveHorizonDuringDarkness.every(window => window.startsAt > time)).toBe(true)
    }
  })

  it('does not invent darkness during polar summer or visibility for a never-rising target', () => {
    const arctic = { latitudeDegrees: 80, longitudeDegrees: 20 }
    const summer = skyPath({ raDegrees: 10, decDegrees: 85 }, arctic, new Date('2026-06-21T22:00:00Z'))
    expect(summer.samples.every(sample => sample.sunAltitudeDegrees > 0)).toBe(true)
    expect(summer.aboveHorizonDuringDarkness).toEqual([])
    const southern = skyPath({ raDegrees: 10, decDegrees: -80 }, site, date)
    expect(southern.highestAltitudeDegrees).toBeLessThan(0)
    expect(southern.aboveHorizonDuringDarkness).toEqual([])
  })
})

describe('inverse plate projection', () => {
  it.each([[-0.001, 0.0003, 0.0002, 0.001], [0.001, 0.0003, -0.0002, 0.001]] as const)('round trips rotated TAN plates for both parities: %j', (...cd) => {
    const wcs: PlateWcs = { width: 1000, height: 800, referenceX: 500.5, referenceY: 400.5, raDegrees: 359.95, decDegrees: 82, cd }
    expect(angularDistance(skyAtPixel(wcs, 499.5, 399.5), { raDegrees: 359.95, decDegrees: 82 })).toBeLessThan(1e-10)
    for (const [x, y] of [[0, 0], [999, 799], [500, 100], [100, 700], [-0.5, 799.5]]) {
      const sky = skyAtPixel(wcs, x!, y!)
      expect(sky.raDegrees).toBeGreaterThanOrEqual(0)
      expect(sky.raDegrees).toBeLessThan(360)
      const pixel = projectSky(wcs, sky)
      expect(pixel).not.toBeNull()
      expect(pixel!.x).toBeCloseTo(x!, 7)
      expect(pixel!.y).toBeCloseTo(y!, 7)
    }
    const corners = plateCorners(wcs)
    expect(corners).toHaveLength(4)
    for (const [index, [x, y]] of [[-0.5, -0.5], [999.5, -0.5], [999.5, 799.5], [-0.5, 799.5]].entries()) {
      const pixel = projectSky(wcs, corners[index]!)!
      expect(pixel.x).toBeCloseTo(x!, 7)
      expect(pixel.y).toBeCloseTo(y!, 7)
    }
  })
})
