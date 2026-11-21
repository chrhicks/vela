import { boxOutline, bearingBetween, type SkyPlace } from '../../state/horizon-frame.ts'
import type { FrameNight } from '../../state/horizon-night.ts'
import type { Site } from '../pointing/target.ts'
import { skyOfPixel } from '../sweep/projection.ts'
import type { EquatorialPosition } from './coordinates.ts'
import type { NightTimes } from './darkness.ts'
import { horizontalsOfJ2000 } from './horizontal.ts'
import { lineAt, rounder, stepCountOf, type HorizonLine } from './path.ts'

export interface Footprint {
  readonly centre: SkyPlace
  readonly northAngleDegrees: number
  readonly outline: ReadonlyArray<SkyPlace>
}

export interface FrameNightInput {
  readonly target: EquatorialPosition
  readonly site: Site
  readonly night: NightTimes
  readonly line: HorizonLine
  readonly stepSeconds: number
  readonly angleDecimals: number
  readonly cameraAngleDegrees: number | undefined
  readonly edgeSamples: number
}

const secondMs = 1000
const halfTurn = 180
const fullTurn = 360
const unitPixel = { width: 1, height: 1 }
const northProbeDegrees = 0.001
const justBelow = 1e-9

const around = (centreAzimuth: number, azimuth: number) => centreAzimuth + ((((azimuth - centreAzimuth + halfTurn) % fullTurn) + fullTurn) % fullTurn) - halfTurn

export function footprintAt(target: EquatorialPosition, site: Site, at: number, cameraAngleDegrees: number | undefined, edgeSamples: number): Footprint {
  const geometry = { centre: target, rotationDegrees: 0, scaleArcsecPerPixel: 3600, size: unitPixel }
  const offsetBy = (eastDegrees: number, northDegrees: number) => skyOfPixel(geometry, { x: 1 + eastDegrees, y: 1 + northDegrees })
  const outline = boxOutline(cameraAngleDegrees ?? null, edgeSamples)
  const [centre, probe, ...edge] = horizontalsOfJ2000([target, offsetBy(0, northProbeDegrees), ...outline.map(point => offsetBy(point.eastDegrees, point.northDegrees))], at, site)

  return {
    centre: centre!,
    northAngleDegrees: bearingBetween(centre!, probe!),
    outline: edge.map(point => ({ azimuthDegrees: around(centre!.azimuthDegrees, point.azimuthDegrees), altitudeDegrees: point.altitudeDegrees })),
  }
}

const lowestAt = (outline: ReadonlyArray<SkyPlace>, azimuthDegrees: number): number | undefined => {
  let lowest: number | undefined

  outline.forEach((from, index) => {
    const to = outline[(index + 1) % outline.length]!
    const low = Math.min(from.azimuthDegrees, to.azimuthDegrees)
    const high = Math.max(from.azimuthDegrees, to.azimuthDegrees)

    if (azimuthDegrees < low || azimuthDegrees > high) return

    const altitude = high === low ? Math.min(from.altitudeDegrees, to.altitudeDegrees) : from.altitudeDegrees + ((to.altitudeDegrees - from.altitudeDegrees) * (azimuthDegrees - from.azimuthDegrees)) / (to.azimuthDegrees - from.azimuthDegrees)

    lowest = lowest === undefined ? altitude : Math.min(lowest, altitude)
  })

  return lowest
}

export function lowestClearance(outline: ReadonlyArray<SkyPlace>, line: HorizonLine): number {
  const azimuths = outline.map(point => point.azimuthDegrees)
  const first = Math.min(...azimuths)
  const last = Math.max(...azimuths)
  const wholeDegrees = Array.from({ length: Math.max(0, Math.floor(last) - Math.ceil(first) + 1) }, (_, index) => Math.ceil(first) + index)
  const candidates = [...azimuths, ...wholeDegrees, ...wholeDegrees.map(degrees => degrees - justBelow)]

  return Math.min(
    ...candidates.flatMap(azimuth => {
      const lowest = lowestAt(outline, azimuth)

      return lowest === undefined ? [] : [lowest - lineAt(line, azimuth).degrees]
    }),
  )
}

export function frameNight({ target, site, night, line, stepSeconds, angleDecimals, cameraAngleDegrees, edgeSamples }: FrameNightInput): FrameNight {
  const round = rounder(angleDecimals)
  const stepMs = stepSeconds * secondMs
  const northAngles = Array.from({ length: stepCountOf(night, stepSeconds) }, (_, index) => round(footprintAt(target, site, Math.round(night.duskAt + index * stepMs), cameraAngleDegrees, 1).northAngleDegrees))
  const clearAt = (time: number) => lowestClearance(footprintAt(target, site, time, cameraAngleDegrees, edgeSamples).outline, line) > 0

  const firstCleanAt = (): number | null => {
    if (night.darkAt === undefined || night.darkEndsAt === undefined) return null

    const firstStep = Math.floor((night.darkAt - night.duskAt) / stepMs) + 1
    const lastStep = Math.ceil((night.darkEndsAt - night.duskAt) / stepMs) - 1
    const times = [night.darkAt, ...Array.from({ length: Math.max(0, lastStep - firstStep + 1) }, (_, index) => night.duskAt + (firstStep + index) * stepMs), night.darkEndsAt]
    if (clearAt(times[0]!)) return night.darkAt

    for (const [index, time] of times.slice(1).entries()) {
      if (!clearAt(time)) continue

      let blocked = times[index]!
      let clear = time

      while (clear - blocked > secondMs) {
        const middle = Math.round((blocked + clear) / 2)

        if (clearAt(middle)) clear = middle
        else blocked = middle
      }

      return clear
    }

    return null
  }

  return { angleDegrees: cameraAngleDegrees ?? null, northAngles, firstCleanAt: firstCleanAt() }
}
