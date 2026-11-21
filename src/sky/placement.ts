import { Body, Equator, Observer } from 'astronomy-engine'
import type { Site } from '../pointing/target.ts'
import type { Placement } from '../../state/targets.ts'
import { angularDistance } from '../../state/angles.ts'
import type { EquatorialPosition } from './coordinates.ts'
import { clearanceOf, lineAt, skyAlong, type HorizonLine } from './path.ts'

const secondMs = 1000

export function moonPosition(site: Site, at: number): EquatorialPosition {
  const moon = Equator(Body.Moon, new Date(at), new Observer(site.latitudeDegrees, site.longitudeDegrees, site.elevationMeters), false, true)

  return { raDegrees: moon.ra * 15, decDegrees: moon.dec }
}

export interface UpLine extends HorizonLine {
  readonly stepSeconds: number
  readonly lookAheadHours: number
}

export function placementOf(targetJ2000: EquatorialPosition, site: Site, at: number, up: UpLine, moon: EquatorialPosition): Placement {
  const sky = skyAlong(targetJ2000, site, at, up.stepSeconds)
  const clearance = (stepsAhead: number) => clearanceOf(sky(stepsAhead), up)

  const now = sky(0)
  const lineNow = lineAt(up, now.azimuthDegrees)
  const placed = { altitudeDegrees: now.altitudeDegrees, lineDegrees: lineNow.degrees, lineSource: lineNow.source, moonDegrees: angularDistance(targetJ2000, moon) }
  const steps = Math.ceil((up.lookAheadHours * 3600) / up.stepSeconds)
  const isAbove = placed.altitudeDegrees > placed.lineDegrees
  let before = placed.altitudeDegrees - placed.lineDegrees

  for (let step = 1; step <= steps; step += 1) {
    const clear = clearance(step)

    if (clear > 0 !== isAbove) {
      const crossing = Math.round(at + (step - 1 + before / (before - clear)) * up.stepSeconds * secondMs)
      const lineThere = lineAt(up, sky(step).azimuthDegrees)
      const there = { lineSource: lineThere.source, lineDegrees: lineThere.degrees }

      return { ...placed, line: isAbove ? { above: 'until', until: crossing, ...there } : { above: 'rises', at: crossing, ...there } }
    }

    before = clear
  }

  return { ...placed, line: { above: isAbove ? 'always' : 'no' } }
}
