import { Body, Observer, SearchAltitude } from 'astronomy-engine'
import type { Site } from '../pointing/target.ts'

export interface NightTimes {
  readonly duskAt: number
  readonly darkAt: number | undefined
  readonly darkEndsAt: number | undefined
  readonly dawnAt: number
}

const civilTwilightDegrees = -6
const astronomicalTwilightDegrees = -18
const hourMs = 3_600_000

function sunCrossing(observer: Observer, direction: 1 | -1, fromMs: number, altitude: number) {
  const found = SearchAltitude(Body.Sun, observer, direction, new Date(fromMs), 2, altitude)

  return found === null ? undefined : found.date.getTime()
}

export function nightTimes(site: Site, now: number): NightTimes | undefined {
  const observer = new Observer(site.latitudeDegrees, site.longitudeDegrees, site.elevationMeters)
  let duskAt = sunCrossing(observer, -1, now - 14 * hourMs, civilTwilightDegrees)
  let dawnAt = duskAt === undefined ? undefined : sunCrossing(observer, 1, duskAt, civilTwilightDegrees)

  if (dawnAt !== undefined && dawnAt < now) {
    duskAt = sunCrossing(observer, -1, dawnAt, civilTwilightDegrees)
    dawnAt = duskAt === undefined ? undefined : sunCrossing(observer, 1, duskAt, civilTwilightDegrees)
  }

  if (duskAt === undefined || dawnAt === undefined) return undefined

  const darkAt = sunCrossing(observer, -1, duskAt, astronomicalTwilightDegrees)
  const darkEndsAt = darkAt === undefined || darkAt > dawnAt ? undefined : sunCrossing(observer, 1, darkAt, astronomicalTwilightDegrees)

  return darkAt === undefined || darkAt > dawnAt || darkEndsAt === undefined || darkEndsAt > dawnAt
    ? { duskAt, darkAt: undefined, darkEndsAt: undefined, dawnAt }
    : { duskAt, darkAt, darkEndsAt, dawnAt }
}
