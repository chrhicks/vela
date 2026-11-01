import type { EquatorialPosition } from './coordinates.ts'

const radians = Math.PI / 180

const arcminutesPerRadian = (180 / Math.PI) * 60

const farthestAngleCosine = Math.cos(89 * radians)

export interface TangentOffset {
  readonly east: number
  readonly north: number
  readonly total: number
}

/**
 * Where `solved` lies on the tangent plane at `reported`, in arcminutes. East already carries the cos(dec)
 * factor, so it is the sky distance along the parallel. Positive north means the sky is north of where the
 * mount believes it points. Both positions must be in the same frame. Past 89 degrees apart the tangent plane
 * no longer describes the offset, so there is no answer.
 */
export function tangentOffsetArcmin(reported: EquatorialPosition, solved: EquatorialPosition): TangentOffset | null {
  const dec0 = reported.decDegrees * radians
  const dec = solved.decDegrees * radians
  const dra = (solved.raDegrees - reported.raDegrees) * radians
  const cosAngle = Math.sin(dec0) * Math.sin(dec) + Math.cos(dec0) * Math.cos(dec) * Math.cos(dra)

  if (cosAngle <= farthestAngleCosine) return null

  const east = (Math.cos(dec) * Math.sin(dra)) / cosAngle
  const north = (Math.cos(dec0) * Math.sin(dec) - Math.sin(dec0) * Math.cos(dec) * Math.cos(dra)) / cosAngle

  return {
    east: east * arcminutesPerRadian,
    north: north * arcminutesPerRadian,
    total: Math.hypot(east, north) * arcminutesPerRadian,
  }
}
