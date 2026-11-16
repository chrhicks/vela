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
