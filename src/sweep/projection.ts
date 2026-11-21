import { cellCentrePixel, type FrameSize, type Grid, type StarPosition } from './cells.ts'

export interface Position {
  readonly raDegrees: number
  readonly decDegrees: number
}

export interface FrameGeometry {
  readonly centre: Position
  readonly rotationDegrees: number
  readonly scaleArcsecPerPixel: number
  readonly size: FrameSize
}

const radians = Math.PI / 180

const degrees = 180 / Math.PI

export function skyOfPixel(geometry: FrameGeometry, pixel: StarPosition): Position {
  const { centre, rotationDegrees, scaleArcsecPerPixel, size } = geometry
  const scale = scaleArcsecPerPixel / 3600
  const rotation = rotationDegrees * radians
  const dx = pixel.x - (size.width + 1) / 2
  const dy = pixel.y - (size.height + 1) / 2
  const east = scale * (Math.cos(rotation) * dx - Math.sin(rotation) * dy) * radians
  const north = scale * (Math.sin(rotation) * dx + Math.cos(rotation) * dy) * radians
  const ra = centre.raDegrees * radians
  const dec = centre.decDegrees * radians
  const outward = Math.cos(dec) - north * Math.sin(dec)

  return {
    raDegrees: (((ra + Math.atan2(east, outward)) * degrees) % 360 + 360) % 360,
    decDegrees: Math.atan2(Math.sin(dec) + north * Math.cos(dec), Math.hypot(east, outward)) * degrees,
  }
}

export function cellCentres(geometry: FrameGeometry, grid: Grid): ReadonlyArray<Position> {
  return Array.from({ length: grid.columns * grid.rows }, (_, index) => skyOfPixel(geometry, cellCentrePixel(index % grid.columns, Math.floor(index / grid.columns), geometry.size, grid)))
}
