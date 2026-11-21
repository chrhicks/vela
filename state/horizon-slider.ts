import { Schema } from 'effect'
import { described } from './described.ts'

export const SliderSettings = Schema.Struct({
  playMinutesPerSecond: described('How many minutes of the night Play moves the selected time on for each second it runs', Schema.Number.check(Schema.isGreaterThan(0)), 30),
  playFrameMilliseconds: described('The time between two moves of the selected time while Play runs, in milliseconds', Schema.Number.check(Schema.isGreaterThan(0)), 100),
  stepMinutes: described('How many minutes an arrow key moves the selected time', Schema.Number.check(Schema.isGreaterThan(0)), 10),
  bigStepMinutes: described('How many minutes an arrow key moves the selected time while Shift is held', Schema.Number.check(Schema.isGreaterThan(0)), 60),
})

export type SliderSettings = typeof SliderSettings.Type

export const sliderSettings: SliderSettings = Schema.decodeSync(SliderSettings)({})
