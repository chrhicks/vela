import { describe, expect, it } from 'vitest'
import { cameraOrientation, type CameraOrientation, type SolvedField } from '@vela/rig-sky'

type Vec3 = readonly [number, number, number]

const radians = Math.PI / 180

/** The J2000 epoch, when the equator of date is the J2000 equator to within the 20 milliarcsecond frame bias. */
const j2000 = new Date('2000-01-01T11:58:55.816Z')

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

const separationDegrees = (a: Vec3, b: Vec3) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / radians

/** `digits` of 3 allows the 17 arcsecond nutation that separates the true equator of date from J2000. */
function expectVector(actual: Vec3, expected: Vec3, digits = 6) {
  for (const index of [0, 1, 2] as const) expect(actual[index]).toBeCloseTo(expected[index], digits)
}

const field = (raDegrees: number, decDegrees: number, cd: SolvedField['cd']): SolvedField => ({ raDegrees, decDegrees, cd })

const northUp = [-0.001, 0, 0, 0.001] as const

describe('cameraOrientation', () => {
  it('puts a field on the meridian at the equator on the x axis, and one at the pole on the z axis', () => {
    expectVector(cameraOrientation(field(40, 0, northUp), j2000, 40).boresight, [1, 0, 0], 3)
    expectVector(cameraOrientation(field(40, 90, northUp), j2000, 40).boresight, [0, 0, 1], 3)
  })

  it('measures right ascension from the local sidereal time, east positive', () => {
    expectVector(cameraOrientation(field(100, 0, northUp), j2000, 10).boresight, [0, 1, 0], 3)
    expectVector(cameraOrientation(field(10, 0, northUp), j2000, 100).boresight, [0, -1, 0], 3)
  })

  it('points x along west and y along south for a north-up image with east to the left, keeping the set right-handed', () => {
    const { pixelX, pixelY } = cameraOrientation(field(40, 0, northUp), j2000, 40)

    expectVector(pixelX, [0, -1, 0], 3)
    expectVector(pixelY, [0, 0, -1], 3)
  })

  it('leaves the solve in the J2000 frame for a simulated sky, at any date', () => {
    const wcs = field(100, 30, northUp)
    const now = new Date('2026-11-01T00:00:00Z')

    expectVector(cameraOrientation(wcs, now, 0, { fixedFrame: true }).boresight, [Math.cos(30 * radians) * Math.cos(100 * radians), Math.cos(30 * radians) * Math.sin(100 * radians), Math.sin(30 * radians)])
    expect(separationDegrees(cameraOrientation(wcs, now, 0).boresight, cameraOrientation(wcs, now, 0, { fixedFrame: true }).boresight)).toBeGreaterThan(0.3)
  })

  it('rolls the pixel axes with the WCS rotation', () => {
    const angle = 30 * radians
    const rolled = [-0.001 * Math.cos(angle), 0.001 * Math.sin(angle), -0.001 * Math.sin(angle), 0.001 * Math.cos(angle)] as const
    const upright = cameraOrientation(field(40, 20, northUp), j2000, 25)
    const turned = cameraOrientation(field(40, 20, rolled), j2000, 25)

    expect(separationDegrees(upright.pixelX, turned.pixelX)).toBeCloseTo(30, 6)
    expect(separationDegrees(upright.pixelY, turned.pixelY)).toBeCloseTo(30, 6)
    expectVector(turned.boresight, upright.boresight)
  })

  it('returns a right-handed set of unit axes whichever way the WCS is handed', () => {
    for (const cd of [northUp, [0.001, 0, 0, 0.001], [-0.0008, 0.0006, 0.0006, 0.0008], [0.0008, 0.0006, 0.0006, -0.0008]] as const) {
      const { pixelX, pixelY, boresight } = cameraOrientation(field(210, -35, cd), new Date('2026-09-09T08:14:42Z'), 123)

      expect(Math.hypot(...pixelX)).toBeCloseTo(1, 12)
      expect(Math.hypot(...pixelY)).toBeCloseTo(1, 12)
      expect(dot(pixelX, pixelY)).toBeCloseTo(0, 12)
      expectVector(cross(pixelX, pixelY), boresight)
    }
  })

  it('reads a negative-determinant WCS as the same orientation as its positive twin with the y axis reversed', () => {
    const plain = cameraOrientation(field(40, 20, [0.001, 0, 0, 0.001]), j2000, 25)
    const mirrored = cameraOrientation(field(40, 20, [0.001, 0, 0, -0.001]), j2000, 25)

    expectVector(mirrored.boresight, plain.boresight)
    expectVector(mirrored.pixelX, plain.pixelX)
    expectVector(mirrored.pixelY, plain.pixelY)
  })

  it('carries the J2000 solve to the date: the same field moves with precession', () => {
    const solved = field(100, 20, northUp)
    const then = cameraOrientation(solved, j2000, 50).boresight
    const now = cameraOrientation(solved, new Date('2026-09-09T08:14:42Z'), 50).boresight

    expect(separationDegrees(then, now)).toBeGreaterThan(0.2)
    expect(separationDegrees(then, now)).toBeLessThan(0.5)
  })

  it('takes the sidereal angle modulo a full turn', () => {
    const solved = field(100, 20, northUp)
    const at = new Date('2026-09-09T08:14:42Z')
    const early: CameraOrientation = cameraOrientation(solved, at, 50)
    const later: CameraOrientation = cameraOrientation(solved, at, 50 + 360)

    expectVector(early.boresight, later.boresight)
  })
})
