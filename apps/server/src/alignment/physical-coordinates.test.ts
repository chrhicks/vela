import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createAlignmentBaseline, measureAlignment, type AlignmentSample } from './geometry.js'
import { localSiderealDegrees, physicalAlignmentSample, projectPhysicalAlignmentTarget } from './physical-coordinates.js'
import type { PlateWcs, SkyPosition } from '../plate-solving/solver.js'

// Independent ERFA 2.0.1.5 / SOFA fixtures, with no production conversion used.
// At a deliberately generic latitude 40°, a Dec 60° vector rotates through mechanical joints
// 10°, 28°, 46° at elapsed 0, 50, 130 seconds. Tilt about local east by the
// altitude error, then rotate north/east about zenith by the azimuth error.
// Convert that horizon vector to apparent RA/Dec using gst06a + longitude.
// atoc13('R', RA + eo06a, Dec, ...) gives catalog positions: UTC, DUT1=0,
// elevation=100m, polar motion=0, pressure=0, temperature=10°C, humidity=0, wavelength=.55µm.
// The final frame is at 250 seconds; joint motion compensates elapsed GAST.
// https://github.com/liberfa/erfa/blob/master/src/atoc13.c
// https://github.com/liberfa/erfa/blob/master/src/gst06a.c
// Each recorded capture start is one second before its 2-second midpoint.
type CaptureFixture = { solved: SkyPosition, capturedAt: string, sidereal?: number }
const fixture = JSON.parse(readFileSync(new URL('./physical-coordinates.fixture.json', import.meta.url), 'utf8')) as {
  site: { latitudeDegrees: number, longitudeDegrees: number, elevationMeters: number }
  cases: { altitude: number, azimuth: number, samples: CaptureFixture[], adjusted: CaptureFixture, target: SkyPosition }[]
}
const { site } = fixture
const sample = (frame: CaptureFixture) => physicalAlignmentSample(frame.solved, { capturedAt: frame.capturedAt, exposureSeconds: 2 }, site)

describe('physical alignment coordinate boundary', () => {
  it.each(fixture.cases)('recovers an independently constructed physical pole ($altitude, $azimuth)', reference => {
    const samples = reference.samples.map(sample) as [AlignmentSample, AlignmentSample, AlignmentSample]
    expect(samples[0].siderealTimeDegrees).toBeGreaterThan(359)
    expect(samples[1].siderealTimeDegrees).toBeLessThan(1)
    for (const [index, value] of samples.entries()) {
      expect(Math.abs(value.siderealTimeDegrees - reference.samples[index]!.sidereal!) * 3600).toBeLessThan(0.5)
      expect(Date.parse(value.capturedAt) - Date.parse(reference.samples[index]!.capturedAt)).toBe(1000)
    }
    const baseline = createAlignmentBaseline(samples, site.latitudeDegrees)
    // Allows the shorter Astronomy Engine nutation/aberration model versus ERFA,
    // including amplification from fitting a pole to a finite three-point arc.
    expect(Math.abs(baseline.measurement.altitudeArcsec - reference.altitude)).toBeLessThan(1)
    expect(Math.abs(baseline.measurement.azimuthArcsec - reference.azimuth)).toBeLessThan(1)
    const current = sample(reference.adjusted)
    const measurement = measureAlignment(baseline, current, true)
    expect(Math.abs(measurement.altitudeArcsec - (reference.altitude ? 120 : 0))).toBeLessThan(1)
    expect(Math.abs(measurement.azimuthArcsec - (reference.azimuth ? -90 : 0))).toBeLessThan(1)

    // Independently project the ERFA target using a TAN basis and inversion
    // of a rotated, parity-flipped CD matrix, rather than production projectSky.
    const wcs: PlateWcs = { width: 6248, height: 4176, referenceX: 3124.5, referenceY: 2088.5,
      ...reference.adjusted.solved, cd: [0.00043, 0.00032, 0.00032, -0.00043] }
    const target = projectPhysicalAlignmentTarget(wcs, measurement.correctionTarget, current, site)!
    const expected = tangentPixel(wcs, reference.target)
    expect(Math.hypot(target.x - expected.x, target.y - expected.y)).toBeLessThan(0.6)
  })

  it('rejects invalid timing/site rather than manufacturing sidereal angles', () => {
    const frame = fixture.cases[0]!.samples[0]!
    for (const exposureSeconds of [0, -1, NaN]) {
      expect(() => physicalAlignmentSample(frame.solved, { capturedAt: frame.capturedAt, exposureSeconds }, site)).toThrow(/duration/)
    }
    expect(() => physicalAlignmentSample(frame.solved, { capturedAt: 'invalid', exposureSeconds: 2 }, site)).toThrow(/start/)
    expect(() => localSiderealDegrees(new Date(frame.capturedAt), { ...site, longitudeDegrees: NaN })).toThrow(/site/)
  })
})

function tangentPixel(wcs: PlateWcs, point: SkyPosition) {
  const r = Math.PI / 180
  const ra = point.raDegrees * r, dec = point.decDegrees * r
  const centerRa = wcs.raDegrees * r, centerDec = wcs.decDegrees * r
  const vector = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]
  const east = [-Math.sin(centerRa), Math.cos(centerRa), 0]
  const north = [-Math.sin(centerDec) * Math.cos(centerRa), -Math.sin(centerDec) * Math.sin(centerRa), Math.cos(centerDec)]
  const center = [Math.cos(centerDec) * Math.cos(centerRa), Math.cos(centerDec) * Math.sin(centerRa), Math.sin(centerDec)]
  const dot = (basis: number[]) => basis.reduce((sum, value, index) => sum + value * vector[index]!, 0)
  const x = dot(east) / dot(center) / r, y = dot(north) / dot(center) / r
  const [a, b, c, d] = wcs.cd
  return { x: wcs.referenceX - 1 + (d * x - b * y) / (a * d - b * c),
    y: wcs.referenceY - 1 + (a * y - c * x) / (a * d - b * c) }
}
