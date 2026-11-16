import { skyPositionAt, surveyPixelDegrees, tileAt, type SkyPosition } from './sky-cut.ts'

export interface PlaneOffset {
  readonly eastDegrees: number
  readonly northDegrees: number
}

export interface PlaneView extends PlaneOffset {
  readonly widthDegrees: number
  readonly heightDegrees: number
}

const radians = Math.PI / 180
const eighthTurn = Math.PI / 4
const ringOfFace: ReadonlyArray<number> = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]
const turnOfFace: ReadonlyArray<number> = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7]

export const meshCells = 16

const samplesPerTileSide = 4
const marginTileSides = 0.5
const valuesPerCorner = 4

function unwoven(woven: number, bits: number) {
  let x = 0
  let y = 0

  for (let bit = 0; bit < bits; bit += 1) {
    x |= ((woven >> (2 * bit)) & 1) << bit
    y |= ((woven >> (2 * bit + 1)) & 1) << bit
  }

  return { x, y }
}

function skyOfFacePoint(face: number, x: number, y: number): SkyPosition {
  const ring = ringOfFace[face]! - x - y
  const inBelt = ring >= 1 && ring <= 3
  const reach = inBelt ? 1 : ring < 1 ? ring : 4 - ring
  const z = inBelt ? ((2 - ring) * 2) / 3 : ring < 1 ? 1 - (reach * reach) / 3 : (reach * reach) / 3 - 1
  const level = inBelt ? Math.sqrt(1 - z * z) : reach * Math.sqrt((1 + Math.abs(z)) / 3)
  const eighths = (((turnOfFace[face]! * reach + x - y) % 8) + 8) % 8

  return { raDegrees: reach === 0 ? 0 : (eighthTurn * eighths) / reach / radians, decDegrees: Math.atan2(z, level) / radians }
}

export function skyOfTilePoint(order: number, tile: number, across: number, down: number): SkyPosition {
  const tilesPerFace = 4 ** order
  const tilesPerSide = 2 ** order
  const { x, y } = unwoven(tile % tilesPerFace, order)

  return skyOfFacePoint(Math.floor(tile / tilesPerFace), (x + down) / tilesPerSide, (y + across) / tilesPerSide)
}

export function planeOffsetOf(centre: SkyPosition, point: SkyPosition): PlaneOffset {
  const turn = (point.raDegrees - centre.raDegrees) * radians
  const sin0 = Math.sin(centre.decDegrees * radians)
  const cos0 = Math.cos(centre.decDegrees * radians)
  const sin1 = Math.sin(point.decDegrees * radians)
  const cos1 = Math.cos(point.decDegrees * radians)
  const facing = sin0 * sin1 + cos0 * cos1 * Math.cos(turn)

  return { eastDegrees: (cos1 * Math.sin(turn)) / facing / radians, northDegrees: (cos0 * sin1 - sin0 * cos1 * Math.cos(turn)) / facing / radians }
}

export function tileMesh(centre: SkyPosition, order: number, tile: number, cells: number): Float32Array {
  const corners = cells + 1
  const mesh = new Float32Array(corners * corners * valuesPerCorner)

  for (let row = 0; row < corners; row += 1) {
    for (let column = 0; column < corners; column += 1) {
      const across = column / cells
      const down = row / cells
      const { eastDegrees, northDegrees } = planeOffsetOf(centre, skyOfTilePoint(order, tile, across, down))

      mesh.set([eastDegrees, northDegrees, across, down], (row * corners + column) * valuesPerCorner)
    }
  }

  return mesh
}

export function meshTriangles(cells: number): Uint16Array {
  const corners = cells + 1
  const triangles = new Uint16Array(cells * cells * 6)

  for (let row = 0; row < cells; row += 1) {
    for (let column = 0; column < cells; column += 1) {
      const here = row * corners + column
      const below = here + corners

      triangles.set([here, here + 1, below + 1, here, below + 1, below], (row * cells + column) * 6)
    }
  }

  return triangles
}

export function tilesInView(centre: SkyPosition, view: PlaneView, order: number): ReadonlyArray<number> {
  const tileSide = surveyPixelDegrees(order, 1)
  const reachEast = view.widthDegrees / 2 + tileSide * marginTileSides
  const reachNorth = view.heightDegrees / 2 + tileSide * marginTileSides
  const columns = Math.ceil((2 * reachEast * samplesPerTileSide) / tileSide)
  const rows = Math.ceil((2 * reachNorth * samplesPerTileSide) / tileSide)
  const tiles = new Set<number>()

  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const east = view.eastDegrees - reachEast + (2 * reachEast * column) / columns
      const north = view.northDegrees - reachNorth + (2 * reachNorth * row) / rows

      tiles.add(tileAt(order, skyPositionAt(centre, east, north)))
    }
  }

  return [...tiles].sort((a, b) => a - b)
}
