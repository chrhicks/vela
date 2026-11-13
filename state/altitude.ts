import { greenwichSiderealHours } from './flip.ts'
import type { Readings } from './readings.ts'

const radians = (degrees: number) => (degrees * Math.PI) / 180

export function altitudeDegrees(readings: Readings, at: number | undefined): number | undefined {
  const mount = readings['mount']
  const ra = mount?.['EQUATORIAL_EOD_COORD']?.values['RA']
  const dec = mount?.['EQUATORIAL_EOD_COORD']?.values['DEC']
  const latitude = mount?.['GEOGRAPHIC_COORD']?.values['LAT']
  const longitude = mount?.['GEOGRAPHIC_COORD']?.values['LONG']

  if (at === undefined || typeof ra !== 'number' || typeof dec !== 'number' || typeof latitude !== 'number' || typeof longitude !== 'number') return undefined

  const hourAngle = radians((greenwichSiderealHours(at) + longitude / 15 - ra) * 15)
  const sine = Math.sin(radians(latitude)) * Math.sin(radians(dec)) + Math.cos(radians(latitude)) * Math.cos(radians(dec)) * Math.cos(hourAngle)

  return (Math.asin(Math.max(-1, Math.min(1, sine))) * 180) / Math.PI
}
