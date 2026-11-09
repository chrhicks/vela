import { EquatorFromVector, Observer, Rotation_HOR_EQJ, RotateVector, Vector, MakeTime } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'
import { errorNow, knobs, poleOf, polarError, referenceFrom, tracked, turn, type Direction, type Solve } from './polar.ts'
import { exposureMiddle, raForHourAngle } from './run.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const startedAt = Date.UTC(2026, 10, 9, 4, 0, 0)
const arcminute = Math.PI / 180 / 60

function solveAt(direction: Direction, at: number): Solve {
  const date = new Date(at)
  const equator = EquatorFromVector(RotateVector(Rotation_HOR_EQJ(date, new Observer(phoenix.latitudeDegrees, phoenix.longitudeDegrees, phoenix.elevationMeters)), new Vector(direction[0], direction[1], direction[2], MakeTime(date))))

  return { raDegrees: equator.ra * 15, decDegrees: equator.dec, at }
}

function mount(azimuthArcmin: number, altitudeArcmin: number) {
  const pole = poleOf(startedAt, phoenix)
  const axis = knobs(azimuthArcmin * arcminute, altitudeArcmin * arcminute, pole)
  const east: Direction = [0, -1, 0]
  const start = turn(axis, east, (10 * Math.PI) / 180)
  const camera = (seconds: number, turned: number) => tracked(turn(start, axis, turned), axis, seconds)
  const solves = [0, 1, 2].map(index => solveAt(camera(60 * index, (-57 * index * Math.PI) / 180), startedAt + 60_000 * index)) as unknown as [Solve, Solve, Solve]

  return { pole, axis, camera, solves }
}

describe('polar alignment from three frames', () => {
  it('finds no error when the axis is on the pole', () => {
    const { solves } = mount(0, 0)
    const reference = referenceFrom(solves, phoenix)

    expect(polarError(reference.axis, poleOf(solves[2].at, phoenix)).totalArcmin).toBeLessThan(0.05)
  })

  it('reads an azimuth knob error as azimuth, and an altitude knob error as altitude, west and low negative', () => {
    const azimuthOnly = mount(30, 0)
    const altitudeOnly = mount(0, 20)
    const azimuthError = polarError(referenceFrom(azimuthOnly.solves, phoenix).axis, azimuthOnly.pole)
    const altitudeError = polarError(referenceFrom(altitudeOnly.solves, phoenix).axis, altitudeOnly.pole)

    expect(azimuthError.azimuthArcmin).toBeCloseTo(-30, 1)
    expect(Math.abs(azimuthError.altitudeArcmin)).toBeLessThan(0.05)
    expect(altitudeError.altitudeArcmin).toBeCloseTo(-20, 1)
    expect(Math.abs(altitudeError.azimuthArcmin)).toBeLessThan(0.05)
  })

  it('follows the knobs while tracking: it reports where the turned axis now is', () => {
    const { solves, camera, pole, axis } = mount(40, -25)
    const reference = referenceFrom(solves, phoenix)
    const later = 300
    const after = (azimuth: number, altitude: number) => solveAt(knobs(azimuth * arcminute, altitude * arcminute, camera(120 + later, (-114 * Math.PI) / 180)), startedAt + (120 + later) * 1000)
    const truth = (azimuth: number, altitude: number) => polarError(knobs(azimuth * arcminute, altitude * arcminute, axis), pole)

    for (const [azimuth, altitude] of [[0, 0], [-20, 12.5], [-40, 25], [-41, 25.2]] as const) {
      const measured = errorNow(reference, after(azimuth, altitude), phoenix, true)
      const actual = truth(azimuth, altitude)

      expect(measured.azimuthArcmin).toBeCloseTo(actual.azimuthArcmin, 2)
      expect(measured.altitudeArcmin).toBeCloseTo(actual.altitudeArcmin, 2)
    }

    expect(truth(0, 0).azimuthArcmin).toBeCloseTo(-40, 0)
    expect(truth(0, 0).altitudeArcmin).toBeCloseTo(25, 0)
    expect(truth(-20, 12.5).totalArcmin).toBeLessThan(truth(0, 0).totalArcmin / 1.9)
  })
})

describe('alignment helpers', () => {
  it('times a frame at the middle of its exposure, reading DATE-OBS as UTC', () => {
    expect(exposureMiddle([{ key: 'DATE-OBS', value: '2026-11-08T18:41:07.993', comment: '' }, { key: 'EXPTIME', value: '2.000000E+00', comment: '' }])).toBe(Date.parse('2026-11-08T18:41:08.993Z'))
    expect(exposureMiddle([{ key: 'EXPTIME', value: '2', comment: '' }])).toBeUndefined()
  })

  it('turns an hour angle into the right ascension of date, east negative', () => {
    const ra = raForHourAngle(-90, phoenix, startedAt)
    const meridian = raForHourAngle(0, phoenix, startedAt)

    expect((((ra - meridian) % 24) + 24) % 24).toBeCloseTo(6, 6)
  })
})
