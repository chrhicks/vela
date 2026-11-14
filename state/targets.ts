import { Schema } from 'effect'

export const targetsPath = '/targets'

export const TargetId = Schema.String.pipe(Schema.brand('TargetId'))

export type TargetId = typeof TargetId.Type

export const TargetSearch = Schema.Struct({ q: Schema.String })

export const TargetSummary = Schema.Struct({
  id: TargetId,
  name: Schema.String,
  commonName: Schema.NullOr(Schema.String),
  type: Schema.String,
  constellation: Schema.NullOr(Schema.String),
})

export type TargetSummary = typeof TargetSummary.Type

export const TargetsFound = Schema.Array(TargetSummary)
