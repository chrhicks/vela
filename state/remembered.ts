import { Schema } from 'effect'

export const rememberedPath = '/remembered'

export const RememberedAnswer = Schema.Struct({
  lastLight: Schema.NullOr(Schema.Struct({ exposureSeconds: Schema.Number, frames: Schema.NullOr(Schema.Number) })),
  cameraAngleDegrees: Schema.NullOr(Schema.Number),
})

export type RememberedAnswer = typeof RememberedAnswer.Type
