import { Schema } from 'effect'
import { FrameClass, NightName, PointingSource } from './entries.ts'

export const horizonSweepPath = '/horizon-sweep'

export const EdgeKind = Schema.Literals(['edge', 'open', 'blocked'])

export type EdgeKind = typeof EdgeKind.Type

export const SweepFramePoint = Schema.Struct({
  altitudeDegrees: Schema.Number,
  azimuthDegrees: Schema.Number,
  source: PointingSource,
  class: FrameClass,
})

export type SweepFramePoint = typeof SweepFramePoint.Type

export const SweepFile = Schema.Literals(['frames.jsonl', 'edges.jsonl'])

export type SweepFile = typeof SweepFile.Type

export const MapUnavailableReason = Schema.Literals(['no-origins', 'missing', 'unreadable', 'no-frames', 'no-edges'])

export type MapUnavailableReason = typeof MapUnavailableReason.Type

export const HorizonSweep = Schema.Union([
  Schema.Struct({
    status: Schema.Literal('available'),
    nights: Schema.Array(NightName),
    frames: Schema.Array(SweepFramePoint),
    edges: Schema.Array(Schema.NullOr(EdgeKind)),
  }),
  Schema.Struct({
    status: Schema.Literal('unavailable'),
    reason: MapUnavailableReason,
    night: Schema.NullOr(NightName),
    file: Schema.NullOr(SweepFile),
  }),
])

export type HorizonSweep = typeof HorizonSweep.Type
