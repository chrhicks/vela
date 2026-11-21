import { Schema } from 'effect'
import { FrameClass, PierSide, PointingSource, SweepId } from '../../state/entries.ts'
import { CellLabel } from './cells.ts'
import { Edge } from './edges.ts'

export const CellRecord = Schema.Struct({
  column: Schema.Int,
  row: Schema.Int,
  stars: Schema.Int,
  level: Schema.Number,
  label: CellLabel,
  altitudeDegrees: Schema.optionalKey(Schema.Number),
  azimuthDegrees: Schema.optionalKey(Schema.Number),
})

export type CellRecord = typeof CellRecord.Type

export const Placement = Schema.Union([
  Schema.Struct({
    source: Schema.Literals(['solve', 'pointing']),
    rotationDegrees: Schema.Number,
    rotationFrom: Schema.optionalKey(Schema.String),
    scaleArcsecPerPixel: Schema.Number,
  }),
  Schema.Struct({ source: Schema.Literal('none'), reason: Schema.String }),
])

export type Placement = typeof Placement.Type

export const CellFrame = Schema.Struct({
  sweep: SweepId,
  file: Schema.String,
  at: Schema.Number,
  class: FrameClass,
  pierSide: Schema.optionalKey(PierSide),
  pointing: Schema.Struct({ source: PointingSource, altitudeDegrees: Schema.Number, azimuthDegrees: Schema.Number }),
  grid: Schema.Struct({ columns: Schema.Int, rows: Schema.Int }),
  clearStars: Schema.Number,
  clearFrom: Schema.Literals(['frame', 'baseline']),
  placement: Placement,
  cells: Schema.Array(CellRecord),
})

export type CellFrame = typeof CellFrame.Type

export const EdgeRecord = Schema.Struct({ sweep: SweepId, ...Edge.fields })

export type EdgeRecord = typeof EdgeRecord.Type
