import { describe, expect, it } from 'vitest'
import type { SweepFrameBody, SweepId } from '../../state/entries.ts'
import { decodeConfig } from '../config.ts'
import { fromMount } from '../sky/coordinates.ts'
import { equatorialOfDate } from '../sky/horizontal.ts'
import { cellCount } from './cells.ts'
import { labelSweep, type MeasuredFrame } from './labelling.ts'
import { SweepSettings } from './settings.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const settings = decodeConfig(SweepSettings, { cells: { columns: 8, rows: 6 } })
const sweep = 'sweep-test' as SweepId
const size = { width: 6248, height: 4176 }
const scale = 1.94
const grid = { columns: 8, rows: 6 }
const start = Date.UTC(2026, 10, 9, 4, 0, 0)
const horizonDegrees = 15

const cellAltitude = (pointingAltitude: number, row: number) => pointingAltitude + (((row + 0.5) * size.height) / grid.rows + 0.5 - (size.height + 1) / 2) * (scale / 3600)

const frameAt = (index: number, pointingAltitude: number, solved: boolean, pierSide: 'PIER_WEST' | 'PIER_EAST' = 'PIER_WEST'): MeasuredFrame => {
  const at = start + index * 10000
  const ofDate = equatorialOfDate(pointingAltitude, 180, at, phoenix)
  const centre = fromMount({ raDegrees: ofDate.raHours * 15, decDegrees: ofDate.decDegrees }, new Date(at))
  const counts: Array<number> = Array.from({ length: cellCount(grid) }, (_, cell) => (cellAltitude(pointingAltitude, Math.floor(cell / grid.columns)) >= horizonDegrees ? 20 : 0))
  const record: SweepFrameBody = {
    sweep,
    column: 0,
    azimuthDegrees: 180,
    file: `frame_${index}.fits`,
    at,
    commanded: { altitudeDegrees: pointingAltitude, azimuthDegrees: 180, hourAngleDegrees: 0, declinationDegrees: 0 },
    TELESCOPE_PIER_SIDE: pierSide,
    solve: solved ? { solved: true, raDegrees: centre.raDegrees, decDegrees: centre.decDegrees, rotationDegrees: 0, scaleArcsecPerPixel: scale } : { solved: false, reason: 'no solution' },
    stars: counts.reduce((a, b) => a + b, 0),
    class: solved ? 'sky' : 'blocked',
    pointing: { source: solved ? 'solve' : 'commanded+offset', altitudeDegrees: pointingAltitude, azimuthDegrees: 180 },
  }

  return { record, size, counts, levels: counts.map(count => 400 + count), headerScale: scale }
}

describe('labelling the cells of a sweep', () => {
  it('finds the edge of a flat horizon through the frames of a column to within a cell', () => {
    const { edges } = labelSweep([frameAt(0, 10, false), frameAt(1, 12, false), frameAt(2, 14, true), frameAt(3, 16, true), frameAt(4, 18, true)], settings, phoenix)
    const around = edges.filter(edge => edge.bin >= 178 && edge.bin <= 181)

    expect(around.length).toBeGreaterThan(0)

    for (const edge of around) {
      expect(edge.how).toBe('edge')
      expect(Math.abs(edge.edgeAltitudeDegrees! - horizonDegrees)).toBeLessThan(0.4)
      expect(edge.skyAltitudeDegrees! - edge.blockedAltitudeDegrees!).toBeLessThan(0.5)
    }
  })

  it('places the cells with the solve: a later row is higher, a later column is further east, so a lower azimuth', () => {
    const [frame] = labelSweep([frameAt(0, 20, true)], settings, phoenix).frames
    const cell = (column: number, row: number) => frame!.cells[row * 8 + column]!

    expect(frame!.placement).toMatchObject({ source: 'solve', rotationDegrees: 0, scaleArcsecPerPixel: scale })
    expect(cell(0, 5).altitudeDegrees! - cell(0, 0).altitudeDegrees!).toBeCloseTo(5 * (size.height / 6) * (scale / 3600), 2)
    expect(cell(0, 2).azimuthDegrees!).toBeGreaterThan(cell(7, 2).azimuthDegrees!)
    expect(cell(3, 2).altitudeDegrees!).toBeCloseTo(cellAltitude(20, 2), 1)
  })

  it('places an unsolved frame from its recorded pointing and the rotation of the nearest solved frame on the same pier side', () => {
    const { frames } = labelSweep([frameAt(0, 10, false), frameAt(1, 20, true), frameAt(2, 40, true, 'PIER_EAST')], settings, phoenix)
    const unsolved = frames.find(frame => frame.file === 'frame_0.fits')!

    expect(unsolved.placement).toMatchObject({ source: 'pointing', rotationFrom: 'frame_1.fits', rotationDegrees: 0 })
    expect(unsolved.cells[3 * 8 + 3]!.altitudeDegrees!).toBeCloseTo(cellAltitude(10, 3), 1)
  })

  it('does not place an unsolved frame when no solved frame on its pier side gives a rotation, and leaves its cells out of the edges', () => {
    const { frames, edges } = labelSweep([frameAt(0, 10, false), frameAt(1, 20, true, 'PIER_EAST')], settings, phoenix)
    const unsolved = frames.find(frame => frame.file === 'frame_0.fits')!

    expect(unsolved.placement.source).toBe('none')
    expect(unsolved.cells.every(cell => cell.altitudeDegrees === undefined)).toBe(true)
    expect(edges.length).toBeGreaterThan(0)
  })

  it('labels a frame with no stars blocked from the baseline of the solved frames, not sky from its own empty cells', () => {
    const empty = frameAt(0, 6, false)
    const blank: MeasuredFrame = { ...empty, counts: empty.counts.map(() => 0) }
    const { frames } = labelSweep([blank, frameAt(1, 17, true), frameAt(2, 18, true), frameAt(3, 19, true), frameAt(4, 20, true)], settings, phoenix)
    const first = frames.find(frame => frame.file === 'frame_0.fits')!

    expect(first.clearFrom).toBe('baseline')
    expect(first.clearStars).toBe(20)
    expect(first.cells.every(cell => cell.label === 'blocked')).toBe(true)
  })

  it('takes a solved frame as its own clear-sky count', () => {
    const { frames } = labelSweep([frameAt(0, 20, true), frameAt(1, 19, true)], settings, phoenix)

    expect(frames.map(frame => [frame.clearFrom, frame.clearStars])).toEqual([['frame', 20], ['frame', 20]])
  })

  it('records each cell with its count, level, label and place, in the frames order of the sweep', () => {
    const { frames } = labelSweep([frameAt(1, 19, true), frameAt(0, 20, true)], settings, phoenix)

    expect(frames.map(frame => frame.file)).toEqual(['frame_0.fits', 'frame_1.fits'])
    expect(frames[0]!.cells[0]).toMatchObject({ column: 0, row: 0, stars: 20, level: 420, label: 'sky' })
    expect(frames[0]!.grid).toEqual(grid)
  })
})
