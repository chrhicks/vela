import { describe, expect, it } from 'vitest'
import { rigidityVerdict, type Baseline, type CameraOrientation } from '@vela/rig-sky'
import { syntheticSite } from '@vela/rig-testing'

type Vec3 = readonly [number, number, number]

const radians = Math.PI / 180

const arcminutesToRadians = (arcminutes: number) => (arcminutes / 60) * radians

const unit = (vector: Vec3): Vec3 => {
  const length = Math.hypot(...vector)

  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

function turn(vector: Vec3, axis: Vec3, degrees: number): Vec3 {
  const cosine = Math.cos(degrees * radians)
  const sine = Math.sin(degrees * radians)
  const along = (axis[0] * vector[0] + axis[1] * vector[1] + axis[2] * vector[2]) * (1 - cosine)
  const across = cross(axis, vector)

  return [
    vector[0] * cosine + across[0] * sine + axis[0] * along,
    vector[1] * cosine + across[1] * sine + axis[1] * along,
    vector[2] * cosine + across[2] * sine + axis[2] * along,
  ]
}

const turnCamera = (camera: CameraOrientation, axis: Vec3, degrees: number): CameraOrientation => ({
  pixelX: turn(camera.pixelX, axis, degrees),
  pixelY: turn(camera.pixelY, axis, degrees),
  boresight: turn(camera.boresight, axis, degrees),
})

const declination = 80 * radians

const cameraAtMeridian: CameraOrientation = {
  pixelX: [0, 1, 0],
  pixelY: [-Math.sin(declination), 0, Math.cos(declination)],
  boresight: [Math.cos(declination), 0, Math.sin(declination)],
}

/** Pole error as the polar alignment reads it at the synthetic site: north is altitude, east is azimuth scaled by the axis altitude. */
function mountAxis(altitudeArcmin: number, azimuthArcmin: number): Vec3 {
  const north = altitudeArcmin
  const east = azimuthArcmin * Math.cos((syntheticSite.latitudeDegrees + altitudeArcmin / 60) * radians)

  return unit([arcminutesToRadians(north), arcminutesToRadians(east), 1])
}

const rigidMount = (mountAngleDegrees: number, axis = mountAxis(20, 45)) => ({
  mountAngleDegrees,
  orientation: turnCamera(cameraAtMeridian, axis, mountAngleDegrees),
})

const angles = [130, 72, 14] as const

const baselineAt = (mountAngles: readonly [number, number, number], axis = mountAxis(20, 45)): Baseline => [
  rigidMount(mountAngles[0], axis),
  rigidMount(mountAngles[1], axis),
  rigidMount(mountAngles[2], axis),
]

function withThird(baseline: Baseline, change: (orientation: CameraOrientation) => CameraOrientation): Baseline {
  const [first, second, third] = baseline

  return [first, second, { ...third, orientation: change(third.orientation) }]
}

describe('rigidityVerdict', () => {
  it('calls a rigid mount rigid, whatever its polar error', () => {
    for (const axis of [mountAxis(0, 0), mountAxis(20, 45), mountAxis(-300, 900)]) {
      const verdict = rigidityVerdict(baselineAt(angles, axis))

      expect(verdict.status).toBe('rigid')
      expect(verdict.missArcmin).toBeLessThan(0.01)
    }
  })

  it('reports the threshold it judged by', () => {
    expect(rigidityVerdict(baselineAt(angles)).thresholdArcmin).toBe(2)
  })

  it('does not depend on which way the mount turns', () => {
    const forward = rigidityVerdict(baselineAt([0, 58, 116]))
    const backward = rigidityVerdict(baselineAt([0, -58, -116], mountAxis(20, 45)))

    expect(forward.status).toBe('rigid')
    expect(backward.status).toBe('rigid')
  })

  it('reads mount angles modulo a full turn', () => {
    const [first, second, third] = baselineAt([170, 228, 286])
    const looseSecond = { ...second, orientation: turnCamera(second.orientation, unit(cross(second.orientation.boresight, [0, 0, 1])), 0.5) }

    const unwrapped = rigidityVerdict([first, looseSecond, third])
    const wrapped = rigidityVerdict([first, looseSecond, { ...third, mountAngleDegrees: -74 }])

    expect(unwrapped.missArcmin).toBeGreaterThan(1)
    expect(wrapped.missArcmin).toBeCloseTo(unwrapped.missArcmin, 9)
  })

  it('measures the miss from the second position when the camera did not turn between the first two', () => {
    const [first, second, third] = baselineAt(angles)
    const stuck = { ...second, orientation: first.orientation }
    const slightlyOff = turnCamera(first.orientation, unit(cross(first.orientation.boresight, [0, 0, 1])), 10 / 60)

    const verdict = rigidityVerdict([first, stuck, { ...third, orientation: slightlyOff }])

    expect(verdict.status).toBe('not-rigid')
    expect(verdict.missArcmin).toBeCloseTo(10, 6)
  })

  it('judges a half turn between the first two positions', () => {
    const verdict = rigidityVerdict(baselineAt([0, 180, 232]))

    expect(verdict.status).toBe('rigid')
    expect(verdict.missArcmin).toBeLessThan(0.01)
  })

  it('stays rigid with an arcsecond of solve noise on every position', () => {
    const [first, second, third] = baselineAt(angles)
    const arcsecond = 1 / 3600

    const noisy: Baseline = [
      { ...first, orientation: turnCamera(first.orientation, [1, 0, 0], arcsecond) },
      { ...second, orientation: turnCamera(second.orientation, [0, 1, 0], arcsecond) },
      { ...third, orientation: turnCamera(third.orientation, [0, 0, 1], arcsecond) },
    ]

    const verdict = rigidityVerdict(noisy)

    expect(verdict.status).toBe('rigid')
    expect(verdict.missArcmin).toBeGreaterThan(0)
    expect(verdict.missArcmin).toBeLessThan(0.2)
  })

  it('says not rigid, with the miss, when the third position stepped by 30 arcmin', () => {
    const stepped = withThird(baselineAt(angles), camera => {
      const across = unit(cross(camera.boresight, [0, 0, 1]))

      return turnCamera(camera, across, 0.5)
    })

    const verdict = rigidityVerdict(stepped)

    expect(verdict.status).toBe('not-rigid')
    expect(verdict.missArcmin).toBeCloseTo(30, 6)
  })

  it('says not rigid when the camera sags in proportion to the turn squared', () => {
    const sag = (mountAngleDegrees: number) => {
      const rigid = rigidMount(mountAngleDegrees)
      const sagDegrees = 0.0003 * (mountAngleDegrees - angles[0]) ** 2

      return { ...rigid, orientation: turnCamera(rigid.orientation, [0, 1, 0], sagDegrees) }
    }

    const verdict = rigidityVerdict([sag(angles[0]), sag(angles[1]), sag(angles[2])])

    expect(verdict.status).toBe('not-rigid')
    expect(verdict.missArcmin).toBeGreaterThan(5)
  })

  it('says not rigid for a miss between the tool\'s 2 and 10 arcmin', () => {
    const slightlyLoose = withThird(baselineAt(angles), camera => turnCamera(camera, unit(cross(camera.boresight, [0, 0, 1])), 4 / 60))

    const verdict = rigidityVerdict(slightlyLoose)

    expect(verdict.missArcmin).toBeCloseTo(4, 6)
    expect(verdict.status).toBe('not-rigid')
  })

  it('does not see a spin about the boresight at the third position, which the polar fit never reads', () => {
    const spun = withThird(baselineAt(angles), camera => turnCamera(camera, camera.boresight, 5))

    expect(rigidityVerdict(spun).status).toBe('rigid')
  })

  it('is not rigid when a solve is not a number', () => {
    const corrupt = withThird(baselineAt(angles), camera => ({ ...camera, boresight: [Number.NaN, 0, 0] }))

    expect(rigidityVerdict(corrupt).status).toBe('not-rigid')
  })

  it('refuses a baseline whose first two positions are the same mount angle', () => {
    expect(() => rigidityVerdict(baselineAt([130, 130, 14]))).toThrow(RangeError)
  })
})
