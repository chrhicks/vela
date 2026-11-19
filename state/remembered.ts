import { Schema } from 'effect'
import { CoolerSetting } from './commands.ts'

export const rememberedPath = '/remembered'

export const RememberedAnswer = Schema.Struct({
  lastLight: Schema.NullOr(Schema.Struct({ exposureSeconds: Schema.Number, frames: Schema.NullOr(Schema.Number) })),
  cameraAngleDegrees: Schema.NullOr(Schema.Number),
})

export type RememberedAnswer = typeof RememberedAnswer.Type

export const CoolerAtStart = Schema.Struct({ setting: CoolerSetting, at: Schema.Finite })

export type CoolerAtStart = typeof CoolerAtStart.Type
