import { describe, expect, it } from 'vitest'
import { cutPlan, skyPositionAt, surveyPixelDegrees, tilesOf, type SkyPosition } from './sky-cut.ts'
import { meshCells, meshTriangles, planeOffsetOf, skyOfTilePoint, tileMesh, tilesInView } from './sky-mesh.ts'

const tileWidth = 512
const screen = { width: 1440, height: 900 }
const fitScale = 23 / 3600
const fullScale = surveyPixelDegrees(7, tileWidth)

const fields: ReadonlyArray<readonly [name: string, centre: SkyPosition]> = [
  ['triangulum', { raDegrees: 23.4621, decDegrees: 30.6599 }],
  ['bubble', { raDegrees: 350.2012, decDegrees: 61.2017 }],
  ['orion', { raDegrees: 83.8221, decDegrees: -5.3911 }],
  ['south', { raDegrees: 10, decDegrees: -80 }],
  ['pole', { raDegrees: 40, decDegrees: 89 }],
  ['wrap', { raDegrees: 0.5, decDegrees: 20 }],
]

const views: ReadonlyArray<readonly [name: string, order: number, degreesPerPixel: number]> = [
  ['the coarse survey at fit', 4, fitScale],
  ['the fine survey at 1:1', 7, fullScale],
]

const apart = (a: SkyPosition, b: SkyPosition) => {
  const { eastDegrees, northDegrees } = planeOffsetOf(a, b)

  return Math.hypot(eastDegrees, northDegrees)
}

describe('where a tile is on the sky', () => {
  it.each(fields)('puts each pixel of a cut around %s back where the cut took it from, to within a survey pixel', (_name, centre) => {
    for (const [, order, degreesPerPixel] of views) {
      const cut = { ...centre, widthDegrees: degreesPerPixel * 96, widthPixels: 96, heightPixels: 60, order, tileWidth }
      const plan = cutPlan(cut)

      for (let at = 0; at < plan.tiles.length; at += 7) {
        const east = -((at % cut.widthPixels) + 0.5 - cut.widthPixels / 2) * degreesPerPixel
        const north = -(Math.floor(at / cut.widthPixels) + 0.5 - cut.heightPixels / 2) * degreesPerPixel
        const found = skyOfTilePoint(order, plan.tiles[at]!, (plan.columns[at]! + 0.5) / tileWidth, (plan.rows[at]! + 0.5) / tileWidth)

        expect(apart(skyPositionAt(centre, east, north), found)).toBeLessThan(surveyPixelDegrees(order, tileWidth))
      }
    }
  })

  it('finds the offset of a point on the plane that skyPositionAt turns back into the point', () => {
    const centre = { raDegrees: 23.4621, decDegrees: 30.6599 }
    const offset = planeOffsetOf(centre, skyPositionAt(centre, 1.25, -0.75))

    expect(offset.eastDegrees).toBeCloseTo(1.25, 9)
    expect(offset.northDegrees).toBeCloseTo(-0.75, 9)
  })
})

describe('a tile as a mesh on the plane', () => {
  const worstMiss = (centre: SkyPosition, order: number, degreesPerPixel: number) => {
    const view = { eastDegrees: 0, northDegrees: 0, widthDegrees: screen.width * degreesPerPixel, heightDegrees: screen.height * degreesPerPixel }
    const corners = meshCells + 1
    let worst = 0

    for (const tile of tilesInView(centre, view, order)) {
      const mesh = tileMesh(centre, order, tile, meshCells)

      for (let row = 0; row < meshCells; row += 1) {
        for (let column = 0; column < meshCells; column += 1) {
          const here = (row * corners + column) * 4
          const opposite = ((row + 1) * corners + column + 1) * 4
          const truly = planeOffsetOf(centre, skyOfTilePoint(order, tile, (column + 0.5) / meshCells, (row + 0.5) / meshCells))

          worst = Math.max(worst, Math.hypot((mesh[here]! + mesh[opposite]!) / 2 - truly.eastDegrees, (mesh[here + 1]! + mesh[opposite + 1]!) / 2 - truly.northDegrees) / degreesPerPixel)
        }
      }
    }

    return worst
  }

  it.each(fields.filter(([name]) => name !== 'pole'))('stays within half a screen pixel of the true sky around %s, along the line that splits each cell', (_name, centre) => {
    for (const [, order, degreesPerPixel] of views) expect(worstMiss(centre, order, degreesPerPixel)).toBeLessThan(0.5)
  })

  it('is off by a pixel and a half at most in the cells that touch the pole, where four faces meet in a point', () => {
    for (const [, order, degreesPerPixel] of views) {
      const miss = worstMiss({ raDegrees: 40, decDegrees: 89 }, order, degreesPerPixel)

      expect(miss).toBeGreaterThan(0.5)
      expect(miss).toBeLessThan(1.5)
    }
  })

  it('carries each corner with its place in the tile picture, and two triangles a cell', () => {
    const mesh = tileMesh({ raDegrees: 23.4621, decDegrees: 30.6599 }, 4, 1000, 2)

    expect([...mesh.filter((_value, at) => at % 4 >= 2)]).toEqual([0, 0, 0.5, 0, 1, 0, 0, 0.5, 0.5, 0.5, 1, 0.5, 0, 1, 0.5, 1, 1, 1])
    expect([...meshTriangles(1)]).toEqual([0, 1, 3, 0, 3, 2])
    expect(meshTriangles(meshCells)).toHaveLength(meshCells * meshCells * 6)
  })
})

describe('the tiles a view needs', () => {
  it.each(fields)('holds every tile an exact cut of the screen around %s takes pixels from', (_name, centre) => {
    for (const [, order, degreesPerPixel] of views) {
      const exact = tilesOf(cutPlan({ ...centre, widthDegrees: screen.width * degreesPerPixel, widthPixels: screen.width / 4, heightPixels: screen.height / 4, order, tileWidth }))
      const needed = tilesInView(centre, { eastDegrees: 0, northDegrees: 0, widthDegrees: screen.width * degreesPerPixel, heightDegrees: screen.height * degreesPerPixel }, order)

      expect(needed).toEqual(expect.arrayContaining([...exact]))
    }
  })

  it('asks for 17 coarse tiles at fit and 19 fine tiles at 1:1 around M 33, the screen and half a tile around it', () => {
    const centre = { raDegrees: 23.4621, decDegrees: 30.6599 }
    const counts = views.map(([, order, degreesPerPixel]) => tilesInView(centre, { eastDegrees: 0, northDegrees: 0, widthDegrees: screen.width * degreesPerPixel, heightDegrees: screen.height * degreesPerPixel }, order).length)

    expect(counts).toEqual([17, 19])
  })
})
