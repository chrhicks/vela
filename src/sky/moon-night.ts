import { Body, Equator, Horizon, Illumination, Observer } from 'astronomy-engine'
import type { MoonNight, TimeSpan } from '../../state/horizon-night.ts'
import type { Site } from '../pointing/target.ts'
import type { NightTimes } from './darkness.ts'
import { rounder, stepCountOf, wrapped } from './path.ts'

export interface MoonNightInput {
  readonly site: Site
  readonly night: NightTimes
  readonly stepSeconds: number
  readonly decimals: number
}

const secondMs = 1000

export function moonNight({ site, night, stepSeconds, decimals }: MoonNightInput): MoonNight {
  const round = rounder(decimals)
  const observer = new Observer(site.latitudeDegrees, site.longitudeDegrees, site.elevationMeters)
  const stepMs = stepSeconds * secondMs
  const count = stepCountOf(night, stepSeconds)

  const at = (index: number) => {
    const date = new Date(night.duskAt + index * stepMs)
    const moon = Equator(Body.Moon, date, observer, true, true)

    return Horizon(date, observer, moon.ra, moon.dec, 'normal')
  }

  const points = Array.from({ length: count }, (_, index) => at(index))
  const upSpans: Array<TimeSpan> = []
  let opened: number | undefined = points[0]!.altitude > 0 ? night.duskAt : undefined

  for (let index = 1; index < count; index += 1) {
    const before = points[index - 1]!.altitude
    const now = points[index]!.altitude

    if (now > 0 === before > 0) continue

    const crossing = Math.round(night.duskAt + (index - 1 + before / (before - now)) * stepMs)

    if (opened === undefined) opened = crossing
    else {
      upSpans.push({ from: opened, until: crossing })
      opened = undefined
    }
  }

  if (opened !== undefined) upSpans.push({ from: opened, until: night.dawnAt })

  return {
    litFraction: round(Illumination(Body.Moon, new Date(Math.round((night.duskAt + night.dawnAt) / 2))).phase_fraction),
    altitudes: points.map(point => round(point.altitude)),
    azimuths: points.map(point => round(wrapped(point.azimuth)) % 360),
    upSpans,
  }
}
