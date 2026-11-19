import { Horizon, Observer } from 'astronomy-engine'
import type { Site } from '../pointing/target.ts'

export interface Aim {
  readonly altitudeDegrees: number
  readonly azimuthDegrees: number
}

export function aimAt(site: Site, raHours: number, decDegrees: number, at: number): Aim {
  const { altitude, azimuth } = Horizon(new Date(at), new Observer(site.latitudeDegrees, site.longitudeDegrees, site.elevationMeters), raHours, decDegrees, 'normal')

  return { altitudeDegrees: Math.round(altitude), azimuthDegrees: Math.round(azimuth) % 360 }
}
