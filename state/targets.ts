import { Schema } from 'effect'

export const targetsPath = '/targets'

export const bestPlacedPath = '/targets/best-placed'

export const targetPath = '/target'

export const catalogPath = '/catalog'

export const CatalogSize = Schema.Struct({ targets: Schema.Int })

export type CatalogSize = typeof CatalogSize.Type

export const TargetId = Schema.String.pipe(Schema.brand('TargetId'))

export type TargetId = typeof TargetId.Type

export const TargetSearch = Schema.Struct({ q: Schema.String })

export const TargetAsked = Schema.Struct({ id: Schema.String })

export const ListShown = Schema.Literals(['all', 'dual-band'])

export type ListShown = typeof ListShown.Type

export const ListOrder = Schema.Literals(['placed', 'largest'])

export type ListOrder = typeof ListOrder.Type

export const BestPlacedAsked = Schema.Struct({ show: ListShown, order: ListOrder })

export type BestPlacedAsked = typeof BestPlacedAsked.Type

export const Placement = Schema.Struct({
  altitudeDegrees: Schema.Number,
  lineDegrees: Schema.Number,
  moonDegrees: Schema.Number,
  line: Schema.Union([
    Schema.Struct({ above: Schema.Literal('until'), until: Schema.Number }),
    Schema.Struct({ above: Schema.Literal('always') }),
    Schema.Struct({ above: Schema.Literal('rises'), at: Schema.Number }),
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

export const SizeArcminutes = Schema.NullOr(Schema.Struct({ long: Schema.Number, short: Schema.NullOr(Schema.Number) }))

export type SizeArcminutes = typeof SizeArcminutes.Type

export const TargetFound = Schema.Struct({ ...TargetSummary.fields, placement: Schema.NullOr(Placement), dualBandHint: Schema.Boolean, sizeArcminutes: SizeArcminutes })

export type TargetFound = typeof TargetFound.Type

export const TargetsFound = Schema.Array(TargetFound)

export const TargetFacts = Schema.Struct({
  ...TargetFound.fields,
  raDegrees: Schema.Number,
  decDegrees: Schema.Number,
  otherNames: Schema.Array(Schema.String),
  lastCentre: Schema.NullOr(Schema.Struct({ raDegrees: Schema.Number, decDegrees: Schema.Number, at: Schema.Number, eastDegrees: Schema.Number, northDegrees: Schema.Number })),
})

export type TargetFacts = typeof TargetFacts.Type

export const RunTarget = Schema.Struct({ id: TargetId, name: Schema.String, raDegrees: Schema.Number, decDegrees: Schema.Number })

export type RunTarget = typeof RunTarget.Type
