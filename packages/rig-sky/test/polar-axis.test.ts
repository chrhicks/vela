import { describe, expect, it } from 'vitest'
import { findSteps, fitPolarAxis, minimumFixes, stepFloorArcmin, type CameraOrientation, type SweepFix } from '@vela/rig-sky'
import { syntheticSite } from '@vela/rig-testing'

type Vec3 = readonly [number, number, number]

const radians = Math.PI / 180

const arcminutesToDegrees = (arcminutes: number) => arcminutes / 60

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

function mountAxis(altitudeArcmin: number, azimuthArcmin: number): Vec3 {
  const latitude = syntheticSite.latitudeDegrees * radians
  const altitude = latitude + (altitudeArcmin / 60) * radians
  const azimuth = (azimuthArcmin / 60) * radians
  const [up, north, east] = [Math.sin(altitude), Math.cos(altitude) * Math.cos(azimuth), Math.cos(altitude) * Math.sin(azimuth)]

  return [up * Math.cos(latitude) - north * Math.sin(latitude), east, up * Math.sin(latitude) + north * Math.cos(latitude)]
}

const axis = mountAxis(20, 45)

const pole: Vec3 = [0, 0, 1]

function randoms(seed: number) {
  let state = seed

  return () => {
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed

    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296 - 0.5
  }
}

interface Sweep {
  readonly mountAngles: readonly number[]
  readonly slips?: readonly { readonly fromIndex: number; readonly arcmin: number; readonly aboutBoresight?: boolean }[]
  readonly axis?: Vec3
  readonly noiseArcsec?: number
  readonly seed?: number
}

function sweep({ mountAngles, slips = [], axis: mountAxisVector = axis, noiseArcsec = 0, seed = 1 }: Sweep): SweepFix[] {
  const random = randoms(seed)
  const noise = () => (noiseArcsec / 3600) * random() * 2

  return mountAngles.map((mountAngleDegrees, index) => {
    let orientation = turnCamera(cameraAtMeridian, mountAxisVector, mountAngleDegrees)

    for (const slip of slips) {
      if (index >= slip.fromIndex) orientation = turnCamera(orientation, slip.aboutBoresight ? orientation.boresight : [0, 1, 0], arcminutesToDegrees(slip.arcmin))
    }

    orientation = turnCamera(turnCamera(turnCamera(orientation, [1, 0, 0], noise()), [0, 1, 0], noise()), [0, 0, 1], noise())

    return { label: `p${index}`, atSeconds: index * 10, mountAngleDegrees, orientation }
  })
}

const nineteenDegreeLegs = [130, 111, 92, 73, 54, 35, 16]

const sixDegreeLegs = [130, 124, 118, 112, 106, 100, 94, 88, 82]

const separation = (a: Vec3, b: Vec3) => Math.atan2(Math.hypot(...cross(a, b)), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) * (180 / Math.PI) * 60

