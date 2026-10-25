import { Body, Equator, Horizon, Observer, SearchAltitude } from 'astronomy-engine'
import type { Site } from './coordinates.js'

/** Astronomical darkness: the sun this far below the horizon or lower. */
export const astronomicalDarkDegrees = -18

/** How far ahead to look for the sun to cross. A summer at high latitude has no crossing at all. */
const searchDays = 2

const observerAt = ({ latitudeDegrees, longitudeDegrees, elevationMeters }: Site) =>
  new Observer(latitudeDegrees, longitudeDegrees, elevationMeters ?? 0)

/** The sun's apparent altitude without refraction, which is how twilight is defined. */
export function sunAltitudeDegrees(site: Site, at: Date): number {
  const observer = observerAt(site)
  const sun = Equator(Body.Sun, at, observer, true, true)

  return Horizon(at, observer, sun.ra, sun.dec).altitude
}

/**
 * Where the sun is relative to astronomical darkness, and the next times that changes.
 * A null time means the sun does not cross within two days.
 */
export type DarkOutlook =
  | { dark: true; until: Date | null }
  | { dark: false; from: Date | null; until: Date | null }

export function darkOutlook(site: Site, at: Date): DarkOutlook {
  const observer = observerAt(site)

  if (sunAltitudeDegrees(site, at) < astronomicalDarkDegrees)
    return { dark: true, until: SearchAltitude(Body.Sun, observer, 1, at, searchDays, astronomicalDarkDegrees)?.date ?? null }

  const from = SearchAltitude(Body.Sun, observer, -1, at, searchDays, astronomicalDarkDegrees)?.date ?? null

  return {
    dark: false,
    from,
    until: from && (SearchAltitude(Body.Sun, observer, 1, from, searchDays, astronomicalDarkDegrees)?.date ?? null),
  }
}
