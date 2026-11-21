import type { Site } from '../pointing/target.ts'
import { Compass, type ClearSpell, type HorizonNight, type SpellEdge, type TargetPath } from '../../state/horizon-night.ts'
import type { EquatorialPosition } from './coordinates.ts'
import type { NightTimes } from './darkness.ts'
import { clearanceOf, lineAt, siderealHoursPerHour, skyAlong, type HorizonLine } from './path.ts'

export interface TargetNightInput {
  readonly target: EquatorialPosition
  readonly site: Site
  readonly night: NightTimes
  readonly at: number
  readonly line: HorizonLine
  readonly stepSeconds: number
  readonly decimals: number
  readonly meridianLimitDegrees: number | undefined
}

export interface TargetNight {
  readonly path: TargetPath
  readonly clear: ReadonlyArray<ClearSpell>
  readonly facts: HorizonNight['facts']
}

const secondMs = 1000
const degreesPerCompassPoint = 45
const hoursPerDay = 24
const degreesPerHour = 15
const secondsPerHour = 3600

const wrapped = (degrees: number) => ((degrees % 360) + 360) % 360

const rounder = (decimals: number) => {
  const scale = 10 ** decimals

  return (value: number) => Math.round(value * scale) / scale
}

export const compassOf = (azimuthDegrees: number) => Compass.literals[Math.round(wrapped(azimuthDegrees) / degreesPerCompassPoint) % Compass.literals.length]!

export function targetNight({ target, site, night, at, line, stepSeconds, decimals, meridianLimitDegrees }: TargetNightInput): TargetNight {
  const round = rounder(decimals)
  const stepMs = stepSeconds * secondMs
  const sky = skyAlong(target, site, night.duskAt, stepSeconds)
  const stepsAt = (time: number) => (time - night.duskAt) / stepMs
  const count = Math.floor((night.dawnAt - night.duskAt) / stepMs) + 1
  const points = Array.from({ length: count }, (_, index) => sky(index))
  const timeOf = (index: number) => Math.round(night.duskAt + index * stepMs)

  const path: TargetPath = {
    startAt: night.duskAt,
    stepSeconds,
    altitudes: points.map(point => round(point.altitudeDegrees)),
    azimuths: points.map(point => round(wrapped(point.azimuthDegrees)) % 360),
    lines: points.map(point => round(lineAt(line, point.azimuthDegrees).degrees)),
  }

  const edgeAt = (time: number): SpellEdge => {
    const { azimuthDegrees } = sky(stepsAt(time))
    const here = lineAt(line, azimuthDegrees)
    const azimuth = round(wrapped(azimuthDegrees)) % 360

    if (here.degrees <= 0) return { cause: 'horizon', azimuthDegrees: azimuth }

    return here.source === 'horizon' ? { cause: 'trees', azimuthDegrees: azimuth, compass: compassOf(azimuthDegrees) } : { cause: 'up-line', azimuthDegrees: azimuth }
  }

  const clearanceAt = (time: number) => clearanceOf(sky(stepsAt(time)), line)

  const spellsWithin = (from: number, until: number) => {
    const firstStep = Math.floor(stepsAt(from)) + 1
    const lastStep = Math.ceil(stepsAt(until)) - 1
    const times = [from, ...Array.from({ length: Math.max(0, lastStep - firstStep + 1) }, (_, index) => night.duskAt + (firstStep + index) * stepMs), until]
    const spells: Array<ClearSpell> = []
    let opened: { readonly from: number; readonly startedBy: SpellEdge } | undefined = clearanceAt(from) > 0 ? { from, startedBy: { cause: 'dark' } } : undefined
    let before = clearanceAt(from)
    let beforeAt = from

    for (const time of times.slice(1)) {
      const now = clearanceAt(time)

      if (now > 0 !== before > 0) {
        const crossing = Math.round(beforeAt + ((time - beforeAt) * before) / (before - now))

        if (opened === undefined) opened = { from: crossing, startedBy: edgeAt(crossing) }
        else {
          spells.push({ from: opened.from, until: crossing, startedBy: opened.startedBy, endedBy: edgeAt(crossing) })
          opened = undefined
        }
      }

      before = now
      beforeAt = time
    }

    if (opened !== undefined) spells.push({ from: opened.from, until, startedBy: opened.startedBy, endedBy: { cause: 'dark' } })

    return spells
  }

  const clear = night.darkAt === undefined || night.darkEndsAt === undefined ? [] : spellsWithin(night.darkAt, night.darkEndsAt)
  const spell = clear.find(candidate => candidate.from <= at && at <= candidate.until)
  const next = clear.find(candidate => candidate.from > at)
  const found = spell ?? next

  const highestIndex = points.reduce((best, point, index) => (point.altitudeDegrees > points[best]!.altitudeDegrees ? index : best), 0)
  const transitIndex = highestIndex > 0 && highestIndex < count - 1 ? highestIndex : undefined

  const transitAt = (index: number) => {
    const low = points[index - 1]!.altitudeDegrees
    const top = points[index]!.altitudeDegrees
    const high = points[index + 1]!.altitudeDegrees
    const curve = low - 2 * top + high

    return Math.round(night.duskAt + (index + (curve === 0 ? 0 : (0.5 * (low - high)) / curve)) * stepMs)
  }

  const limitHours = (meridianLimitDegrees ?? 0) / degreesPerHour
  const flipAt = Math.round(night.duskAt + ((((((limitHours - points[0]!.hourAngleHours) % hoursPerDay) + hoursPerDay) % hoursPerDay) * secondsPerHour) / siderealHoursPerHour) * secondMs)

  return {
    path,
    clear,
    facts: {
      clear: found === undefined ? null : { which: spell === undefined ? 'next' : 'now', clearsAt: found.from, startedBy: found.startedBy, clearForSeconds: Math.round((found.until - found.from) / secondMs), endsAt: found.until, endedBy: found.endedBy },
      highest: { altitudeDegrees: round(points[highestIndex]!.altitudeDegrees), at: timeOf(highestIndex) },
      transitAt: transitIndex === undefined ? null : transitAt(transitIndex),
      flip: flipAt > night.dawnAt ? null : { at: flipAt, basis: meridianLimitDegrees === undefined ? 'meridian' : 'mount-limit', limitDegrees: meridianLimitDegrees ?? null },
    },
  }
}
