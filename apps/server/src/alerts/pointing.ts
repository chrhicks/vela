import { wrapHours, type MountReading, type SkyPoint } from './rules.js'

const radians = Math.PI / 180

/**
 * Where a topocentric mount points: geometric altitude and azimuth (0 at north, increasing eastward)
 * from its right ascension, declination, sidereal time and latitude, with no refraction. Null unless
 * the reading has all four.
 */
export function skyPointOf(reading: MountReading): SkyPoint | null {
  const { rightAscensionHours, declinationDegrees, siderealTimeHours, latitudeDegrees } = reading

  if (
    rightAscensionHours === null ||
    declinationDegrees === null ||
    siderealTimeHours === null ||
    latitudeDegrees === null
  )
    return null

  const hourAngle = wrapHours(siderealTimeHours - rightAscensionHours) * 15 * radians
  const dec = declinationDegrees * radians
  const lat = latitudeDegrees * radians

  const sinAltitude = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(hourAngle)

  const azimuth = Math.atan2(
    -Math.cos(dec) * Math.sin(hourAngle),
    Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(hourAngle),
  )

  return {
    altitudeDegrees: Math.asin(Math.max(-1, Math.min(1, sinAltitude))) / radians,
    azimuthDegrees: (((azimuth / radians) % 360) + 360) % 360,
  }
}
