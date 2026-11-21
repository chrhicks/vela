import { Schema } from 'effect'
import { described } from './described.ts'
import { frameDegrees } from './frame-field.ts'

export const FrameDrawingSettings = Schema.Struct({
  edgeSamples: described("How many points the horizon chart draws along each edge of the camera's footprint on the sky", Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)), 8),
})

export type FrameDrawingSettings = typeof FrameDrawingSettings.Type

export const frameDrawing: FrameDrawingSettings = Schema.decodeSync(FrameDrawingSettings)({})

export interface TangentOffset {
  readonly eastDegrees: number
  readonly northDegrees: number
}

export interface SkyPlace {
  readonly azimuthDegrees: number
  readonly altitudeDegrees: number
}

const radians = Math.PI / 180
const degrees = 180 / Math.PI

export function boxOutline(cameraAngleDegrees: number | null, edgeSamples: number): ReadonlyArray<TangentOffset> {
  const halfWidth = frameDegrees.width / 2
  const halfHeight = frameDegrees.height / 2
  const corners = [
    { x: -halfWidth, y: halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: -halfWidth, y: -halfHeight },
  ]
  const turn = (cameraAngleDegrees ?? 0) * radians
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)

  return corners.flatMap((from, index) => {
    const to = corners[(index + 1) % corners.length]!

    return Array.from({ length: edgeSamples }, (_, step) => {
      const along = step / edgeSamples
      const x = from.x + (to.x - from.x) * along
      const y = from.y + (to.y - from.y) * along

      return { eastDegrees: -(x * cos + y * sin), northDegrees: -x * sin + y * cos }
    })
  })
}

export function bearingBetween(from: SkyPlace, to: SkyPlace): number {
  const first = from.altitudeDegrees * radians
  const second = to.altitudeDegrees * radians
  const across = (to.azimuthDegrees - from.azimuthDegrees) * radians

  return Math.atan2(Math.sin(across) * Math.cos(second), Math.cos(first) * Math.sin(second) - Math.sin(first) * Math.cos(second) * Math.cos(across)) * degrees
}

export function footprintOf(centre: SkyPlace, northAngleDegrees: number, cameraAngleDegrees: number | null, edgeSamples: number): ReadonlyArray<SkyPlace> {
  const altitude = centre.altitudeDegrees * radians

  return boxOutline(cameraAngleDegrees, edgeSamples).map(({ eastDegrees, northDegrees }) => {
    const distance = Math.atan(Math.hypot(eastDegrees, northDegrees) * radians)
    const bearing = northAngleDegrees * radians - Math.atan2(eastDegrees, northDegrees)
    const raised = Math.asin(Math.max(-1, Math.min(1, Math.sin(altitude) * Math.cos(distance) + Math.cos(altitude) * Math.sin(distance) * Math.cos(bearing))))
    const aside = Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(altitude), Math.cos(distance) - Math.sin(altitude) * Math.sin(raised))

    return { azimuthDegrees: centre.azimuthDegrees + aside * degrees, altitudeDegrees: raised * degrees }
  })
}
