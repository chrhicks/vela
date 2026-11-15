import { describe, expect, it } from 'vitest'
import { cutPlan, tilesOf, type SkyCut } from './sky-cut.ts'

const cutAt = (raDegrees: number, decDegrees: number): SkyCut => ({ raDegrees, decDegrees, widthDegrees: 7, widthPixels: 768, heightPixels: 512, order: 4, tileWidth: 512 })

const fields: ReadonlyArray<readonly [name: string, raDegrees: number, decDegrees: number, pixels: ReadonlyArray<ReadonlyArray<number>>]> = [
  ['bubble', 350.2012, 61.2017, [[0, 0, 895, 81, 408], [383, 255, 894, 161, 481], [767, 511, 894, 188, 30], [100, 400, 893, 161, 240], [700, 50, 980, 242, 181]]],
  ['orion', 83.8221, -5.3911, [[0, 0, 1342, 428, 451], [383, 255, 1339, 497, 397], [767, 511, 1424, 59, 341], [100, 400, 1339, 120, 493], [700, 50, 1425, 448, 334]]],
  ['south', 10.0, -80.0, [[0, 0, 2059, 56, 132], [383, 255, 2058, 18, 194], [767, 511, 2820, 238, 211], [100, 400, 2056, 91, 468], [700, 50, 2821, 88, 509]]],
  ['pole', 40.0, 89.0, [[0, 0, 511, 70, 300], [383, 255, 255, 434, 415], [767, 511, 1021, 240, 451], [100, 400, 253, 429, 499], [700, 50, 1023, 376, 120]]],
  ['wrap', 0.5, 20.0, [[0, 0, 1243, 405, 158], [383, 255, 1264, 7, 99], [767, 511, 1253, 101, 38], [100, 400, 1242, 136, 211], [700, 50, 1264, 475, 0]]],
]

describe('cutting a picture from sky survey tiles', () => {
  it.each(fields)('finds the tile and the pixel in it for each pixel of a field: %s', (_name, raDegrees, decDegrees, pixels) => {
    const plan = cutPlan(cutAt(raDegrees, decDegrees))

    for (const [column, row, tile, tileColumn, tileRow] of pixels) {
      const at = row! * 768 + column!

      expect([plan.tiles[at], plan.columns[at], plan.rows[at]]).toEqual([tile, tileColumn, tileRow])
    }
  })

  it('needs seven tiles for the field around the Bubble, and nine for one that holds the pole', () => {
    expect(tilesOf(cutPlan(cutAt(350.2012, 61.2017)))).toEqual([887, 892, 893, 894, 895, 980, 981])
    expect(tilesOf(cutPlan(cutAt(40, 89)))).toEqual([253, 254, 255, 510, 511, 767, 1021, 1022, 1023])
  })
})
