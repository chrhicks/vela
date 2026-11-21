import type { SweepFrameBody } from '../../state/entries.ts'
import type { Site } from '../pointing/target.ts'
import { fromMount } from '../sky/coordinates.ts'
import { equatorialOfDate, horizontalOfJ2000 } from '../sky/horizontal.ts'
import { baselineOf, type SolvedStars } from './baseline.ts'
import type { CellFrame, Placement } from './cell-record.ts'
import { cellColumn, cellRow, labelOf, ownClearStars, type FrameSize } from './cells.ts'
import { edgesOf, type Edge, type PlacedCell } from './edges.ts'
import { cellCentres, type Position } from './projection.ts'
import type { SweepSettings } from './settings.ts'

export interface MeasuredFrame {
  readonly record: SweepFrameBody
  readonly size: FrameSize
  readonly counts: ReadonlyArray<number>
  readonly levels: ReadonlyArray<number>
  readonly headerScale: number | undefined
}

export interface Labelled {
  readonly frames: ReadonlyArray<CellFrame>
  readonly edges: ReadonlyArray<Edge>
}

interface Rotation {
  readonly rotationDegrees: number
  readonly scaleArcsecPerPixel: number | undefined
  readonly file: string
}

const rotationOf = (record: SweepFrameBody): Rotation | undefined =>
  record.solve.solved && record.solve.rotationDegrees !== undefined ? { rotationDegrees: record.solve.rotationDegrees, scaleArcsecPerPixel: record.solve.scaleArcsecPerPixel, file: record.file } : undefined

function borrowedRotation(frame: MeasuredFrame, all: ReadonlyArray<MeasuredFrame>): Rotation | undefined {
  let nearest: { readonly distance: number; readonly rotation: Rotation } | undefined

  for (const other of all) {
    const rotation = rotationOf(other.record)

    if (rotation === undefined || other.record.TELESCOPE_PIER_SIDE !== frame.record.TELESCOPE_PIER_SIDE) continue

    const distance = Math.abs(other.record.at - frame.record.at)

    if (nearest === undefined || distance < nearest.distance) nearest = { distance, rotation }
  }

  return nearest?.rotation
}

const centreOfPointing = (frame: SweepFrameBody, site: Site): Position => {
  const ofDate = equatorialOfDate(frame.pointing.altitudeDegrees, frame.pointing.azimuthDegrees, frame.at, site)

  return fromMount({ raDegrees: ofDate.raHours * 15, decDegrees: ofDate.decDegrees }, new Date(frame.at))
}

function placementOf(frame: MeasuredFrame, all: ReadonlyArray<MeasuredFrame>, grid: { readonly columns: number; readonly rows: number }, site: Site): { readonly placement: Placement; readonly horizontals: ReadonlyArray<{ readonly altitudeDegrees: number; readonly azimuthDegrees: number }> } {
  const { record } = frame
  const own = rotationOf(record)
  const borrowed = own === undefined ? borrowedRotation(frame, all) : undefined
  const rotation = own ?? borrowed

  if (rotation === undefined) return { placement: { source: 'none', reason: 'no solved frame on this pier side to take the rotation from' }, horizontals: [] }

  const scale = (record.solve.solved ? record.solve.scaleArcsecPerPixel : undefined) ?? frame.headerScale ?? rotation.scaleArcsecPerPixel

  if (scale === undefined) return { placement: { source: 'none', reason: 'the pixel scale is not known' }, horizontals: [] }

  const centre = record.solve.solved ? { raDegrees: record.solve.raDegrees, decDegrees: record.solve.decDegrees } : centreOfPointing(record, site)
  const horizontals = cellCentres({ centre, rotationDegrees: rotation.rotationDegrees, scaleArcsecPerPixel: scale, size: frame.size }, grid).map(position => horizontalOfJ2000(position, record.at, site))

  return {
    placement: { source: record.solve.solved ? 'solve' : 'pointing', rotationDegrees: rotation.rotationDegrees, ...(borrowed === undefined ? {} : { rotationFrom: borrowed.file }), scaleArcsecPerPixel: scale },
    horizontals,
  }
}

export function labelSweep(frames: ReadonlyArray<MeasuredFrame>, settings: SweepSettings, site: Site): Labelled {
  const { cells: cellSettings } = settings
  const grid = { columns: cellSettings.columns, rows: cellSettings.rows }
  const ordered = [...frames].sort((a, b) => a.record.at - b.record.at)
  const own = ordered.map(frame => ownClearStars(frame.counts, cellSettings))
  const solved: Array<SolvedStars> = ordered.flatMap((frame, index) => (frame.record.solve.solved ? [{ altitudeDegrees: frame.record.pointing.altitudeDegrees, stars: own[index]! }] : []))

  const labelled = ordered.map((frame, index): CellFrame => {
    const baseline = frame.record.solve.solved ? undefined : baselineOf(solved, frame.record.pointing.altitudeDegrees, settings)
    const clearFrom = baseline !== undefined && baseline > own[index]! ? 'baseline' : 'frame'
    const clearStars = clearFrom === 'baseline' ? baseline! : own[index]!
    const { placement, horizontals } = placementOf(frame, ordered, grid, site)

    return {
      sweep: frame.record.sweep,
      file: frame.record.file,
      at: frame.record.at,
      class: frame.record.class,
      ...(frame.record.TELESCOPE_PIER_SIDE === undefined ? {} : { pierSide: frame.record.TELESCOPE_PIER_SIDE }),
      pointing: frame.record.pointing,
      grid,
      clearStars,
      clearFrom,
      placement,
      cells: frame.counts.map((stars, cell) => ({
        column: cellColumn(cell, grid),
        row: cellRow(cell, grid),
        stars,
        level: frame.levels[cell]!,
        label: labelOf(stars, clearStars, cellSettings),
        ...(horizontals[cell] === undefined ? {} : horizontals[cell]),
      })),
    }
  })

  const placed: Array<PlacedCell> = labelled.flatMap(frame => frame.cells.flatMap(cell => (cell.altitudeDegrees === undefined || cell.azimuthDegrees === undefined ? [] : [{ altitudeDegrees: cell.altitudeDegrees, azimuthDegrees: cell.azimuthDegrees, label: cell.label }])))

  return { frames: labelled, edges: edgesOf(placed, cellSettings) }
}