describe('fitPolarAxis', () => {
  it('recovers the axis, and its altitude and azimuth, of a rigid mount', () => {
    const fit = fitPolarAxis(sweep({ mountAngles: nineteenDegreeLegs }), syntheticSite.latitudeDegrees)

    expect(separation(fit.axis, axis)).toBeLessThan(1e-6)
    expect(fit.altitudeArcsec / 60).toBeCloseTo(20, 6)
    expect(fit.azimuthArcsec / 60).toBeCloseTo(45, 6)
    expect(fit.totalArcsec / 60).toBeCloseTo(separation(axis, [0, 0, 1]), 6)
    expect(fit.verdict.status).toBe('rigid')
    expect(fit.verdict.steps).toEqual([])
    expect(fit.verdict.missArcmin).toBeLessThan(0.01)
  })

  it('reads the same axis from a sweep that goes back and forth', () => {
    const fit = fitPolarAxis(sweep({ mountAngles: [130, 111, 92, 73, 92, 111, 130, 111] }), syntheticSite.latitudeDegrees)

    expect(separation(fit.axis, axis)).toBeLessThan(1e-6)
    expect(fit.verdict.status).toBe('rigid')
  })

  it('keeps the axis to a fraction of an arcmin with an arcsecond of solve noise on every fix', () => {
    const fit = fitPolarAxis(sweep({ mountAngles: nineteenDegreeLegs, noiseArcsec: 1 }), syntheticSite.latitudeDegrees)

    expect(separation(fit.axis, axis)).toBeLessThan(0.1)
    expect(fit.verdict.status).toBe('rigid')
    expect(fit.verdict.missArcmin).toBeGreaterThan(0)
  })

  it('does not depend on the order the fixes arrive in', () => {
    const fixes = sweep({ mountAngles: sixDegreeLegs, slips: [{ fromIndex: 3, arcmin: 30 }] })
    const shuffled = [4, 0, 8, 2, 6, 1, 7, 3, 5].map(index => fixes[index]!)

    expect(fitPolarAxis(shuffled, syntheticSite.latitudeDegrees)).toEqual(fitPolarAxis(fixes, syntheticSite.latitudeDegrees))
  })

  it('says not rigid, and where, when the mount slipped 30 arcmin partway through', () => {
    const fit = fitPolarAxis(sweep({ mountAngles: sixDegreeLegs, slips: [{ fromIndex: 3, arcmin: 30 }] }), syntheticSite.latitudeDegrees)

    expect(fit.verdict.status).toBe('not-rigid')
    expect(fit.verdict.missArcmin).toBeGreaterThan(10)
    expect(fit.verdict.steps.map(step => [step.labelBefore, step.labelAfter])).toEqual([['p2', 'p3']])
  })

  it('says not rigid for a slip the step finder cannot place but the sweep still shows', () => {
    const fit = fitPolarAxis(sweep({ mountAngles: sixDegreeLegs, slips: [{ fromIndex: 3, arcmin: stepFloorArcmin - 4 }] }), syntheticSite.latitudeDegrees)

    expect(fit.verdict.steps).toEqual([])
    expect(fit.verdict.status).toBe('not-rigid')
  })

  it('says not rigid for a step that only rolls the image, which no boresight miss sees', () => {
    const fit = fitPolarAxis(
      sweep({ mountAngles: sixDegreeLegs, axis: pole, slips: [{ fromIndex: 3, arcmin: 30, aboutBoresight: true }] }),
      syntheticSite.latitudeDegrees,
    )

    expect(fit.verdict.missArcmin).toBeLessThan(fit.verdict.thresholdArcmin)
    expect(fit.verdict.steps.map(step => step.labelAfter)).toEqual(['p3'])
    expect(fit.verdict.status).toBe('not-rigid')
  })

  it('says not rigid, with no axis, when the camera did not turn while the mount did', () => {
    const stuck = sweep({ mountAngles: sixDegreeLegs }).map((fix, _index, fixes) => ({ ...fix, orientation: fixes[0]!.orientation }))

    const fit = fitPolarAxis(stuck, syntheticSite.latitudeDegrees)

    expect(fit.axis.every(Number.isNaN)).toBe(true)
    expect(fit.verdict.status).toBe('not-rigid')
  })

  it('refuses fewer fixes than it can tell a loose mount with', () => {
    expect(() => fitPolarAxis(sweep({ mountAngles: nineteenDegreeLegs.slice(0, minimumFixes - 1) }), syntheticSite.latitudeDegrees)).toThrow(RangeError)
  })
})

describe('findSteps', () => {
  it('finds a rigid mount step free, though a tilted axis adds to every pair', () => {
    expect(findSteps(sweep({ mountAngles: nineteenDegreeLegs }))).toEqual([])
  })

  it('finds a 30 arcmin step at the pose it happened and sizes it', () => {
    const [step, ...others] = findSteps(sweep({ mountAngles: sixDegreeLegs, slips: [{ fromIndex: 3, arcmin: 30 }] }))

    expect(others).toEqual([])
    expect(step).toMatchObject({ labelBefore: 'p2', labelAfter: 'p3', turnDegrees: -6, mountAngleBeforeDegrees: 118, mountAngleAfterDegrees: 112 })
    expect(Math.abs(step!.excessArcmin - 30)).toBeLessThan(step!.baselineArcmin * 1.1)
  })

  it('finds two steps and no other', () => {
    const steps = findSteps(
      sweep({
        mountAngles: sixDegreeLegs,
        slips: [
          { fromIndex: 2, arcmin: 25 },
          { fromIndex: 6, arcmin: -25 },
        ],
      }),
    )

    expect(steps.map(step => step.labelAfter)).toEqual(['p2', 'p6'])
  })

  it('finds a step on the last pair of the sweep', () => {
    const steps = findSteps(sweep({ mountAngles: sixDegreeLegs, slips: [{ fromIndex: sixDegreeLegs.length - 1, arcmin: 20 }] }))

    expect(steps.map(step => step.labelAfter)).toEqual([`p${sixDegreeLegs.length - 1}`])
  })

  it('finds nothing in noise below the floor, over many seeds', () => {
    for (let seed = 1; seed <= 200; seed++) expect(findSteps(sweep({ mountAngles: sixDegreeLegs, noiseArcsec: 3, seed }))).toEqual([])
  })

  it('finds nothing in noise below the floor on a mount at the pole, where nothing else adds to the baseline', () => {
    for (let seed = 1; seed <= 200; seed++) expect(findSteps(sweep({ mountAngles: sixDegreeLegs, axis: pole, noiseArcsec: 3, seed }))).toEqual([])
  })

  it('finds nothing in a slip under the floor', () => {
    expect(findSteps(sweep({ mountAngles: sixDegreeLegs, slips: [{ fromIndex: 3, arcmin: stepFloorArcmin - 4 }] }))).toEqual([])
  })
})
