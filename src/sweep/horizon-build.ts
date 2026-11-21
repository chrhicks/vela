import type { Horizon } from '../horizon/horizon.ts'
import { noHorizon } from '../horizon/horizon.ts'
import type { SweepColumnBody } from '../../state/entries.ts'
import type { Edge } from './edges.ts'
import type { SweepSettings } from './settings.ts'

export interface TimedColumn extends SweepColumnBody {
  readonly at: number
}

export interface SweepBin {
  readonly bin: number
  readonly altitudeDegrees: number
  readonly from: 'cells' | 'column'
  readonly at: number
}

const binsAround = 360

const wrap = (azimuthDegrees: number) => ((azimuthDegrees % 360) + 360) % 360

const apart = (a: number, b: number) => {
  const gap = Math.abs(wrap(a) - wrap(b))
  return Math.min(gap, 360 - gap)
}

const hasEdge = (column: SweepColumnBody) => column.how !== 'blocked-to-ceiling'

const columnOver = (azimuthDegrees: number, columns: ReadonlyArray<TimedColumn>, settings: Pick<SweepSettings, 'columnDegrees'>) =>
  columns.reduce<TimedColumn | undefined>((nearest, column) => {
    const distance = apart(column.azimuthDegrees, azimuthDegrees)
    return distance <= settings.columnDegrees / 2 && (nearest === undefined || distance < apart(nearest.azimuthDegrees, azimuthDegrees)) ? column : nearest
  }, undefined)

const nearestColumn = (azimuthDegrees: number, columns: ReadonlyArray<TimedColumn>) =>
  columns.reduce<TimedColumn | undefined>((nearest, column) => (nearest === undefined || apart(column.azimuthDegrees, azimuthDegrees) < apart(nearest.azimuthDegrees, azimuthDegrees) ? column : nearest), undefined)

export function binsOfSweep(columns: ReadonlyArray<TimedColumn>, edges: ReadonlyArray<Edge>, settings: Pick<SweepSettings, 'columnDegrees'>): ReadonlyArray<SweepBin> {
  const timed = columns.filter(hasEdge)
  const cellEdges = new Map(edges.flatMap(edge => (edge.how === 'edge' && edge.edgeAltitudeDegrees !== undefined ? [[edge.bin, edge.edgeAltitudeDegrees] as const] : [])))

  return Array.from({ length: binsAround }, (_, bin): ReadonlyArray<SweepBin> => {
    const centre = bin + 0.5
    const cell = cellEdges.get(bin)
    if (cell !== undefined) {
      const column = columnOver(centre, columns, settings) ?? nearestColumn(centre, columns)
      return column === undefined ? [] : [{ bin, altitudeDegrees: cell, from: 'cells', at: column.at }]
    }

    const column = columnOver(centre, timed, settings)
    return column === undefined ? [] : [{ bin, altitudeDegrees: column.edgeAltitudeDegrees, from: 'column', at: column.at }]
  }).flat()
}

export function mergeSweep(existing: Horizon, bins: ReadonlyArray<SweepBin>): Horizon {
  const altitudesDegrees = [...existing.altitudesDegrees]
  const sources = [...existing.sources]
  const observedAt = [...existing.observedAt]

  for (const { bin, altitudeDegrees, at } of bins) {
    altitudesDegrees[bin] = altitudeDegrees
    sources[bin] = 'sweep'
    observedAt[bin] = new Date(at).toISOString()
  }

  return { ...noHorizon, altitudesDegrees, sources, observedAt }
}
