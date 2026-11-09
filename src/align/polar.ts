import { MakeTime, Observer, Rotation_EQD_HOR, Rotation_EQJ_HOR, RotateVector, Spherical, Vector, VectorFromSphere } from 'astronomy-engine'
import type { Site } from '../pointing/target.ts'

export type Direction = readonly [number, number, number]

export interface Solve {
  readonly raDegrees: number
  readonly decDegrees: number
  readonly at: number
}

export interface PolarError {
  readonly altitudeArcmin: number
  readonly azimuthArcmin: number
  readonly totalArcmin: number
}

const radians = Math.PI / 180
const arcmin = 60 / radians
const siderealDaySeconds = 86164.0905

const observerAt = (site: Site) => new Observer(site.latitudeDegrees, site.longitudeDegrees, site.elevationMeters)

const tuple = (vector: Vector): Direction => [vector.x, vector.y, vector.z]

const dot = (a: Direction, b: Direction) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const cross = (a: Direction, b: Direction): Direction => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

const minus = (a: Direction, b: Direction): Direction => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

function unit(a: Direction): Direction {
  const length = Math.hypot(...a)

  return [a[0] / length, a[1] / length, a[2] / length]
}

export function horizonOf(solve: Solve, site: Site): Direction {
  const date = new Date(solve.at)

  return tuple(RotateVector(Rotation_EQJ_HOR(date, observerAt(site)), VectorFromSphere(new Spherical(solve.decDegrees, solve.raDegrees, 1), date)))
}

export function poleOf(at: number, site: Site): Direction {
  const date = new Date(at)

  return tuple(RotateVector(Rotation_EQD_HOR(date, observerAt(site)), new Vector(0, 0, 1, MakeTime(date))))
}

export function axisThrough(first: Direction, second: Direction, third: Direction, pole: Direction): Direction {
  const normal = unit(cross(minus(second, first), minus(third, first)))

  return dot(normal, pole) < 0 ? [-normal[0], -normal[1], -normal[2]] : normal
}

export function turn(direction: Direction, axis: Direction, angle: number): Direction {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const across = cross(axis, direction)
  const along = dot(axis, direction) * (1 - cos)

  return [0, 1, 2].map(i => direction[i]! * cos + across[i]! * sin + axis[i]! * along) as unknown as Direction
}

export function tracked(direction: Direction, axis: Direction, seconds: number): Direction {
  return turn(direction, axis, (-2 * Math.PI * seconds) / siderealDaySeconds)
}

const zenith: Direction = [0, 0, 1]
const westward: Direction = [0, 1, 0]

export function knobs(azimuth: number, altitude: number, direction: Direction): Direction {
  return turn(turn(direction, westward, altitude), zenith, azimuth)
}

export function knobsBetween(from: Direction, to: Direction): { readonly azimuth: number; readonly altitude: number } {
  let azimuth = 0
  let altitude = 0
  const step = 1e-7

  for (let round = 0; round < 8; round += 1) {
    const now = knobs(azimuth, altitude, from)
    const miss = minus(to, now)
    const byAzimuth = minus(knobs(azimuth + step, altitude, from), now).map(value => value / step) as unknown as Direction
    const byAltitude = minus(knobs(azimuth, altitude + step, from), now).map(value => value / step) as unknown as Direction
    const aa = dot(byAzimuth, byAzimuth)
    const ab = dot(byAzimuth, byAltitude)
    const bb = dot(byAltitude, byAltitude)
    const ma = dot(miss, byAzimuth)
    const mb = dot(miss, byAltitude)
    const determinant = aa * bb - ab * ab

    azimuth += (ma * bb - mb * ab) / determinant
    altitude += (mb * aa - ma * ab) / determinant
  }

  return { azimuth, altitude }
}

const altitudeOf = (direction: Direction) => Math.asin(Math.max(-1, Math.min(1, direction[2])))

const azimuthOf = (direction: Direction) => Math.atan2(-direction[1], direction[0])

export function polarError(axis: Direction, pole: Direction): PolarError {
  const azimuth = azimuthOf(axis) - azimuthOf(pole)
  const wrapped = Math.atan2(Math.sin(azimuth), Math.cos(azimuth))

  return {
    altitudeArcmin: (altitudeOf(axis) - altitudeOf(pole)) * arcmin,
    azimuthArcmin: wrapped * arcmin,
    totalArcmin: Math.acos(Math.max(-1, Math.min(1, dot(axis, pole)))) * arcmin,
  }
}

export interface Reference {
  readonly axis: Direction
  readonly camera: Direction
  readonly at: number
}

export function referenceFrom(solves: readonly [Solve, Solve, Solve], site: Site): Reference {
  const [first, second, third] = solves.map(solve => horizonOf(solve, site)) as unknown as [Direction, Direction, Direction]

  return { axis: axisThrough(first, second, third, poleOf(solves[2].at, site)), camera: third, at: solves[2].at }
}

export function errorNow(reference: Reference, solve: Solve, site: Site, tracking: boolean): PolarError {
  const expected = tracking ? tracked(reference.camera, reference.axis, (solve.at - reference.at) / 1000) : reference.camera
  const moved = knobsBetween(expected, horizonOf(solve, site))

  return polarError(knobs(moved.azimuth, moved.altitude, reference.axis), poleOf(solve.at, site))
}
