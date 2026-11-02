import { SiderealTime } from 'astronomy-engine'
import type { Site } from './coordinates.ts'

/** The local apparent sidereal time at `at`, in degrees from 0 up to 360. */
export function localSiderealDegrees(at: Date, site: Site): number {
  if (
    !Number.isFinite(at.getTime()) ||
    !Number.isFinite(site.longitudeDegrees) ||
    Math.abs(site.longitudeDegrees) > 180 ||
    !Number.isFinite(site.latitudeDegrees) ||
    Math.abs(site.latitudeDegrees) > 90 ||
    (site.elevationMeters !== undefined && !Number.isFinite(site.elevationMeters))
  ) {
    throw new Error('Physical alignment requires a valid observing time and site')
  }

  return (((SiderealTime(at) * 15 + site.longitudeDegrees) % 360) + 360) % 360
}
