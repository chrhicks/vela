import { EquatorFromVector, Observer, Rotation_EQD_HOR, Rotation_EQJ_HOR, Rotation_HOR_EQD, RotateVector, MakeTime, Spherical, Vector, VectorFromSphere } from 'astronomy-engine'
import type { Site } from '../pointing/target.ts'

export interface EquatorialOfDate {
  readonly raHours: number
  readonly decDegrees: number
}

const radians = Math.PI / 180

export function equatorialOfDate(altitudeDegrees: number, azimuthDegrees: number, at: number, site: Site): EquatorialOfDate {
  const date = new Date(at)
  const altitude = altitudeDegrees * radians
  const azimuth = azimuthDegrees * radians
  const horizontal = new Vector(Math.cos(altitude) * Math.cos(azimuth), -Math.cos(altitude) * Math.sin(azimuth), Math.sin(altitude), MakeTime(date))
  const equatorial = EquatorFromVector(RotateVector(Rotation_HOR_EQD(date, new Observer(site.latitudeDegrees, site.longitudeDegrees, site.elevationMeters)), horizontal))

  return { raHours: ((equatorial.ra % 24) + 24) % 24, decDegrees: equatorial.dec }
}

export interface Horizontal {
  readonly altitudeDegrees: number
  readonly azimuthDegrees: number
}

const degrees = 180 / Math.PI

const horizontalOf = (vector: Vector): Horizontal => ({
  altitudeDegrees: Math.asin(Math.max(-1, Math.min(1, vector.z))) * degrees,
  azimuthDegrees: ((Math.atan2(-vector.y, vector.x) * degrees) % 360 + 360) % 360,
})

export function horizontalOfJ2000(position: { readonly raDegrees: number; readonly decDegrees: number }, at: number, site: Site): Horizontal {
  const date = new Date(at)

  return horizontalOf(RotateVector(Rotation_EQJ_HOR(date, new Observer(site.latitudeDegrees, site.longitudeDegrees, site.elevationMeters)), VectorFromSphere(new Spherical(position.decDegrees, position.raDegrees, 1), date)))
}

export function horizontalOfDate(position: EquatorialOfDate, at: number, site: Site): Horizontal {
  const date = new Date(at)

  return horizontalOf(RotateVector(Rotation_EQD_HOR(date, new Observer(site.latitudeDegrees, site.longitudeDegrees, site.elevationMeters)), VectorFromSphere(new Spherical(position.decDegrees, position.raHours * 15, 1), date)))
}
