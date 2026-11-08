import {
  EquatorFromVector,
  RotateVector,
  Rotation_EQD_EQJ,
  Rotation_EQJ_EQD,
  Spherical,
  Vector,
  VectorFromSphere,
} from 'astronomy-engine'

export interface EquatorialPosition {
  raDegrees: number
  decDegrees: number
}

export interface Site {
  latitudeDegrees: number
  longitudeDegrees: number
  elevationMeters?: number
}

const radians = Math.PI / 180

const wrap = (degrees: number) => ((degrees % 360) + 360) % 360

function vector(position: EquatorialPosition, date: Date) {
  return VectorFromSphere(new Spherical(position.decDegrees, position.raDegrees, 1), date)
}

function position(value: Vector): EquatorialPosition {
  const equatorial = EquatorFromVector(value)

  return { raDegrees: wrap(equatorial.ra * 15), decDegrees: equatorial.dec }
}

export function toMount(positionJ2000: EquatorialPosition, date: Date): EquatorialPosition {
  return position(RotateVector(Rotation_EQJ_EQD(date), vector(positionJ2000, date)))
}

export function fromMount(mountPosition: EquatorialPosition, date: Date): EquatorialPosition {
  return position(RotateVector(Rotation_EQD_EQJ(date), vector(mountPosition, date)))
}

export function angularDistance(a: EquatorialPosition, b: EquatorialPosition): number {
  const dec1 = a.decDegrees * radians
  const dec2 = b.decDegrees * radians

  const half =
    Math.sin((dec2 - dec1) / 2) ** 2 +
    Math.cos(dec1) * Math.cos(dec2) * Math.sin(((b.raDegrees - a.raDegrees) * radians) / 2) ** 2

  return (2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, half))))) / radians
}
