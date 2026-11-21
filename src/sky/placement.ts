import { Body, Equator, Observer, SiderealTime } from 'astronomy-engine'
import type { Site } from '../pointing/target.ts'
import type { Placement } from '../../state/targets.ts'
import { angularDistance } from '../../state/angles.ts'
import { altitudeAt, type Horizon } from '../horizon/horizon.ts'
import { toMount, type EquatorialPosition } from './coordinates.ts'

const radians = Math.PI / 180
const siderealHoursPerHour = 1.0027379093
const secondMs = 1000

const signedHours = (hours: number) => ((((hours % 24) + 36) % 24) - 12)

export function moonPosition(site: Site, at: number): EquatorialPosition {
  const moon = Equator(Body.Moon, new Date(at), new Observer(site.latitudeDegrees, site.longitudeDegrees, site.elevationMeters), false, true)

  return { raDegrees: moon.ra * 15, decDegrees: moon.dec }
}

export interface UpLine {
  readonly horizon: Horizon
  readonly upLineDegrees: number
  readonly stepSeconds: number
  readonly lookAheadHours: number
}

const lineAt = (up: UpLine, azimuthDegrees: number) => altitudeAt(up.horizon, azimuthDegrees) ?? up.upLineDegrees

export function placementOf(targetJ2000: EquatorialPosition, site: Site, at: number, up: UpLine, moon: EquatorialPosition): Placement {
  const date = new Date(at)
  const ofDate = toMount(targetJ2000, date)
  const latitude = site.latitudeDegrees * radians
  const declination = ofDate.decDegrees * radians
  const hourAngleNow = signedHours(SiderealTime(date) + site.longitudeDegrees / 15 - ofDate.raDegrees / 15)
  const sinLatitude = Math.sin(latitude)
  const cosLatitude = Math.cos(latitude)
  const sinDeclination = Math.sin(declination)
  const cosDeclination = Math.cos(declination)

  const sky = (stepsAhead: number) => {
    const hourAngle = (hourAngleNow + (stepsAhead * up.stepSeconds * siderealHoursPerHour) / 3600) * 15 * radians
    const altitudeDegrees = Math.asin(Math.max(-1, Math.min(1, sinLatitude * sinDeclination + cosLatitude * cosDeclination * Math.cos(hourAngle)))) / radians
    const azimuthDegrees = Math.atan2(-cosDeclination * Math.sin(hourAngle), sinDeclination * cosLatitude - cosDeclination * Math.cos(hourAngle) * sinLatitude) / radians

    return { altitudeDegrees, azimuthDegrees }
  }

  const clearance = (stepsAhead: number) => {
    const { altitudeDegrees, azimuthDegrees } = sky(stepsAhead)

    return altitudeDegrees - lineAt(up, azimuthDegrees)
  }

  const now = sky(0)
  const measured = altitudeAt(up.horizon, now.azimuthDegrees) !== null
  const placed = { altitudeDegrees: now.altitudeDegrees, lineDegrees: lineAt(up, now.azimuthDegrees), lineSource: measured ? ('horizon' as const) : ('up-line' as const), moonDegrees: angularDistance(targetJ2000, moon) }
  const steps = Math.ceil((up.lookAheadHours * 3600) / up.stepSeconds)
  const isAbove = placed.altitudeDegrees > placed.lineDegrees
  let before = placed.altitudeDegrees - placed.lineDegrees

  for (let step = 1; step <= steps; step += 1) {
    const clear = clearance(step)

    if (clear > 0 !== isAbove) {
      const crossing = Math.round(at + (step - 1 + before / (before - clear)) * up.stepSeconds * secondMs)

      return { ...placed, line: isAbove ? { above: 'until', until: crossing } : { above: 'rises', at: crossing } }
    }

    before = clear
  }

  return { ...placed, line: { above: isAbove ? 'always' : 'no' } }
}
