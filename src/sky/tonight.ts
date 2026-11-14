import { Body, Equator, Horizon, Illumination, Observer, SearchRiseSet } from 'astronomy-engine'
import type { Site } from '../pointing/target.ts'
import type { Sky } from '../../state/sky.ts'
import { nightTimes } from './darkness.ts'

const daysSearched = 2

export function skyTonight(site: Site, at: number): Sky {
  const date = new Date(at)
  const observer = new Observer(site.latitudeDegrees, site.longitudeDegrees, site.elevationMeters)
  const night = nightTimes(site, at)
  const moon = Equator(Body.Moon, date, observer, true, true)
  const up = Horizon(date, observer, moon.ra, moon.dec, 'normal').altitude > 0
  const change = SearchRiseSet(Body.Moon, observer, up ? -1 : 1, date, daysSearched)

  return {
    dark: night?.darkAt === undefined || night.darkEndsAt === undefined ? null : { from: night.darkAt, until: night.darkEndsAt },
    moon: { litFraction: Illumination(Body.Moon, date).phase_fraction, up, changesAt: change === null ? null : change.date.getTime() },
  }
}
