import { SiderealTime } from 'astronomy-engine'
import type { Site } from '../pointing/target.ts'
import type { LineSource } from '../../state/targets.ts'
import { altitudeAt, type Horizon } from '../horizon/horizon.ts'
import { toMount, type EquatorialPosition } from './coordinates.ts'
import type { NightTimes } from './darkness.ts'

const radians = Math.PI / 180

export const siderealHoursPerHour = 1.0027379093

const secondMs = 1000

export const wrapped = (degrees: number) => ((degrees % 360) + 360) % 360

export const rounder = (decimals: number) => {
  const scale = 10 ** decimals

  return (value: number) => Math.round(value * scale) / scale
}

export const stepCountOf = (night: NightTimes, stepSeconds: number) => Math.floor((night.dawnAt - night.duskAt) / (stepSeconds * secondMs)) + 1

const signedHours = (hours: number) => ((((hours % 24) + 36) % 24) - 12)

export interface HorizonLine {
  readonly horizon: Horizon
  readonly upLineDegrees: number
}

export interface SkyPoint {
  readonly altitudeDegrees: number
  readonly azimuthDegrees: number
  readonly hourAngleHours: number
}

export interface LineHere {
  readonly degrees: number
  readonly source: LineSource
}

export function lineAt(line: HorizonLine, azimuthDegrees: number): LineHere {
  const mapped = altitudeAt(line.horizon, azimuthDegrees)

  return mapped === null ? { degrees: line.upLineDegrees, source: 'up-line' } : { degrees: mapped, source: 'horizon' }
}

export const clearanceOf = (point: SkyPoint, line: HorizonLine) => point.altitudeDegrees - lineAt(line, point.azimuthDegrees).degrees

export function skyAlong(targetJ2000: EquatorialPosition, site: Site, startAt: number, stepSeconds: number): (stepsAhead: number) => SkyPoint {
  const date = new Date(startAt)
  const ofDate = toMount(targetJ2000, date)
  const latitude = site.latitudeDegrees * radians
  const declination = ofDate.decDegrees * radians
  const hourAngleStart = signedHours(SiderealTime(date) + site.longitudeDegrees / 15 - ofDate.raDegrees / 15)
  const sinLatitude = Math.sin(latitude)
  const cosLatitude = Math.cos(latitude)
  const sinDeclination = Math.sin(declination)
  const cosDeclination = Math.cos(declination)

  return stepsAhead => {
    const hourAngleHours = hourAngleStart + (stepsAhead * stepSeconds * siderealHoursPerHour) / 3600
    const hourAngle = hourAngleHours * 15 * radians
    const altitudeDegrees = Math.asin(Math.max(-1, Math.min(1, sinLatitude * sinDeclination + cosLatitude * cosDeclination * Math.cos(hourAngle)))) / radians
    const azimuthDegrees = Math.atan2(-cosDeclination * Math.sin(hourAngle), sinDeclination * cosLatitude - cosDeclination * Math.cos(hourAngle) * sinLatitude) / radians

    return { altitudeDegrees, azimuthDegrees, hourAngleHours }
  }
}
