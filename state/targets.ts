import { Schema } from 'effect'

export const targetsPath = '/targets'

export const TargetId = Schema.String.pipe(Schema.brand('TargetId'))

export type TargetId = typeof TargetId.Type

export const TargetSearch = Schema.Struct({ q: Schema.String })

export const Placement = Schema.Struct({
  altitudeDegrees: Schema.Number,
  moonDegrees: Schema.Number,
  line: Schema.Union([
    Schema.Struct({ above: Schema.Literal('until'), until: Schema.Number }),
    Schema.Struct({ above: Schema.Literal('always') }),
    Schema.Struct({ above: Schema.Literal('no') }),
  ]),
})

export type Placement = typeof Placement.Type

export const TargetSummary = Schema.Struct({
  id: TargetId,
  name: Schema.String,
  commonName: Schema.NullOr(Schema.String),
  type: Schema.String,
  constellation: Schema.NullOr(Schema.String),
})

export type TargetSummary = typeof TargetSummary.Type

export const TargetFound = Schema.Struct({ ...TargetSummary.fields, placement: Schema.NullOr(Placement) })

export type TargetFound = typeof TargetFound.Type

export const TargetsFound = Schema.Array(TargetFound)
