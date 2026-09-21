import { describe, expect, it } from 'vitest'
import { cameraPose, polarAxis, type MountPosition, type Vector } from './mount.js'

const position: MountPosition = {
  latitudeDegrees: 40,
  altitudeErrorDegrees: 0,
  azimuthErrorDegrees: 0,
  raAxisDegrees: 30,
  declinationDegrees: 60,
  elapsedSeconds: 0,
  tracking: true,
}

const dot = (a: Vector, b: Vector) => a.reduce((sum, value, i) => sum + value * b[i]!, 0)

function expectVector(actual: Vector, expected: Vector) {
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 10))
}

describe('rig geometry', () => {
  it('keeps the entire camera fixed on the sky when a perfect mount tracks', () => {
    const start = cameraPose(position)
    const later = cameraPose({ ...position, elapsedSeconds: 3600 })
    expectVector(later.direction, start.direction)
    expectVector(later.right, start.right)
    expectVector(later.up, start.up)
    const stopped = cameraPose({ ...position, elapsedSeconds: 3600, tracking: false })
    expect(dot(stopped.direction, start.direction)).toBeLessThan(0.995)
  })

  it('preserves the rigid camera and its cone around a misaligned RA axis', () => {
    const setup = { ...position, altitudeErrorDegrees: 1, azimuthErrorDegrees: -2 }
    const axis = polarAxis(setup)

    for (const raAxisDegrees of [0, 20, 40]) {
      const pose = cameraPose({ ...setup, raAxisDegrees })
      expect(dot(pose.direction, axis)).toBeCloseTo(Math.sin(Math.PI / 3), 12)
      expect(dot(pose.direction, pose.right)).toBeCloseTo(0, 12)
      expect(dot(pose.direction, pose.up)).toBeCloseTo(0, 12)
      expect(dot(pose.right, pose.up)).toBeCloseTo(0, 12)
      expect(dot(pose.right, pose.right)).toBeCloseTo(1, 12)
    }

    expect(cameraPose({ ...setup, raAxisDegrees: 40 }).up).not.toEqual(
      cameraPose({ ...setup, raAxisDegrees: 0 }).up,
    )
  })

  it('applies altitude upward and azimuth eastward in local horizon coordinates', () => {
    const latitude = (40 * Math.PI) / 180
    const north: Vector = [-Math.sin(latitude), 0, Math.cos(latitude)]
    const zenith: Vector = [Math.cos(latitude), 0, Math.sin(latitude)]
    const axis = polarAxis({ ...position, altitudeErrorDegrees: 1, azimuthErrorDegrees: 2 })
    expect((Math.asin(dot(axis, zenith)) * 180) / Math.PI).toBeCloseTo(41, 10)
    expect((Math.atan2(axis[1], dot(axis, north)) * 180) / Math.PI).toBeCloseTo(2, 10)
  })
})
