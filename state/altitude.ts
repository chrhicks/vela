import { greenwichSiderealHours } from './flip.ts'
import type { Mount } from './devices.ts'

const radians = (degrees: number) => (degrees * Math.PI) / 180

export function altitudeDegrees(mount: Mount, at: number | undefined): number | undefined {
  const pointing = mount.EQUATORIAL_EOD_COORD?.values
  const site = mount.GEOGRAPHIC_COORD?.values

  if (at === undefined || pointing === undefined || site === undefined) return undefined

  const hourAngle = radians((greenwichSiderealHours(at) + site.LONG / 15 - pointing.RA) * 15)
  const sine = Math.sin(radians(site.LAT)) * Math.sin(radians(pointing.DEC)) + Math.cos(radians(site.LAT)) * Math.cos(radians(pointing.DEC)) * Math.cos(hourAngle)

  return (Math.asin(Math.max(-1, Math.min(1, sine))) * 180) / Math.PI
}
