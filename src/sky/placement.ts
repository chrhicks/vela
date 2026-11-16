import { Body, Equator, Observer, SiderealTime } from 'astronomy-engine'
import type { Site } from '../pointing/target.ts'
import type { Placement } from '../../state/targets.ts'
import { angularDistance } from '../../state/angles.ts'
import { toMount, type EquatorialPosition } from './coordinates.ts'

const radians = Math.PI / 180
const siderealHoursPerHour = 1.0027379093
const hourMs = 3_600_000

const signedHours = (hours: number) => ((((hours % 24) + 36) % 24) - 12)

export function moonPosition(site: Site, at: number): EquatorialPosition {
  const moon = Equator(Body.Moon, new Date(at), new Observer(site.latitudeDegrees, site.longitudeDegrees, site.elevationMeters), false, true)

  return { raDegrees: moon.ra * 15, decDegrees: moon.dec }
}

export function placementOf(targetJ2000: EquatorialPosition, site: Site, at: number, lineDegrees: number, moon: EquatorialPosition): Placement {
  const date = new Date(at)
  const ofDate = toMount(targetJ2000, date)
  const latitude = site.latitudeDegrees * radians
  const declination = ofDate.decDegrees * radians
  const hourAngle = signedHours(SiderealTime(date) + site.longitudeDegrees / 15 - ofDate.raDegrees / 15)
  const sineOfAltitude = Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle * 15 * radians)
  const cosineAtLine = (Math.sin(lineDegrees * radians) - Math.sin(latitude) * Math.sin(declination)) / (Math.cos(latitude) * Math.cos(declination))
  const altitudeDegrees = Math.asin(Math.max(-1, Math.min(1, sineOfAltitude))) / radians
  const moonDegrees = angularDistance(targetJ2000, moon)

  if (cosineAtLine <= -1) return { altitudeDegrees, lineDegrees, moonDegrees, line: { above: 'always' } }

  const hoursAtLine = cosineAtLine >= 1 ? 0 : Math.acos(cosineAtLine) / radians / 15

  if (Math.abs(hourAngle) >= hoursAtLine) return { altitudeDegrees, lineDegrees, moonDegrees, line: { above: 'no' } }

  return { altitudeDegrees, lineDegrees, moonDegrees, line: { above: 'until', until: Math.round(at + ((hoursAtLine - hourAngle) / siderealHoursPerHour) * hourMs) } }
}
