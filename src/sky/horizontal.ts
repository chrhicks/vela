import { EquatorFromVector, Observer, Rotation_HOR_EQD, RotateVector, MakeTime, Vector } from 'astronomy-engine'
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
