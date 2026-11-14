import { Schema } from 'effect'

export const CatalogTarget = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  commonName: Schema.NullOr(Schema.String),
  type: Schema.String,
  raDegrees: Schema.Finite,
  decDegrees: Schema.Finite,
  majorAxisArcminutes: Schema.NullOr(Schema.Finite),
  minorAxisArcminutes: Schema.NullOr(Schema.Finite),
})

export type CatalogTarget = typeof CatalogTarget.Type

export const TargetName = Schema.Struct({
  target: Schema.String,
  name: Schema.String,
})

export type TargetName = typeof TargetName.Type

export interface TargetSummary {
  readonly id: string
  readonly name: string
  readonly commonName: string | null
  readonly type: string
  readonly constellation: string | null
}
