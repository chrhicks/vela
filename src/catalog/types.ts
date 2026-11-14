import { Schema } from 'effect'
import { TargetId } from '../../state/targets.ts'

export const CatalogTarget = Schema.Struct({
  id: TargetId,
  name: Schema.String,
  commonName: Schema.NullOr(Schema.String),
  type: Schema.String,
  raDegrees: Schema.Finite,
  decDegrees: Schema.Finite,
  majorAxisArcminutes: Schema.NullOr(Schema.Finite),
  minorAxisArcminutes: Schema.NullOr(Schema.Finite),
  nameCitations: Schema.Finite,
})

export type CatalogTarget = typeof CatalogTarget.Type

export const TargetName = Schema.Struct({
  target: TargetId,
  name: Schema.String,
})

export type TargetName = typeof TargetName.Type
