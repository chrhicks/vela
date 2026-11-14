import { Schema } from 'effect'

export const skyPath = '/sky'

export const Sky = Schema.Struct({
  dark: Schema.NullOr(Schema.Struct({ from: Schema.Number, until: Schema.Number })),
  moon: Schema.Struct({
    litFraction: Schema.Number,
    up: Schema.Boolean,
    changesAt: Schema.NullOr(Schema.Number),
  }),
})

export type Sky = typeof Sky.Type

export const SkyAnswer = Schema.NullOr(Sky)
