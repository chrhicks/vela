import {
  BaryState, Body, C_AUDAY, EquatorFromVector, MakeTime, Observer, ObserverState,
  RotateVector, Rotation_EQD_EQJ, Rotation_EQJ_EQD, Spherical, Vector, VectorFromSphere,
} from 'astronomy-engine'

export interface EquatorialPosition { raDegrees: number, decDegrees: number }

export interface Site { latitudeDegrees: number, longitudeDegrees: number, elevationMeters?: number }

const radians = Math.PI / 180

const wrap = (degrees: number) => (degrees % 360 + 360) % 360

function vector(position: EquatorialPosition, date: Date) {
  return VectorFromSphere(new Spherical(position.decDegrees, position.raDegrees, 1), date)
}

function position(value: Vector): EquatorialPosition {
  const equatorial = EquatorFromVector(value)

  return { raDegrees: wrap(equatorial.ra * 15), decDegrees: equatorial.dec }
}

/** Distant catalog objects: precession/nutation plus annual and diurnal aberration.
 * Refraction is deliberately excluded from equatorial mount coordinates.
 * The first-order aberration remainder is below 0.01 arcsec; proper motion,
 * parallax and solar deflection are immaterial to these deep-sky centers.
 */
function aberration(value: Vector, date: Date, site: Site, direction: 1 | -1) {
  const earth = BaryState(Body.Earth, date)
  const observer = ObserverState(date, new Observer(site.latitudeDegrees, site.longitudeDegrees, site.elevationMeters ?? 0), false)
  const velocity = [earth.vx + observer.vx, earth.vy + observer.vy, earth.vz + observer.vz]
  const length = Math.hypot(value.x, value.y, value.z)
  const unit = [value.x / length, value.y / length, value.z / length]
  const beta = velocity.map(v => v / C_AUDAY * direction)
  const dot = unit.reduce((sum, component, index) => sum + component * beta[index]!, 0)

  return new Vector(unit[0]! + beta[0]! - dot * unit[0]!, unit[1]! + beta[1]! - dot * unit[1]!, unit[2]! + beta[2]! - dot * unit[2]!, MakeTime(date))
}

export function toMount(positionJ2000: EquatorialPosition, frame: string, date: Date, site: Site): EquatorialPosition {
  if (frame === 'j2000') return { ...positionJ2000 }

  if (frame !== 'topocentric') throw new Error(`Mount coordinate frame ${frame} is not supported for framing`)

  return position(RotateVector(Rotation_EQJ_EQD(date), aberration(vector(positionJ2000, date), date, site, 1)))
}

export function fromMount(mountPosition: EquatorialPosition, frame: string, date: Date, site: Site): EquatorialPosition {
  if (frame === 'j2000') return { ...mountPosition }

  if (frame !== 'topocentric') throw new Error(`Mount coordinate frame ${frame} is not supported for framing`)

  return position(aberration(RotateVector(Rotation_EQD_EQJ(date), vector(mountPosition, date)), date, site, -1))
}

export function angularDistance(a: EquatorialPosition, b: EquatorialPosition): number {
  const dec1 = a.decDegrees * radians
  const dec2 = b.decDegrees * radians
  const half = Math.sin((dec2 - dec1) / 2) ** 2 + Math.cos(dec1) * Math.cos(dec2) * Math.sin((b.raDegrees - a.raDegrees) * radians / 2) ** 2

  return 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, half)))) / radians
}
