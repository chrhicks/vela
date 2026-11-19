import { Schema } from 'effect'
import type { SweepSettings } from './settings.ts'

export const PierSide = Schema.Literals(['PIER_WEST', 'PIER_EAST'])

export type PierSide = typeof PierSide.Type

export const Half = Schema.Literals(['east', 'west'])

export type Half = typeof Half.Type

export interface Column {
  readonly azimuthDegrees: number
  readonly half: Half
}

export interface Pose {
  readonly hourAngleDegrees: number
  readonly declinationDegrees: number
  readonly altitudeDegrees: number
  readonly azimuthDegrees: number
  readonly predictedPierSide: PierSide
}

export type MoveKind = 'column' | 'join' | 'return'

export interface Move {
  readonly column: number
  readonly kind: MoveKind
  readonly pose: Pose
  readonly flipExpected: boolean
}

export interface Latitude {
  readonly latitudeDegrees: number
}

type Axes = Pick<Pose, 'hourAngleDegrees' | 'declinationDegrees'>

type PathSettings = Pick<SweepSettings, 'legDegrees' | 'meridianLimitDegrees'>

const radians = Math.PI / 180
const degrees = 180 / Math.PI
const roundingSlack = 1e-9

export const predictedPierSide = (hourAngleDegrees: number, { meridianLimitDegrees }: Pick<SweepSettings, 'meridianLimitDegrees'>): PierSide =>
  hourAngleDegrees > meridianLimitDegrees ? 'PIER_EAST' : 'PIER_WEST'

const clamp = (value: number) => Math.max(-1, Math.min(1, value))

const wrapAzimuth = (azimuthDegrees: number) => ((azimuthDegrees % 360) + 360) % 360

const wrapHourAngle = (hourAngleDegrees: number) => (hourAngleDegrees > 180 ? hourAngleDegrees - 360 : hourAngleDegrees < -180 ? hourAngleDegrees + 360 : hourAngleDegrees)

export function poseOfAxes(axes: Axes, { latitudeDegrees }: Latitude, settings: Pick<SweepSettings, 'meridianLimitDegrees'>): Pose {
  const latitude = latitudeDegrees * radians
  const hourAngle = axes.hourAngleDegrees * radians
  const declination = axes.declinationDegrees * radians
  const altitude = Math.asin(clamp(Math.sin(declination) * Math.sin(latitude) + Math.cos(declination) * Math.cos(latitude) * Math.cos(hourAngle)))
  const azimuth = Math.atan2(-Math.sin(hourAngle) * Math.cos(declination), Math.sin(declination) * Math.cos(latitude) - Math.cos(declination) * Math.sin(latitude) * Math.cos(hourAngle))

  return {
    hourAngleDegrees: axes.hourAngleDegrees,
    declinationDegrees: axes.declinationDegrees,
    altitudeDegrees: altitude * degrees,
    azimuthDegrees: wrapAzimuth(azimuth * degrees),
    predictedPierSide: predictedPierSide(axes.hourAngleDegrees, settings),
  }
}

export function poseAt(altitudeDegrees: number, azimuthDegrees: number, { latitudeDegrees }: Latitude, settings: Pick<SweepSettings, 'meridianLimitDegrees'>): Pose {
  const latitude = latitudeDegrees * radians
  const altitude = altitudeDegrees * radians
  const azimuth = azimuthDegrees * radians
  const declination = Math.asin(clamp(Math.sin(altitude) * Math.sin(latitude) + Math.cos(altitude) * Math.cos(latitude) * Math.cos(azimuth)))
  const hourAngle = Math.atan2(-Math.sin(azimuth) * Math.cos(altitude), Math.sin(altitude) * Math.cos(latitude) - Math.cos(altitude) * Math.sin(latitude) * Math.cos(azimuth))
  const hourAngleDegrees = hourAngle * degrees

  return {
    hourAngleDegrees,
    declinationDegrees: declination * degrees,
    altitudeDegrees,
    azimuthDegrees,
    predictedPierSide: predictedPierSide(hourAngleDegrees, settings),
  }
}

export function columns({ columnDegrees }: Pick<SweepSettings, 'columnDegrees'>): ReadonlyArray<Column> {
  const stepsInHalf = Math.floor(180 / columnDegrees + roundingSlack)
  const steps = Array.from({ length: stepsInHalf + 1 }, (_, step) => step * columnDegrees)

  return [
    ...steps.map((step): Column => ({ azimuthDegrees: 180 - step, half: 'east' })),
    ...steps.slice(1).map((step): Column => ({ azimuthDegrees: 180 + step, half: 'west' })),
  ]
}

function hourAngleTurn(from: number, to: number, settings: Pick<SweepSettings, 'meridianLimitDegrees'>) {
  const direct = to - from
  const around = direct > 0 ? direct - 360 : direct + 360

  if (predictedPierSide(from, settings) === predictedPierSide(to, settings)) return direct

  return Math.abs(around) < Math.abs(direct) ? around : direct
}

export function legs(from: Pose, to: Pose, latitude: Latitude, settings: PathSettings): ReadonlyArray<Pose> {
  const hourAngleTurnDegrees = hourAngleTurn(from.hourAngleDegrees, to.hourAngleDegrees, settings)
  const declinationTurnDegrees = to.declinationDegrees - from.declinationDegrees
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(hourAngleTurnDegrees), Math.abs(declinationTurnDegrees)) / settings.legDegrees - roundingSlack))

  return Array.from({ length: steps }, (_, index) => {
    if (index === steps - 1) return to

    const fraction = (index + 1) / steps

    return poseOfAxes(
      {
        hourAngleDegrees: wrapHourAngle(from.hourAngleDegrees + hourAngleTurnDegrees * fraction),
        declinationDegrees: from.declinationDegrees + declinationTurnDegrees * fraction,
      },
      latitude,
      settings,
    )
  })
}

function altitudes(floorDegrees: number, ceilingDegrees: number, rowDegrees: number) {
  const stops = Math.floor((ceilingDegrees - floorDegrees) / rowDegrees + roundingSlack)
  const rows = Array.from({ length: stops + 1 }, (_, stop) => floorDegrees + stop * rowDegrees)

  return rows[rows.length - 1]! < ceilingDegrees - roundingSlack ? [...rows, ceilingDegrees] : rows
}

export function rehearsalPath(latitude: Latitude, settings: SweepSettings): ReadonlyArray<Move> {
  const rehearsed = columns({ columnDegrees: settings.rehearsal.columnDegrees })
  const rows = altitudes(settings.floorDegrees, settings.ceilingDegrees, settings.rehearsal.rowDegrees)
  const poses = rehearsed.flatMap((column, index) => {
    const ordered = index % 2 === 0 ? rows : [...rows].reverse()

    return ordered.map(altitude => ({ column: index, half: column.half, pose: poseAt(altitude, column.azimuthDegrees, latitude, settings) }))
  })
  const moves: Move[] = []

  poses.forEach((stop, index) => {
    const previous = poses[index - 1]
    const kind: MoveKind = previous === undefined || previous.column === stop.column ? 'column' : previous.half !== stop.half ? 'return' : 'join'
    const reached = previous === undefined ? [stop.pose] : legs(previous.pose, stop.pose, latitude, settings)

    for (const pose of reached) {
      const before = moves[moves.length - 1]?.pose ?? previous?.pose

      moves.push({ column: stop.column, kind, pose, flipExpected: before !== undefined && before.predictedPierSide !== pose.predictedPierSide })
    }
  })

  return moves
}
